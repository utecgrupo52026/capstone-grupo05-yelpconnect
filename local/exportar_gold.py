"""
exportar_gold.py — SE EJECUTA EN TU LAPTOP (no en Databricks)

Lee los productos de datos de yelp_gold / yelp_gov a través del SQL Warehouse y
genera los JSON agregados que consume el dashboard Angular (E8_dashboard_bi/web).

Regla E8: el dashboard consume SOLO gold y gov. Este script no toca silver/bronze.
Gobierno: user_id se seudonimiza y el texto de las reseñas se trunca, porque el
sitio publicado en Netlify es público.

Qué JSON responde a cada pregunta de la sección 7.1 del Documento Formal:
  REQ-01  businesses (+ tasa de señal) y business_monthly (evolución por negocio)
  REQ-02  overview
  REQ-03  overview (P1/P2/P3) y queue
  REQ-04  rules y rule_cooccurrence (reglas que se activan juntas)
  REQ-05  daily (últimos días) y monthly (histórico), con score promedio
  REQ-06  dq: ejecución DQ vigente al iniciar el run + certificación de la corrida
  REQ-07  meta.versiones y rules (versión de regla, pipeline, modelo de riesgo y run)

Uso:
  python exportar_gold.py                        # exporta desde Databricks (requiere .env)
  python exportar_gold.py --verificar            # revisa que las tablas/columnas esperadas existan
  python exportar_gold.py --demo                 # datos sintéticos para desarrollar la UI sin Databricks
  python exportar_gold.py --demo --salida DIR    # escribe en otra carpeta (no pisa el snapshot real)
"""
import argparse
from pathlib import Path

import pandas as pd

from yelp_local import salida
from yelp_local.db import GOLD, GOV, conectar, consultar, verificar_columnas

# Columnas que el dashboard necesita de cada tabla (se validan con --verificar)
ESPERADO = {
    f"{GOLD}.gld_kpi_trust_safety_overview": [
        "evaluation_run_id", "reviews_evaluated", "reviews_with_signal", "reviews_for_investigation",
        "reviews_incomplete_evaluation", "priority_p1", "priority_p2", "priority_p3",
        "signal_rate_pct", "investigation_rate_pct", "avg_weighted_risk_score",
        "max_weighted_risk_score", "_gold_loaded_at"],
    f"{GOLD}.gld_kpi_trust_safety_daily": [
        "evaluation_run_id", "review_date", "reviews_evaluated", "reviews_with_signal",
        "reviews_for_investigation", "priority_p1", "priority_p2", "avg_weighted_risk_score"],
    f"{GOLD}.gld_kpi_trust_safety_rule": [
        "evaluation_run_id", "rule_id", "rule_version_id", "rule_name", "rule_type", "reviews_evaluated",
        "signals", "no_signals", "not_evaluable", "signal_rate_pct", "evaluation_coverage_pct"],
    f"{GOLD}.gld_kpi_trust_safety_business": [
        "evaluation_run_id", "business_id", "business_name", "city", "state", "reviews_evaluated",
        "reviews_with_signal", "reviews_for_investigation", "priority_p1", "signal_rate_pct",
        "investigation_rate_pct", "avg_weighted_risk_score", "max_weighted_risk_score"],
    f"{GOLD}.gld_review_risk": [
        "evaluation_run_id", "review_id", "business_id", "review_date", "signal_count", "signal_rules",
        "requires_investigation", "risk_model_version", "feature_execution_id", "risk_consolidation_id"],
    f"{GOLD}.gld_investigation_queue": [
        "evaluation_run_id", "review_id", "user_id", "business_name", "city", "review_date", "stars",
        "review_text", "signal_count", "signal_rules_csv", "weighted_risk_score",
        "risk_classification", "investigation_priority", "investigation_status"],
    f"{GOLD}.gld_dim_rule": ["rule_version_id", "rule_id", "version", "threshold", "weight", "status", "valid_from"],
    f"{GOLD}.gld_dim_evaluation_run": [
        "evaluation_run_id", "pipeline_name", "pipeline_version", "dataset_version", "started_at",
        "finished_at", "execution_status"],
    f"{GOV}.dq_resultados": [
        "ejecucion_id", "ejecucion_ts", "regla_id", "capa", "tabla_objetivo", "columna", "dimension",
        "criticidad", "filas_totales", "filas_error", "pct_cumplimiento", "umbral_pct", "paso"],
    f"{GOV}.dq_reglas": ["regla_id", "descripcion"],
}

