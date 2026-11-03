"""
Datos SINTÉTICOS con el mismo contrato que las tablas reales.

Sirven solo para desarrollar y probar el dashboard y el modelo sin conexión a
Databricks. El dashboard muestra un aviso visible cuando meta.modo == "demo".
"""
from collections import Counter

import numpy as np
import pandas as pd

SEMILLA = 42
RUN_ID = "demo-run-0001"
NEGOCIOS = ["Reading Terminal Market", "Pat's King of Steaks", "Geno's Steaks", "Federal Donuts",
            "Zahav", "Talula's Garden", "Dalessandro's", "Barbuzzo", "Morimoto", "Vetri Cucina",
            "Han Dynasty", "Parc", "Suraya", "Sabrina's Cafe", "John's Roast Pork"]
REGLAS = [("R001", "Burst Activity", "behavioral"),
          ("R002", "Rating Deviation", "behavioral_content"),
          ("R003", "Repeated Text", "content"),
          ("R004", "New Account High Activity", "behavioral"),
          ("R005", "User-Business Concentration", "behavioral"),
          ("R006", "Business Review Spike", "temporal")]
PESOS = {"R001": 0.20, "R002": 0.15, "R003": 0.20, "R004": 0.15, "R005": 0.15, "R006": 0.15}
UMBRALES = {"R001": 8.0, "R002": 3.0, "R003": 3.0, "R004": 30.0, "R005": 0.8, "R006": 3.0}
INICIO_RUN = pd.Timestamp("2026-10-09 01:00:00", tz="UTC")


