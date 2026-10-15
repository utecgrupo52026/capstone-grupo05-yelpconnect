"""
exportar_gold.py — SE EJECUTA EN TU LAPTOP (no en Databricks)

Lee los productos de datos de yelp_gold / yelp_gov a través del SQL Warehouse y
genera los JSON agregados que consume el dashboard Angular (E8_dashboard_bi/web).

Regla E8: el dashboard consume SOLO gold y gov. Este script no toca silver/bronze.
Gobierno: user_id se seudonimiza y el texto de las reseñas se trunca, porque el
sitio publicado en Netlify es público.

Uso:
  python exportar_gold.py              # exporta desde Databricks (requiere .env)
  python exportar_gold.py --verificar  # revisa que las tablas/columnas esperadas existan
  python exportar_gold.py --demo       # datos sintéticos para desarrollar la UI sin Databricks
"""
import argparse

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
        "reviews_for_investigation", "priority_p1", "avg_weighted_risk_score"],
    f"{GOLD}.gld_kpi_trust_safety_rule": [
        "evaluation_run_id", "rule_id", "rule_name", "rule_type", "reviews_evaluated", "signals",
        "no_signals", "not_evaluable", "signal_rate_pct", "evaluation_coverage_pct"],
    f"{GOLD}.gld_kpi_trust_safety_business": [
        "evaluation_run_id", "business_id", "business_name", "city", "state", "reviews_evaluated",
        "reviews_with_signal", "reviews_for_investigation", "priority_p1", "signal_rate_pct",
        "investigation_rate_pct", "avg_weighted_risk_score", "max_weighted_risk_score"],
    f"{GOLD}.gld_investigation_queue": [
        "evaluation_run_id", "review_id", "user_id", "business_name", "city", "review_date", "stars",
        "review_text", "signal_count", "signal_rules_csv", "weighted_risk_score",
        "risk_classification", "investigation_priority", "investigation_status"],
    f"{GOV}.dq_resultados": [
        "ejecucion_id", "ejecucion_ts", "regla_id", "capa", "tabla_objetivo", "columna", "dimension",
        "criticidad", "filas_totales", "filas_error", "pct_cumplimiento", "umbral_pct", "paso"],
    f"{GOV}.dq_reglas": ["regla_id", "descripcion"],
}

# Último run publicado en gold (todas las KPI se filtran por el mismo run)
RUN = (f"(SELECT evaluation_run_id FROM {GOLD}.gld_kpi_trust_safety_overview "
       f"ORDER BY _gold_loaded_at DESC LIMIT 1)")

TOP_NEGOCIOS = 50
TOP_COLA = 200
LARGO_TEXTO = 200


# ---------------------------------------------------------------------------
# Lectura desde Databricks
# ---------------------------------------------------------------------------

def leer_databricks(conn) -> dict[str, pd.DataFrame]:
    q = lambda sql: consultar(conn, sql)
    return {
        "overview": q(f"SELECT * FROM {GOLD}.gld_kpi_trust_safety_overview WHERE evaluation_run_id = {RUN}"),
        "daily": q(f"""
            SELECT review_date, reviews_evaluated, reviews_with_signal, reviews_for_investigation,
                   priority_p1, avg_weighted_risk_score
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
            WHERE evaluation_run_id = {RUN}
            ORDER BY reviews_for_investigation DESC, avg_weighted_risk_score DESC
            LIMIT {TOP_NEGOCIOS}"""),
        "queue": q(f"""
            SELECT review_id, user_id, business_name, city, review_date, stars,
                   left(review_text, {LARGO_TEXTO}) AS text_preview,
                   signal_count, signal_rules_csv, weighted_risk_score,
                   risk_classification, investigation_priority, investigation_status
            FROM {GOLD}.gld_investigation_queue
            WHERE evaluation_run_id = {RUN}
            ORDER BY weighted_risk_score DESC, signal_count DESC
            LIMIT {TOP_COLA}"""),
        # Última ejecución del motor DQ por capa (bronze / silver)
        "dq": q(f"""
            SELECT r.capa, r.dimension, r.regla_id, d.descripcion, r.tabla_objetivo, r.columna,
                   r.criticidad, r.filas_totales, r.filas_error, r.pct_cumplimiento, r.umbral_pct,
                   r.paso, r.ejecucion_ts
            FROM {GOV}.dq_resultados r
            LEFT JOIN {GOV}.dq_reglas d USING (regla_id)
            QUALIFY r.ejecucion_id = first_value(r.ejecucion_id)
                    OVER (PARTITION BY r.capa ORDER BY r.ejecucion_ts DESC)"""),
    }