# Último run publicado en gold (todas las KPI se filtran por el mismo run)
RUN = (f"(SELECT evaluation_run_id FROM {GOLD}.gld_kpi_trust_safety_overview "
       f"ORDER BY _gold_loaded_at DESC LIMIT 1)")

TOP_NEGOCIOS = 50       # REQ-01: top por reseñas a investigar y top por tasa de señal
MIN_RESENAS_TASA = 50   # REQ-01: volumen mínimo para rankear por tasa (evita 100 % con 2 reseñas)
MESES_NEGOCIO = 36      # REQ-01: ventana de la evolución mensual por negocio
DIAS_SERIE = 90         # REQ-05: serie diaria reciente
TOP_COMBINACIONES = 15  # REQ-04: combinaciones de reglas más frecuentes
TOP_COLA = 200
LARGO_TEXTO = 200

# Negocios exportados: unión del top por reseñas a investigar y del top por tasa de señal
NEGOCIOS = f"""
    SELECT business_id FROM (
        SELECT business_id FROM {GOLD}.gld_kpi_trust_safety_business
        WHERE evaluation_run_id = {RUN}
        ORDER BY reviews_for_investigation DESC, avg_weighted_risk_score DESC
        LIMIT {TOP_NEGOCIOS}) AS por_investigacion
    UNION
    SELECT business_id FROM (
        SELECT business_id FROM {GOLD}.gld_kpi_trust_safety_business
        WHERE evaluation_run_id = {RUN} AND reviews_evaluated >= {MIN_RESENAS_TASA}
        ORDER BY signal_rate_pct DESC, reviews_with_signal DESC
        LIMIT {TOP_NEGOCIOS}) AS por_tasa"""

CRITERIO_CERTIFICACION = (
    "Certificada: el run terminó en SUCCESS y la ejecución DQ Silver vigente al iniciarlo no tiene reglas "
    "de criticidad alta en rojo (el mismo Quality Gate de 04_trust_safety_evaluacion). "
    "Con observaciones: además hay reglas DQ no críticas en rojo. "
    "La cobertura de evaluación se informa, pero no bloquea: NOT_EVALUABLE es un riesgo aceptado (DQ-SL-012).")


# ---------------------------------------------------------------------------
# Lectura desde Databricks
# ---------------------------------------------------------------------------

