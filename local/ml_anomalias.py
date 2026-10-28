"""
ml_anomalias.py — SE EJECUTA EN TU LAPTOP (no en Databricks)

Detección NO supervisada de reseñas anómalas con Isolation Forest, como
complemento de las reglas heurísticas R001–R006 de Trust & Safety.

¿Por qué no supervisado? No existen etiquetas de fraude confirmado: entrenar un
clasificador con las salidas de las reglas solo aprendería a imitarlas. Isolation
Forest aprende qué es "normal" y puntúa lo que se aleja, sin necesitar etiquetas.
El resultado son CANDIDATOS a revisión, no fraude confirmado.

Entradas (silver certificada, misma corrida que gold):
  workspace.yelp_silver.slv_review_features   → variables del modelo
  workspace.yelp_silver.slv_review_risk       → resultado de las reglas (para comparar)
Salidas:
  E8_dashboard_bi/web/public/data/ml_resumen.json, ml_top.json  → dashboard
  local/salidas/gld_review_anomaly_ml.parquet                    → scoring completo
  --publicar: workspace.yelp_gold.gld_review_anomaly_ml          → tabla gobernada en UC

Uso:
  python ml_anomalias.py --demo          # datos sintéticos
  python ml_anomalias.py --verificar     # valida tablas/columnas en Databricks
  python ml_anomalias.py                 # entrena y puntúa con datos reales
  python ml_anomalias.py --publicar      # además publica la tabla gold en Databricks
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from yelp_local import salida
from yelp_local.db import GOLD, SILVER, conectar, consultar, ejecutar, verificar_columnas

MODELO_VERSION = "iforest-v1.0"
CONTAMINACION = 0.01          # se espera ~1 % de reseñas anómalas
SEMILLA = 42
TOP_N = 100

# Variables de comportamiento ya calculadas en 03_feature_engineering_ts
FEATURES = [
    "user_reviews_30m", "user_reviews_1h", "user_reviews_24h",      # ráfagas del usuario
    "rating_deviation",                                              # desvío vs rating del negocio
    "text_length", "text_repeat_count",                              # contenido
    "account_age_days", "user_review_count",                         # perfil de la cuenta
    "user_business_review_count", "user_business_concentration",     # concentración en un negocio
    "business_spike_ratio", "business_day_zscore",                   # picos del negocio
    "review_hour",
]
# Conteos muy sesgados: se comprimen con log1p para que no dominen el árbol
LOG1P = ["user_reviews_30m", "user_reviews_1h", "user_reviews_24h", "text_length", "text_repeat_count",
         "account_age_days", "user_review_count", "user_business_review_count"]

ETIQUETAS = {
    "user_reviews_30m": "Reseñas del usuario en 30 min", "user_reviews_1h": "Reseñas del usuario en 1 h",
    "user_reviews_24h": "Reseñas del usuario en 24 h", "rating_deviation": "Desvío de rating",
    "text_length": "Largo del texto", "text_repeat_count": "Texto repetido",
    "account_age_days": "Antigüedad de la cuenta", "user_review_count": "Reseñas totales del usuario",
    "user_business_review_count": "Reseñas al mismo negocio",
    "user_business_concentration": "Concentración en un negocio",
    "business_spike_ratio": "Pico diario del negocio", "business_day_zscore": "Z-score diario del negocio",
    "review_hour": "Hora de publicación",
}

SALIDAS = Path(__file__).resolve().parent / "salidas"
VOLUME = f"/Volumes/workspace/yelp_gold/ml_artefactos"

ESPERADO = {
    f"{SILVER}.slv_review_features": ["review_id", "business_id", "stars", "review_date",
                                      "feature_execution_id", "feature_processed_at", *FEATURES],
    f"{SILVER}.slv_review_risk": ["review_id", "evaluation_run_id", "signal_count", "signal_rules",
                                  "weighted_risk_score", "requires_investigation", "investigation_priority"],
    f"{GOLD}.gld_dim_business": ["business_id", "business_name"],
}


# ---------------------------------------------------------------------------
# Datos
# ---------------------------------------------------------------------------

def leer_databricks(conn) -> pd.DataFrame:
    cols = ", ".join(f"f.{c}" for c in FEATURES)
    # Se toma la última ejecución de features y la misma corrida de reglas publicada en gold
    return consultar(conn, f"""
        SELECT f.review_id, f.business_id, b.business_name, f.stars, f.review_date, {cols},
               r.signal_count, array_join(r.signal_rules, ',') AS signal_rules_csv, r.weighted_risk_score,
               r.requires_investigation, r.investigation_priority
        FROM {SILVER}.slv_review_features f
        LEFT JOIN {SILVER}.slv_review_risk r
               ON r.review_id = f.review_id
              AND r.evaluation_run_id = (SELECT evaluation_run_id FROM {GOLD}.gld_kpi_trust_safety_overview
                                         ORDER BY _gold_loaded_at DESC LIMIT 1)
        LEFT JOIN {GOLD}.gld_dim_business b ON b.business_id = f.business_id
        WHERE f.feature_execution_id = (SELECT feature_execution_id FROM {SILVER}.slv_review_features
                                        ORDER BY feature_processed_at DESC LIMIT 1)
    """)


def preparar(df: pd.DataFrame) -> pd.DataFrame:
    X = df[FEATURES].apply(pd.to_numeric, errors="coerce").astype(float)
    X["rating_deviation"] = X["rating_deviation"].abs()      # importa la magnitud, no el signo
    X[LOG1P] = np.log1p(X[LOG1P].clip(lower=0))
    return X.fillna(X.median())


# ---------------------------------------------------------------------------
# Modelo
# ---------------------------------------------------------------------------

def puntuar(df: pd.DataFrame) -> tuple[pd.DataFrame, IsolationForest]:
    X = preparar(df)
    modelo = IsolationForest(n_estimators=300, contamination=CONTAMINACION,
                             random_state=SEMILLA, n_jobs=-1).fit(X)

    r = df.copy()
    r["anomaly_score"] = (-modelo.score_samples(X)).round(5)          # mayor = más anómala
    r["anomaly_percentile"] = (r["anomaly_score"].rank(pct=True) * 100).round(2)
    r["is_anomaly_ml"] = modelo.predict(X) == -1

    # Explicación simple: las 3 variables más alejadas de la mediana (z robusto)
    iqr = (X.quantile(.75) - X.quantile(.25)).replace(0, np.nan)
    z = ((X - X.median()) / iqr).abs().fillna(0)
    top = np.argsort(-z.to_numpy(), axis=1)[:, :3]
    r["top_features"] = [",".join(FEATURES[i] for i in fila) for fila in top]

    r["flag_reglas"] = r["requires_investigation"].fillna(False).astype(bool)
    r["coincidencia"] = np.select(
        [r["is_anomaly_ml"] & r["flag_reglas"], r["flag_reglas"], r["is_anomaly_ml"]],
        ["ambos", "solo_reglas", "solo_ml"], default="ninguno")
    return r, modelo


def resumir(r: pd.DataFrame, modelo: IsolationForest) -> dict:
    n = len(r)
    cuenta = r["coincidencia"].value_counts().reindex(["ambos", "solo_reglas", "solo_ml", "ninguno"],
                                                       fill_value=0)
    ml = r["is_anomaly_ml"]
    con_senal = r["signal_count"].fillna(0) > 0
    union = int((ml | r["flag_reglas"]).sum())

    # Perfil: mediana de cada variable original en anomalías vs resto
    perfil = [{"feature": f, "etiqueta": ETIQUETAS[f],
               "mediana_anomalas": float(r.loc[ml, f].median()), "mediana_normales": float(r.loc[~ml, f].median())}
              for f in FEATURES]

    # Distribución del score por grupo (histograma común)
    bordes = np.linspace(r["anomaly_score"].min(), r["anomaly_score"].max(), 26)
    hist = lambda m: np.histogram(r.loc[m, "anomaly_score"], bins=bordes)[0].tolist()

    frec_top = (r.loc[ml, "top_features"].str.split(",").explode().value_counts())
    return {
        "modelo": {"version": MODELO_VERSION, "algoritmo": "IsolationForest", "n_estimators": modelo.n_estimators,
                   "contaminacion": CONTAMINACION, "semilla": SEMILLA, "features": FEATURES,
                   "entrenado_en": salida.ahora_iso()},
        "reseñas_puntuadas": n,
        "anomalias_ml": int(ml.sum()),
        "marcadas_por_reglas": int(r["flag_reglas"].sum()),
        "matriz": {k: int(v) for k, v in cuenta.items()},
        "jaccard_ml_reglas": round(cuenta["ambos"] / union, 4) if union else None,
        "pct_anomalias_con_alguna_senal": round(100 * float((ml & con_senal).sum()) / max(int(ml.sum()), 1), 2),
        "correlacion_spearman_score_vs_riesgo": round(float(
            r["anomaly_score"].corr(r["weighted_risk_score"], method="spearman")), 4)
            if r["weighted_risk_score"].notna().any() else None,
        "perfil_features": perfil,
        "features_mas_frecuentes": [{"feature": f, "etiqueta": ETIQUETAS[f], "anomalias": int(c)}
                                    for f, c in frec_top.items()],
        "histograma": {"bordes": [round(b, 4) for b in bordes.tolist()],
                       "normales": hist(~ml), "anomalas": hist(ml)},
        "nota": "Candidatos a revisión generados por un modelo no supervisado. NO representan fraude confirmado.",
    }


def top_anomalias(r: pd.DataFrame) -> pd.DataFrame:
    cols = ["review_id", "business_name", "review_date", "stars", "anomaly_score", "anomaly_percentile",
            "top_features", "coincidencia", "signal_count", "signal_rules_csv", "weighted_risk_score",
            "investigation_priority"]
    return r[r["is_anomaly_ml"]].nlargest(TOP_N, "anomaly_score")[cols]


# ---------------------------------------------------------------------------
# Publicación en Databricks (opcional)
# ---------------------------------------------------------------------------

def tabla_salida(r: pd.DataFrame) -> pd.DataFrame:
    t = r[["review_id", "business_id", "anomaly_score", "anomaly_percentile", "is_anomaly_ml", "top_features",
           "flag_reglas", "weighted_risk_score", "coincidencia"]].rename(
        columns={"flag_reglas": "requires_investigation_reglas"})
    t["model_version"] = MODELO_VERSION
    t["scored_at"] = pd.Timestamp.now(tz="UTC")
    return t


def publicar_tabla(parquet: Path) -> None:
    destino = f"{VOLUME}/{parquet.name}"
    with conectar(staging_dir=str(parquet.parent)) as conn:
        ejecutar(conn, "CREATE VOLUME IF NOT EXISTS workspace.yelp_gold.ml_artefactos "
                       "COMMENT 'Artefactos de ML generados fuera del workspace (scoring de anomalías)'")
        ejecutar(conn, f"PUT '{parquet.as_posix()}' INTO '{destino}' OVERWRITE")
        ejecutar(conn, f"""
            CREATE OR REPLACE TABLE {GOLD}.gld_review_anomaly_ml
            COMMENT 'Scoring no supervisado (Isolation Forest {MODELO_VERSION}) de reseñas. Complementa las reglas \
T&S R001–R006. Candidatos a revisión, NO fraude confirmado. Consumidor: Trust & Safety.'
            AS SELECT * FROM read_files('{destino}', format => 'parquet')""")
    print(f"  → publicado {GOLD}.gld_review_anomaly_ml")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--demo", action="store_true", help="usa datos sintéticos (sin Databricks)")
    g.add_argument("--verificar", action="store_true", help="solo valida tablas y columnas")
    p.add_argument("--publicar", action="store_true", help="sube el scoring como tabla gold en Databricks")
    a = p.parse_args()
    if a.publicar and a.demo:
        p.error("--publicar no se permite con --demo (no se suben datos sintéticos a gold)")

    if a.verificar:
        with conectar() as conn:
            verificar_columnas(conn, ESPERADO)
        return

    if a.demo:
        from yelp_local.demo import features_demo
        df = features_demo()
    else:
        with conectar() as conn:
            df = leer_databricks(conn)
    print(f"Reseñas leídas: {len(df):,}")

    r, modelo = puntuar(df)
    res = resumir(r, modelo)
    res["modo"] = "demo" if a.demo else "databricks"
    print(json.dumps({k: res[k] for k in ("anomalias_ml", "marcadas_por_reglas", "matriz", "jaccard_ml_reglas",
                                          "correlacion_spearman_score_vs_riesgo")}, indent=1))

    salida.escribir("ml_resumen", res)
    salida.escribir("ml_top", top_anomalias(r))

    SALIDAS.mkdir(exist_ok=True)
    parquet = SALIDAS / "gld_review_anomaly_ml.parquet"
    tabla_salida(r).to_parquet(parquet, index=False)
    print(f"  → {parquet}")

    if a.publicar:
        publicar_tabla(parquet)


if __name__ == "__main__":
    main()
