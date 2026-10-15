"""
Datos SINTÉTICOS con el mismo contrato que las tablas reales.

Sirven solo para desarrollar y probar el dashboard y el modelo sin conexión a
Databricks. El dashboard muestra un aviso visible cuando meta.modo == "demo".
"""
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

    dims = ["completitud", "unicidad", "validez", "consistencia", "integridad"]
    dq = []
    for capa in ("bronze", "silver"):
        for i, dim in enumerate(dims * 3):
            pct = float(np.clip(rng.normal(99.2, 1.2), 90, 100))
            umbral = 98.0 if i % 3 else 95.0
            dq.append({"capa": capa, "dimension": dim, "regla_id": f"DQ-{len(dq) + 1:03d}",
                       "descripcion": f"Regla demo de {dim}", "tabla_objetivo": f"workspace.yelp_{capa}.demo",
                       "columna": "*", "criticidad": ["alta", "media", "baja"][i % 3],
                       "filas_totales": n, "filas_error": int(n * (100 - pct) / 100),
                       "pct_cumplimiento": round(pct, 2), "umbral_pct": umbral, "paso": pct >= umbral,
                       "ejecucion_ts": pd.Timestamp("2026-10-08 22:00:00")})

    return {
        "overview": pd.DataFrame([ov]),
        "daily": daily,
        "rules": pd.DataFrame(reglas),
        "businesses": biz.head(50),
        "queue": cola[["review_id", "user_id", "business_name", "city", "review_date", "stars", "text_preview",
                       "signal_count", "signal_rules_csv", "weighted_risk_score", "risk_classification",
                       "investigation_priority", "investigation_status"]],
        "dq": pd.DataFrame(dq),
    }