def leer_databricks(conn) -> dict[str, pd.DataFrame | None]:
    q = lambda sql: consultar(conn, sql)

    def opcional(nombre: str, sql: str) -> pd.DataFrame | None:
        """Las consultas de REQ-01/04/06/07 no deben tumbar el snapshot base si algo cambió en gold."""
        try:
            return q(sql)
        except Exception as e:  # noqa: BLE001 — se informa y el JSON correspondiente se omite
            print(f"  ⚠ {nombre}: no se pudo leer ({type(e).__name__}: {str(e).splitlines()[0][:160]})")
            return None

    return {
        "overview": q(f"SELECT * FROM {GOLD}.gld_kpi_trust_safety_overview WHERE evaluation_run_id = {RUN}"),
        "daily": q(f"""
            SELECT review_date, reviews_evaluated, reviews_with_signal, reviews_for_investigation,
                   priority_p1, priority_p2, avg_weighted_risk_score
            FROM {GOLD}.gld_kpi_trust_safety_daily
            WHERE evaluation_run_id = {RUN}"""),
        "rules": q(f"""
            SELECT rule_id, rule_name, rule_type, reviews_evaluated, signals, no_signals,
                   not_evaluable, signal_rate_pct, evaluation_coverage_pct
            FROM {GOLD}.gld_kpi_trust_safety_rule
            WHERE evaluation_run_id = {RUN}
            ORDER BY rule_id"""),
        "businesses": q(f"""
            SELECT business_id, business_name, city, state, reviews_evaluated, reviews_with_signal,
                   reviews_for_investigation, priority_p1, signal_rate_pct, investigation_rate_pct,
                   avg_weighted_risk_score, max_weighted_risk_score
            FROM {GOLD}.gld_kpi_trust_safety_business
            WHERE evaluation_run_id = {RUN} AND business_id IN ({NEGOCIOS})
            ORDER BY reviews_for_investigation DESC, avg_weighted_risk_score DESC"""),
        "queue": q(f"""
            SELECT review_id, user_id, business_name, city, review_date, stars,
                   left(review_text, {LARGO_TEXTO}) AS text_preview,
                   signal_count, signal_rules_csv, weighted_risk_score,
                   risk_classification, investigation_priority, investigation_status
            FROM {GOLD}.gld_investigation_queue
            WHERE evaluation_run_id = {RUN}
            ORDER BY weighted_risk_score DESC, signal_count DESC
            LIMIT {TOP_COLA}"""),
        # Bitácora DQ completa (es chica: ~20 reglas por capa y ejecución). La ejecución que
        # corresponde al run se elige en Python con seleccionar_dq(), igual que en modo demo.
        "dq": q(f"""
            SELECT r.ejecucion_id, r.capa, r.dimension, r.regla_id, d.descripcion, r.tabla_objetivo,
                   r.columna, r.criticidad, r.filas_totales, r.filas_error, r.pct_cumplimiento,
                   r.umbral_pct, r.paso, r.ejecucion_ts
            FROM {GOV}.dq_resultados r
            LEFT JOIN {GOV}.dq_reglas d USING (regla_id)"""),

        # REQ-06 / REQ-07: el run y las versiones que produjeron los KPI
        "run": opcional("gld_dim_evaluation_run", f"""
            SELECT evaluation_run_id, pipeline_name, pipeline_version, dataset_version,
                   started_at, finished_at, execution_status
            FROM {GOLD}.gld_dim_evaluation_run
            WHERE evaluation_run_id = {RUN}"""),
        "rule_versions": opcional("versiones de regla", f"""
            SELECT k.rule_id, k.rule_version_id, d.version AS rule_version, d.threshold, d.weight,
                   d.status AS rule_status, d.valid_from
            FROM {GOLD}.gld_kpi_trust_safety_rule k
            LEFT JOIN {GOLD}.gld_dim_rule d ON d.rule_version_id = k.rule_version_id
            WHERE k.evaluation_run_id = {RUN}
            ORDER BY k.rule_id"""),
        "riesgo": opcional("versión del modelo de riesgo", f"""
            SELECT risk_model_version, feature_execution_id, risk_consolidation_id, count(*) AS reviews
            FROM {GOLD}.gld_review_risk
            WHERE evaluation_run_id = {RUN}
            GROUP BY 1, 2, 3"""),

        # REQ-01: evolución mensual de los negocios exportados (últimos MESES_NEGOCIO meses del run)
        "negocios_mes": opcional("evolución por negocio", f"""
            SELECT business_id, date_format(review_date, 'yyyy-MM') AS mes,
                   count(*) AS reviews_evaluated,
                   sum(CASE WHEN signal_count > 0 THEN 1 ELSE 0 END) AS reviews_with_signal,
                   sum(CASE WHEN requires_investigation THEN 1 ELSE 0 END) AS reviews_for_investigation
            FROM {GOLD}.gld_review_risk
            WHERE evaluation_run_id = {RUN}
              AND business_id IN ({NEGOCIOS})
              AND review_date >= add_months(trunc((SELECT max(review_date) FROM {GOLD}.gld_review_risk
                                                   WHERE evaluation_run_id = {RUN}), 'MM'), -{MESES_NEGOCIO - 1})
            GROUP BY 1, 2"""),

        # REQ-04: qué reglas se activan juntas (pares, con la diagonal = señales de cada regla)
        "pares": opcional("co-ocurrencia de reglas", f"""
            WITH s AS (
                SELECT review_id, explode(signal_rules) AS rule_id
                FROM {GOLD}.gld_review_risk
                WHERE evaluation_run_id = {RUN} AND signal_count > 0)
            SELECT a.rule_id AS regla_a, b.rule_id AS regla_b, count(*) AS reviews
            FROM s a JOIN s b ON a.review_id = b.review_id AND a.rule_id <= b.rule_id
            GROUP BY 1, 2"""),
        "combinaciones": opcional("combinaciones de reglas", f"""
            SELECT concat_ws(' + ', array_sort(signal_rules)) AS combinacion,
                   size(signal_rules) AS n_reglas,
                   count(*) AS reviews,
                   sum(CASE WHEN requires_investigation THEN 1 ELSE 0 END) AS reviews_for_investigation
            FROM {GOLD}.gld_review_risk
            WHERE evaluation_run_id = {RUN} AND signal_count > 0
            GROUP BY 1, 2
            ORDER BY reviews DESC
            LIMIT {TOP_COMBINACIONES}"""),
    }


