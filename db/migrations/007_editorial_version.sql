-- Version E: editorial cut (full-screen cutaways, kinetic captions, sound design)
ALTER TABLE production_versions DROP CONSTRAINT IF EXISTS production_versions_variant_check;
ALTER TABLE production_versions ADD CONSTRAINT production_versions_variant_check CHECK (variant IN ('clean','branded','motion','overlay','editorial'));
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_recommended_variant_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_recommended_variant_check CHECK (recommended_variant IN ('clean','branded','motion','overlay','editorial'));
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_approved_variant_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_approved_variant_check CHECK (approved_variant IN ('clean','branded','motion','overlay','editorial'));
ALTER TABLE approval_decisions DROP CONSTRAINT IF EXISTS approval_decisions_variant_check;
ALTER TABLE approval_decisions ADD CONSTRAINT approval_decisions_variant_check CHECK (variant IN ('clean','branded','motion','overlay','editorial'));
UPDATE app_settings SET value = jsonb_set(value, '{variants}', '["clean","branded","motion","overlay","editorial"]'::jsonb)
 WHERE key = 'studio' AND NOT (value->'variants') @> '["editorial"]'::jsonb;
