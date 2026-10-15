// Contrato de datos: JSON generados por local/exportar_gold.py y local/ml_anomalias.py

export interface Meta {
  modo: 'demo' | 'databricks';
  generado_en: string;
  evaluation_run_id: string;
  fuentes: string[];
  nota: string;
}

export interface Overview {
  evaluation_run_id: string;
  reviews_evaluated: number;
  reviews_with_signal: number;
  reviews_for_investigation: number;
  reviews_incomplete_evaluation: number;
  priority_p1: number;
  priority_p2: number;
  priority_p3: number;
  signal_rate_pct: number;
  investigation_rate_pct: number;
  avg_weighted_risk_score: number;
  max_weighted_risk_score: number;
}

export interface Monthly {
  mes: string;
  reviews_evaluated: number;
  reviews_with_signal: number;
  reviews_for_investigation: number;
  priority_p1: number;
  signal_rate_pct: number | null;
  investigation_rate_pct: number | null;
  avg_weighted_risk_score: number | null;
}

export interface RuleKpi {
  rule_id: string;
  rule_name: string;
  rule_type: string;
  reviews_evaluated: number;
  signals: number;
  no_signals: number;
  not_evaluable: number;
  signal_rate_pct: number;
  evaluation_coverage_pct: number;
}

export interface BusinessKpi {
  business_id: string;
  business_name: string;
  city: string;
  state: string;
  reviews_evaluated: number;
  reviews_with_signal: number;
  reviews_for_investigation: number;
  priority_p1: number;
  signal_rate_pct: number;
  investigation_rate_pct: number;
  avg_weighted_risk_score: number;
  max_weighted_risk_score: number;
}

export interface QueueItem {
  review_id: string;
  user_hash: string;
  business_name: string;
  city: string;
  review_date: string;
  stars: number;
  text_preview: string;
  signal_count: number;
  signal_rules_csv: string;
  weighted_risk_score: number;
  risk_classification: string;
  investigation_priority: 'P1' | 'P2' | 'P3' | null;
  investigation_status: string;
}

export interface DqRegla {
  capa: string;
  dimension: string;
  regla_id: string;
  descripcion: string | null;
  tabla_objetivo: string;
  columna: string;
  criticidad: string;
  filas_totales: number;
  filas_error: number;
  pct_cumplimiento: number;
  umbral_pct: number;
  paso: boolean;
}

export interface Dq {
  ultima_ejecucion: string | null;
  total_reglas: number;
  reglas_ok: number;
  reglas_en_rojo: number;
  pct_cumplimiento_promedio: number | null;
  por_capa_dimension: { capa: string; dimension: string; reglas: number; en_rojo: number; pct_cumplimiento: number }[];
  reglas: DqRegla[];
}

export type Coincidencia = 'ambos' | 'solo_reglas' | 'solo_ml' | 'ninguno';

export interface MlResumen {
  modo: string;
  modelo: { version: string; algoritmo: string; n_estimators: number; contaminacion: number; features: string[]; entrenado_en: string };
  'reseñas_puntuadas': number;
  anomalias_ml: number;
  marcadas_por_reglas: number;
  matriz: Record<Coincidencia, number>;
  jaccard_ml_reglas: number | null;
  pct_anomalias_con_alguna_senal: number;
  correlacion_spearman_score_vs_riesgo: number | null;
  perfil_features: { feature: string; etiqueta: string; mediana_anomalas: number; mediana_normales: number }[];
  features_mas_frecuentes: { feature: string; etiqueta: string; anomalias: number }[];
  histograma: { bordes: number[]; normales: number[]; anomalas: number[] };
  nota: string;
}

export interface MlTop {
  review_id: string;
  business_name: string | null;
  review_date: string;
  stars: number;
  anomaly_score: number;
  anomaly_percentile: number;
  top_features: string;
  coincidencia: Coincidencia;
  signal_count: number | null;
  signal_rules_csv: string | null;
  weighted_risk_score: number | null;
  investigation_priority: string | null;
}