# ---------------------------------------------------------------------------
# Transformación a JSON (igual para Databricks y demo)
# ---------------------------------------------------------------------------

def _tasas(d: pd.DataFrame) -> pd.DataFrame:
    n = d["reviews_evaluated"].where(d["reviews_evaluated"] > 0)
    d["signal_rate_pct"] = (100 * d["reviews_with_signal"] / n).round(2)
    if "reviews_for_investigation" in d:
        d["investigation_rate_pct"] = (100 * d["reviews_for_investigation"] / n).round(2)
    return d


def a_mensual(daily: pd.DataFrame) -> pd.DataFrame:
    """La serie diaria cubre años: se agrega por mes para que el JSON sea liviano."""
    d = daily.copy()
    d["mes"] = pd.to_datetime(d["review_date"]).dt.strftime("%Y-%m")
    d["_score_x_n"] = d["avg_weighted_risk_score"].fillna(0) * d["reviews_evaluated"]
    m = d.groupby("mes", as_index=False).agg(
        reviews_evaluated=("reviews_evaluated", "sum"),
        reviews_with_signal=("reviews_with_signal", "sum"),
        reviews_for_investigation=("reviews_for_investigation", "sum"),
        priority_p1=("priority_p1", "sum"),
        _score_x_n=("_score_x_n", "sum"),
    )
    m = _tasas(m)
    n = m["reviews_evaluated"].where(m["reviews_evaluated"] > 0)
    m["avg_weighted_risk_score"] = (m.pop("_score_x_n") / n).round(4)
    return m.sort_values("mes")


def a_diario(daily: pd.DataFrame, dias: int = DIAS_SERIE) -> pd.DataFrame:
    """REQ-05: últimos `dias` días del run, con los días sin reseñas en cero."""
    d = daily.copy()
    d["dia"] = pd.to_datetime(d["review_date"]).dt.normalize()
    fin = d["dia"].max()
    rango = pd.date_range(fin - pd.Timedelta(days=dias - 1), fin, freq="D", name="dia")
    conteos = [c for c in ("reviews_evaluated", "reviews_with_signal", "reviews_for_investigation",
                           "priority_p1", "priority_p2") if c in d]
    d = d.set_index("dia").reindex(rango)
    d[conteos] = d[conteos].fillna(0).astype(int)
    d = _tasas(d.reset_index())
    d["avg_weighted_risk_score"] = d["avg_weighted_risk_score"].round(4)
    d["dia"] = d["dia"].dt.strftime("%Y-%m-%d")
    return d[["dia", *conteos, "signal_rate_pct", "investigation_rate_pct", "avg_weighted_risk_score"]]


