-- ============================================================
-- E6.3 · CLASIFICACIÓN Y SEGURIDAD - UNITY CATALOG
-- ============================================================
-- Objetivo:
-- Clasificar activos y columnas de acuerdo con su sensibilidad.
--
-- Alcance:
-- Silver Review
-- Gold Investigation Queue
-- Gold Review Risk
--
-- Este notebook NO transforma datos.
-- Solo administra metadata de gobierno en Unity Catalog.
-- ============================================================

-- ============================================================

-- CLASIFICACIÓN SILVER

-- ============================================================
 
ALTER TABLE workspace.yelp_silver.slv_review

SET TAGS (

  'data_domain' = 'trust_safety',

  'data_layer'  = 'silver'

);
 
ALTER TABLE workspace.yelp_silver.slv_review

ALTER COLUMN user_id

SET TAGS ('classification' = 'restricted');
 
ALTER TABLE workspace.yelp_silver.slv_review

ALTER COLUMN review_text

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_silver.slv_review

ALTER COLUMN review_id

SET TAGS ('classification' = 'internal');
 
ALTER TABLE workspace.yelp_silver.slv_review

ALTER COLUMN business_id

SET TAGS ('classification' = 'internal');
 
-- ============================================================

-- CLASIFICACIÓN GOLD - COLA DE INVESTIGACIÓN

-- ============================================================
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

SET TAGS (

  'data_domain' = 'trust_safety',

  'data_layer'  = 'gold',

  'data_product' = 'investigation_queue'

);
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN user_id

SET TAGS ('classification' = 'restricted');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN user_sk

SET TAGS ('classification' = 'restricted');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN review_text

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN signal_rules

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN weighted_risk_score

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN risk_classification

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_investigation_queue

ALTER COLUMN investigation_priority

SET TAGS ('classification' = 'confidential');
 
-- ============================================================

-- CLASIFICACIÓN GOLD - REVIEW RISK

-- ============================================================
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

SET TAGS (

  'data_domain' = 'trust_safety',

  'data_layer'  = 'gold',

  'data_product' = 'review_risk'

);
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

ALTER COLUMN user_id

SET TAGS ('classification' = 'restricted');
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

ALTER COLUMN signal_rules

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

ALTER COLUMN weighted_risk_score

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

ALTER COLUMN risk_classification

SET TAGS ('classification' = 'confidential');
 
ALTER TABLE workspace.yelp_gold.gld_review_risk

ALTER COLUMN investigation_priority

SET TAGS ('classification' = 'confidential');