# ---------------------------------------------------------------------------
# Transformación a JSON (igual para Databricks y demo)
# ---------------------------------------------------------------------------

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
    n = m["reviews_evaluated"].where(m["reviews_evaluated"] > 0)
    m["signal_rate_pct"] = (100 * m["reviews_with_signal"] / n).round(2)
    m["investigation_rate_pct"] = (100 * m["reviews_for_investigation"] / n).round(2)
    m["avg_weighted_risk_score"] = (m.pop("_score_x_n") / n).round(4)
    return m.sort_values("mes")


def resumen_dq(dq: pd.DataFrame) -> dict:
    dq = dq.copy()
    dq["paso"] = dq["paso"].astype(bool)
    por_dim = (dq.groupby(["capa", "dimension"], as_index=False)
                 .agg(reglas=("regla_id", "count"),
                      en_rojo=("paso", lambda s: int((~s).sum())),
                      pct_cumplimiento=("pct_cumplimiento", "mean"))
                 .round({"pct_cumplimiento": 2}))
    return {
        "ultima_ejecucion": salida._limpiar(pd.to_datetime(dq["ejecucion_ts"]).max()) if len(dq) else None,
        "total_reglas": int(len(dq)),
        "reglas_ok": int(dq["paso"].sum()),
        "reglas_en_rojo": int((~dq["paso"]).sum()),
        "pct_cumplimiento_promedio": round(float(dq["pct_cumplimiento"].mean()), 2) if len(dq) else None,
        "por_capa_dimension": salida.registros(por_dim),
        "reglas": salida.registros(dq.drop(columns=["ejecucion_ts"])
                                     .sort_values(["paso", "criticidad", "regla_id"])),
    }


def publicar(datos: dict[str, pd.DataFrame], modo: str) -> None:
    overview = datos["overview"]
    if overview.empty:
        raise SystemExit("gld_kpi_trust_safety_overview está vacía: ¿se ejecutó 06_gold_productos?")
    ov = salida.registros(overview.drop(columns=["_gold_loaded_at"], errors="ignore"))[0]

    queue = datos["queue"].copy()
    queue.insert(1, "user_hash", queue.pop("user_id").map(salida.hash_corto))

    print(f"Escribiendo JSON (modo={modo}, run={ov.get('evaluation_run_id')}):")
    salida.escribir("meta", {
        "modo": modo,
        "generado_en": salida.ahora_iso(),
        "evaluation_run_id": ov.get("evaluation_run_id"),
        "fuentes": sorted(ESPERADO),
        "nota": "Señales heurísticas y candidatos a investigación. NO representan fraude confirmado.",
    })
    salida.escribir("overview", ov)
    salida.escribir("monthly", a_mensual(datos["daily"]))
    salida.escribir("rules", datos["rules"])
    salida.escribir("businesses", datos["businesses"])
    salida.escribir("queue", queue)
    salida.escribir("dq", resumen_dq(datos["dq"]))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--demo", action="store_true", help="genera datos sintéticos (sin Databricks)")
    g.add_argument("--verificar", action="store_true", help="solo valida tablas y columnas")
    a = p.parse_args()

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