def a_negocios_mes(nm: pd.DataFrame | None, ultimo_mes: str, meses: int = MESES_NEGOCIO) -> pd.DataFrame | None:
    """REQ-01: una fila por negocio y mes, con los meses sin reseñas en cero (mismo eje para todos)."""
    if nm is None or nm.empty:
        return None
    todos = [str(p) for p in pd.period_range(end=pd.Period(ultimo_mes, "M"), periods=meses, freq="M")]
    idx = pd.MultiIndex.from_product([sorted(nm["business_id"].unique()), todos], names=["business_id", "mes"])
    cols = ["reviews_evaluated", "reviews_with_signal", "reviews_for_investigation"]
    d = (nm.assign(mes=nm["mes"].astype(str))
           .groupby(["business_id", "mes"])[cols].sum()
           .reindex(idx, fill_value=0).astype(int).reset_index())
    d = _tasas(d)
    return d.drop(columns="investigation_rate_pct")


def coocurrencia(pares: pd.DataFrame | None, combos: pd.DataFrame | None, reglas: list[str],
                 con_senal: int) -> dict | None:
    """REQ-04: matriz de reglas que se activan en la misma reseña y combinaciones más frecuentes."""
    if pares is None or pares.empty:
        return None
    p = pares.copy()
    p["reviews"] = p["reviews"].astype(int)
    total = dict(p.loc[p["regla_a"] == p["regla_b"], ["regla_a", "reviews"]].itertuples(index=False))
    fuera = p[p["regla_a"] != p["regla_b"]].copy()
    fuera["pct_de_a"] = (100 * fuera["reviews"] / fuera["regla_a"].map(total)).round(2)
    fuera["pct_de_b"] = (100 * fuera["reviews"] / fuera["regla_b"].map(total)).round(2)
    union = fuera["regla_a"].map(total) + fuera["regla_b"].map(total) - fuera["reviews"]
    fuera["jaccard"] = (fuera["reviews"] / union).round(4)
    return {
        "reglas": sorted(set(reglas) | set(total)),
        "reviews_con_senal": int(con_senal),
        "senales_por_regla": {k: int(v) for k, v in sorted(total.items())},
        "pares": salida.registros(fuera.sort_values("reviews", ascending=False)),
        "combinaciones": salida.registros(combos) if combos is not None else [],
    }


def seleccionar_dq(dq: pd.DataFrame, inicio_run) -> tuple[pd.DataFrame, str]:
    """REQ-06: por capa, la última ejecución DQ anterior al inicio del run (la que lo habilitó).

    Si no hay run o ninguna ejecución es anterior, cae en la última ejecución por capa.
    """
    # Se compara en UTC sin zona; la columna original se conserva para el JSON
    ts = pd.to_datetime(dq["ejecucion_ts"], utc=True).dt.tz_convert(None)
    ej = (dq.assign(_ts=ts).groupby(["capa", "ejecucion_id"], as_index=False)["_ts"].max())
    inicio = pd.to_datetime(inicio_run, utc=True).tz_convert(None) if inicio_run is not None else None
    vinculo = "run"
    elegidas = []
    for _, g in ej.groupby("capa"):
        previas = g[g["_ts"] <= inicio] if inicio is not None else g.iloc[0:0]
        if previas.empty:
            vinculo, previas = "ultima_ejecucion", g
        elegidas.append(previas.nlargest(1, "_ts")["ejecucion_id"].iloc[0])
    return dq[dq["ejecucion_id"].isin(elegidas)].copy(), vinculo