def features_demo(n: int = 40_000) -> pd.DataFrame:
    """Reseñas con features como slv_review_features + resultado de reglas como slv_review_risk."""
    rng = np.random.default_rng(SEMILLA)
    fechas = pd.to_datetime("2015-01-01") + pd.to_timedelta(rng.integers(0, 7 * 365, n), unit="D")
    df = pd.DataFrame({
        "review_id": [f"rv_{i:07d}" for i in range(n)],
        "user_id": [f"us_{i:06d}" for i in rng.integers(0, n // 3, n)],
        "business_id": [f"bz_{i:03d}" for i in rng.integers(0, len(NEGOCIOS), n)],
        "review_date": fechas.date,
        "stars": rng.choice([1, 2, 3, 4, 5], n, p=[.10, .08, .12, .30, .40]),
        "user_reviews_30m": rng.poisson(0.05, n) + 1,
        "user_reviews_1h": rng.poisson(0.1, n) + 1,
        "user_reviews_24h": rng.poisson(0.4, n) + 1,
        "rating_deviation": rng.normal(0, 1.0, n).round(2),
        "text_length": rng.lognormal(6.0, 0.6, n).astype(int),
        "text_repeat_count": np.ones(n, dtype=int),
        "account_age_days": rng.integers(30, 4000, n),
        "user_review_count": rng.geometric(0.08, n),
        "user_business_review_count": rng.geometric(0.85, n),
        "business_spike_ratio": rng.lognormal(0, 0.35, n).round(2),
        "business_day_zscore": rng.normal(0, 1, n).round(2),
        "review_hour": rng.integers(0, 24, n),
    })
    # ~1.5 % de reseñas con patrones anómalos combinados
    idx = rng.choice(n, int(n * 0.015), replace=False)
    df.loc[idx, "user_reviews_30m"] = rng.integers(6, 20, len(idx))
    df.loc[idx, "user_reviews_24h"] = rng.integers(10, 40, len(idx))
    df.loc[idx, "account_age_days"] = rng.integers(0, 25, len(idx))
    df.loc[idx, "text_repeat_count"] = rng.integers(2, 8, len(idx))
    df.loc[idx, "rating_deviation"] = rng.choice([-3.5, 3.2, 3.8], len(idx))
    df.loc[idx, "review_hour"] = rng.integers(1, 5, len(idx))
    df["user_review_count"] = np.maximum(df["user_review_count"], df["user_reviews_24h"])
    df["user_business_review_count"] = np.minimum(df["user_business_review_count"], df["user_review_count"])
    df["user_business_concentration"] = (df["user_business_review_count"] / df["user_review_count"]).round(3)

    # Reglas heurísticas aproximadas (mismos umbrales del catálogo R001–R006)
    s = pd.DataFrame({
        "R001": df["user_reviews_30m"] >= 8,
        "R002": df["rating_deviation"].abs() >= 3,
        "R003": (df["text_repeat_count"] >= 3) & (df["text_length"] >= 40),
        "R004": (df["account_age_days"] <= 30) & (df["user_review_count"] >= 5),
        "R005": (df["user_business_concentration"] >= .8) & (df["user_business_review_count"] >= 3),
        "R006": df["business_spike_ratio"] >= 3,
    })
    df["signal_count"] = s.sum(axis=1)
    df["weighted_risk_score"] = sum(s[r] * w for r, w in PESOS.items()).round(4) / sum(PESOS.values())
    df["signal_rules_csv"] = s.apply(lambda f: ",".join(r for r in s.columns if f[r]), axis=1)
    df["requires_investigation"] = (df["signal_count"] >= 2) | (df["weighted_risk_score"] >= .35)
    df["investigation_priority"] = np.select(
        [(df["signal_count"] >= 3) | (df["weighted_risk_score"] >= .6), df["requires_investigation"]],
        ["P1", "P2"], default=None)
    df.loc[df["requires_investigation"] & df["investigation_priority"].isna(), "investigation_priority"] = "P3"
    df["business_name"] = df["business_id"].map(lambda b: NEGOCIOS[int(b[3:])])
    return df


def datos_gold_demo() -> dict[str, pd.DataFrame]:
    """Arma las mismas tablas KPI que produce 06_gold_productos, a partir de features_demo()."""
    f = features_demo()
    f["con_senal"] = f["signal_count"] > 0
    f["p1"] = f["investigation_priority"] == "P1"
    n = len(f)

    def kpis(g):
        return pd.Series({
            "reviews_evaluated": len(g),
            "reviews_with_signal": int(g["con_senal"].sum()),
            "reviews_for_investigation": int(g["requires_investigation"].sum()),
            "priority_p1": int(g["p1"].sum()),
            "priority_p2": int((g["investigation_priority"] == "P2").sum()),
            "priority_p3": int((g["investigation_priority"] == "P3").sum()),
            "avg_weighted_risk_score": round(g["weighted_risk_score"].mean(), 4),
            "max_weighted_risk_score": round(g["weighted_risk_score"].max(), 4),
        }, dtype=object)

    ov = kpis(f).to_dict()
    ov.update(evaluation_run_id=RUN_ID, reviews_incomplete_evaluation=int(n * 0.004),
              signal_rate_pct=round(100 * ov["reviews_with_signal"] / n, 2),
              investigation_rate_pct=round(100 * ov["reviews_for_investigation"] / n, 2))

    daily = f.groupby("review_date").apply(kpis, include_groups=False).reset_index()

    biz = f.groupby(["business_id", "business_name"]).apply(kpis, include_groups=False).reset_index()
    biz["city"], biz["state"] = "Philadelphia", "PA"
    biz["signal_rate_pct"] = (100 * biz["reviews_with_signal"] / biz["reviews_evaluated"]).round(2)
    biz["investigation_rate_pct"] = (100 * biz["reviews_for_investigation"] / biz["reviews_evaluated"]).round(2)
    biz = biz.sort_values("reviews_for_investigation", ascending=False)

    reglas = []
    for rid, nombre, tipo in REGLAS:
        senales = int(f["signal_rules_csv"].str.contains(rid).sum())
        no_eval = int(n * 0.003) if rid in ("R004", "R005") else 0
        reglas.append({"rule_id": rid, "rule_name": nombre, "rule_type": tipo, "reviews_evaluated": n,
                       "signals": senales, "no_signals": n - senales - no_eval, "not_evaluable": no_eval,
                       "signal_rate_pct": round(100 * senales / (n - no_eval), 3),
                       "evaluation_coverage_pct": round(100 * (n - no_eval) / n, 2)})

    rng = np.random.default_rng(SEMILLA)
    cola = f[f["requires_investigation"]].nlargest(200, ["weighted_risk_score", "signal_count"]).copy()
    cola["city"] = "Philadelphia"
    cola["text_preview"] = "[texto sintético de demostración] Great place, amazing food, best in town!"
    cola["risk_classification"] = np.where(cola["weighted_risk_score"] >= .6, "HIGH", "MEDIUM")
    cola["investigation_status"] = rng.choice(["PENDING", "IN_REVIEW"], len(cola), p=[.8, .2])

    # Bitácora DQ: una ejecución por capa antes del run y una de silver DESPUÉS del run (con una
    # regla crítica en rojo). seleccionar_dq() debe ignorar esta última al certificar la corrida.
    dims = ["completitud", "unicidad", "validez", "consistencia", "integridad"]
    dq = []
    ejecuciones = [("bronze", "dq-demo-bronze-01", INICIO_RUN - pd.Timedelta(hours=4)),
                   ("silver", "dq-demo-silver-01", INICIO_RUN - pd.Timedelta(hours=3)),
                   ("silver", "dq-demo-silver-02", INICIO_RUN + pd.Timedelta(days=3))]
    for capa, ej_id, ts in ejecuciones:
        posterior = ts > INICIO_RUN
        for i, dim in enumerate(dims * 3):
            pct = float(np.clip(rng.normal(99.2, 1.2), 90, 100))
            umbral = 98.0 if i % 3 else 95.0
            if posterior and i == 0:
                pct = 80.0
            dq.append({"ejecucion_id": ej_id, "capa": capa, "dimension": dim,
                       "regla_id": f"DQ-{capa[0].upper()}-{i + 1:03d}",
                       "descripcion": f"Regla demo de {dim}", "tabla_objetivo": f"workspace.yelp_{capa}.demo",
                       "columna": "*", "criticidad": ["alta", "media", "baja"][i % 3],
                       "filas_totales": n, "filas_error": int(n * (100 - pct) / 100),
                       "pct_cumplimiento": round(pct, 2), "umbral_pct": umbral, "paso": pct >= umbral,
                       "ejecucion_ts": ts})

    # REQ-01: evolución mensual por negocio (misma ventana que la consulta real)
    f["mes"] = pd.to_datetime(f["review_date"]).dt.strftime("%Y-%m")
    desde = str(pd.Period(f["mes"].max(), "M") - 35)
    negocios_mes = (f[f["mes"] >= desde]
                    .groupby(["business_id", "mes"], as_index=False)
                    .agg(reviews_evaluated=("review_id", "size"),
                         reviews_with_signal=("con_senal", "sum"),
                         reviews_for_investigation=("requires_investigation", "sum")))

    # REQ-04: pares de reglas en la misma reseña y combinaciones exactas
    pares, combos, combos_inv = Counter(), Counter(), Counter()
    con_senal = f[f["con_senal"]]
    for csv, inv in zip(con_senal["signal_rules_csv"], con_senal["requires_investigation"]):
        rs = sorted(csv.split(","))
        combos[" + ".join(rs)] += 1
        combos_inv[" + ".join(rs)] += int(inv)
        for i, a in enumerate(rs):
            for b in rs[i:]:
                pares[(a, b)] += 1
    pares_df = pd.DataFrame([(a, b, c) for (a, b), c in pares.items()], columns=["regla_a", "regla_b", "reviews"])
    combos_df = pd.DataFrame([(k, k.count("+") + 1, c, combos_inv[k]) for k, c in combos.most_common(15)],
                             columns=["combinacion", "n_reglas", "reviews", "reviews_for_investigation"])

    # REQ-06 / REQ-07: run y versiones
    run = pd.DataFrame([{"evaluation_run_id": RUN_ID, "pipeline_name": "03_trust_safety_evaluacion",
                         "pipeline_version": "3.0.0", "dataset_version": "demo-features-0001",
                         "started_at": INICIO_RUN, "finished_at": INICIO_RUN + pd.Timedelta(minutes=18),
                         "execution_status": "SUCCESS"}])
    versiones = pd.DataFrame([{"rule_id": rid, "rule_version_id": f"{rid}-v1.0", "rule_version": "1.0",
                               "threshold": UMBRALES[rid], "weight": PESOS[rid], "rule_status": "ACTIVE",
                               "valid_from": pd.Timestamp("2026-09-01", tz="UTC")} for rid, _, _ in REGLAS])
    riesgo = pd.DataFrame([{"risk_model_version": "1.0.0", "feature_execution_id": "demo-features-0001",
                            "risk_consolidation_id": "demo-risk-0001", "reviews": n}])

    return {
        "overview": pd.DataFrame([ov]),
        "daily": daily,
        "rules": pd.DataFrame(reglas),
        "businesses": biz.head(50),
        "queue": cola[["review_id", "user_id", "business_name", "city", "review_date", "stars", "text_preview",
                       "signal_count", "signal_rules_csv", "weighted_risk_score", "risk_classification",
                       "investigation_priority", "investigation_status"]],
        "dq": pd.DataFrame(dq),
        "run": run,
        "rule_versions": versiones,
        "riesgo": riesgo,
        "negocios_mes": negocios_mes,
        "pares": pares_df,
        "combinaciones": combos_df,
    }