def resumen_dq(dq: pd.DataFrame, vinculo: str) -> dict:
    dq = dq.copy()
    dq["paso"] = dq["paso"].astype(bool)
    por_dim = (dq.groupby(["capa", "dimension"], as_index=False)
                 .agg(reglas=("regla_id", "count"),
                      en_rojo=("paso", lambda s: int((~s).sum())),
                      pct_cumplimiento=("pct_cumplimiento", "mean"))
                 .round({"pct_cumplimiento": 2}))
    ejecuciones = (dq.groupby(["capa", "ejecucion_id"], as_index=False)
                     .agg(ejecucion_ts=("ejecucion_ts", "max"), reglas=("regla_id", "count"))
                     .sort_values("capa"))
    return {
        "ultima_ejecucion": salida._limpiar(pd.to_datetime(dq["ejecucion_ts"]).max()) if len(dq) else None,
        "vinculo": vinculo,
        "ejecuciones": salida.registros(ejecuciones),
        "total_reglas": int(len(dq)),
        "reglas_ok": int(dq["paso"].sum()),
        "reglas_en_rojo": int((~dq["paso"]).sum()),
        "pct_cumplimiento_promedio": round(float(dq["pct_cumplimiento"].mean()), 2) if len(dq) else None,
        "por_capa_dimension": salida.registros(por_dim),
        "reglas": salida.registros(dq.drop(columns=["ejecucion_ts", "ejecucion_id"])
                                     .sort_values(["paso", "criticidad", "regla_id"])),
    }


def certificar(run: dict | None, dq: pd.DataFrame, vinculo: str, ov: dict) -> dict:
    """REQ-06: ¿el resultado del dashboard puede considerarse certificado?"""
    dq = dq.assign(paso=dq["paso"].astype(bool), _crit=dq["criticidad"].str.lower(), _capa=dq["capa"].str.lower())
    chequeos = []

    estado = (run or {}).get("execution_status")
    chequeos.append({
        "id": "run", "nombre": "Run de evaluación finalizado",
        "estado": "sin_datos" if estado is None else ("ok" if estado == "SUCCESS" else "falla"),
        "detalle": f"execution_status = {estado}" if estado else "No se pudo leer gld_dim_evaluation_run",
    })

    silver = dq[dq["_capa"] == "silver"]
    criticas = silver[(silver["_crit"] == "alta") & ~silver["paso"]]
    if vinculo != "run" or silver.empty:
        gate = {"estado": "sin_datos",
                "detalle": "No hay una ejecución DQ Silver anterior al inicio del run para comprobar el gate"}
    else:
        gate = {"estado": "ok" if criticas.empty else "falla",
                "detalle": f"{len(criticas)} reglas de criticidad alta en rojo en la ejecución {silver['ejecucion_id'].iloc[0]}"}
    chequeos.append({"id": "quality_gate", "nombre": "Quality Gate Silver (criticidad alta)", **gate})

    otras = dq[~dq["paso"]].drop(criticas.index)
    chequeos.append({
        "id": "dq_rojo", "nombre": "Otras reglas DQ en rojo",
        "estado": "ok" if otras.empty else "alerta",
        "detalle": "Ninguna" if otras.empty else ", ".join(sorted(otras["regla_id"].astype(str).unique())),
    })

    evaluadas = int(ov.get("reviews_evaluated") or 0)
    incompletas = int(ov.get("reviews_incomplete_evaluation") or 0)
    cobertura = round(100 * (evaluadas - incompletas) / evaluadas, 2) if evaluadas else None
    chequeos.append({
        "id": "cobertura", "nombre": "Cobertura de evaluación de reglas", "estado": "info",
        "detalle": (f"{cobertura} % de las reseñas con todas las reglas evaluables; "
                    f"{incompletas:,} con evaluación incompleta (NOT_EVALUABLE)") if evaluadas else "Sin overview",
    })

    estados = {c["id"]: c["estado"] for c in chequeos}
    if "falla" in (estados["run"], estados["quality_gate"]):
        veredicto = "NO_CERTIFICADA"
    elif "sin_datos" in (estados["run"], estados["quality_gate"]):
        veredicto = "NO_VERIFICABLE"
    elif estados["dq_rojo"] == "alerta":
        veredicto = "CON_OBSERVACIONES"
    else:
        veredicto = "CERTIFICADA"
    return {"veredicto": veredicto, "criterio": CRITERIO_CERTIFICACION,
            "cobertura_evaluacion_pct": cobertura, "chequeos": chequeos}


def unir_versiones(reglas: pd.DataFrame, versiones: pd.DataFrame | None) -> pd.DataFrame:
    """REQ-07: agrega a cada regla la versión con la que se evaluó en este run."""
    if versiones is None or versiones.empty:
        return reglas
    return reglas.merge(versiones.drop_duplicates("rule_id"), on="rule_id", how="left")


def _primera(df: pd.DataFrame | None) -> dict | None:
    return salida.registros(df.head(1))[0] if df is not None and len(df) else None


def publicar(datos: dict[str, pd.DataFrame | None], modo: str) -> None:
    overview = datos["overview"]
    if overview.empty:
        raise SystemExit("gld_kpi_trust_safety_overview está vacía: ¿se ejecutó 06_gold_productos?")
    ov = salida.registros(overview.drop(columns=["_gold_loaded_at"], errors="ignore"))[0]
    run = _primera(datos.get("run"))

    queue = datos["queue"].copy()
    queue.insert(1, "user_hash", queue.pop("user_id").map(salida.hash_corto))

    mensual = a_mensual(datos["daily"])
    reglas = unir_versiones(datos["rules"], datos.get("rule_versions"))
    dq_run, vinculo = seleccionar_dq(datos["dq"], (run or {}).get("started_at"))
    dq = resumen_dq(dq_run, vinculo)
    dq["certificacion"] = certificar(run, dq_run, vinculo, ov)

    versiones = {
        "run": run,
        "riesgo": salida.registros(datos["riesgo"]) if datos.get("riesgo") is not None else [],
        "reglas": salida.registros(reglas[[c for c in ("rule_id", "rule_version_id", "rule_version", "rule_status")
                                           if c in reglas]]),
        "dq": dq["ejecuciones"],
    }

    print(f"Escribiendo JSON (modo={modo}, run={ov.get('evaluation_run_id')}):")
    salida.escribir("meta", {
        "modo": modo,
        "generado_en": salida.ahora_iso(),
        "evaluation_run_id": ov.get("evaluation_run_id"),
        "versiones": versiones,
        "parametros": {"top_negocios": TOP_NEGOCIOS, "min_resenas_tasa": MIN_RESENAS_TASA,
                       "meses_negocio": MESES_NEGOCIO, "dias_serie": DIAS_SERIE, "top_cola": TOP_COLA},
        "fuentes": sorted(ESPERADO),
        "nota": "Señales heurísticas y candidatos a investigación. NO representan fraude confirmado.",
    })
    salida.escribir("overview", ov)
    salida.escribir("monthly", mensual)
    salida.escribir("daily", a_diario(datos["daily"]))
    salida.escribir("rules", reglas)
    salida.escribir("businesses", datos["businesses"])
    salida.escribir_o_quitar("business_monthly",
                             a_negocios_mes(datos.get("negocios_mes"), mensual["mes"].max()), compacto=True)
    salida.escribir_o_quitar("rule_cooccurrence",
                             coocurrencia(datos.get("pares"), datos.get("combinaciones"),
                                          list(reglas["rule_id"]), ov.get("reviews_with_signal") or 0))
    salida.escribir("queue", queue)
    salida.escribir("dq", dq)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--demo", action="store_true", help="genera datos sintéticos (sin Databricks)")
    g.add_argument("--verificar", action="store_true", help="solo valida tablas y columnas")
    p.add_argument("--salida", type=Path, help="carpeta de salida (por defecto, la del dashboard)")
    a = p.parse_args()
    if a.salida:
        salida.DATA_DIR = a.salida.resolve()

    if a.demo:
        from yelp_local.demo import datos_gold_demo
        publicar(datos_gold_demo(), modo="demo")
        return

    with conectar() as conn:
        if a.verificar:
            verificar_columnas(conn, ESPERADO)
        else:
            publicar(leer_databricks(conn), modo="databricks")


if __name__ == "__main__":
    main()
