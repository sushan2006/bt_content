-- Editing styles (built-in + learned from reference videos), the machine library, and the Drive
-- content_raw -> content_midway -> suggestions -> content_final flow.

-- Versions are now named by style, so the fixed list of variants goes away.
ALTER TABLE production_versions DROP CONSTRAINT IF EXISTS production_versions_variant_check;
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_recommended_variant_check;
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_approved_variant_check;
ALTER TABLE approval_decisions DROP CONSTRAINT IF EXISTS approval_decisions_variant_check;

CREATE TABLE IF NOT EXISTS style_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  base         TEXT NOT NULL DEFAULT 'explainer3d',
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  report       JSONB NOT NULL DEFAULT '[]'::jsonb,
  measured     JSONB,
  summary      TEXT,
  source_name  TEXT,
  source_path  TEXT,
  status       TEXT NOT NULL DEFAULT 'analysing' CHECK (status IN ('analysing','ready','failed')),
  error        TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  tagline      TEXT,
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  photos       TEXT[] NOT NULL DEFAULT '{}',
  cad_path     TEXT,
  meta         JSONB,
  status       TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','ready','failed')),
  error        TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS styles TEXT[],
  ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drive_midway_folder TEXT,
  ADD COLUMN IF NOT EXISTS final_drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS final_drive_link TEXT,
  ADD COLUMN IF NOT EXISTS final_path TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE production_versions ADD COLUMN IF NOT EXISTS style_id UUID REFERENCES style_profiles(id) ON DELETE SET NULL;

-- The 3D explainer (the approved editorial cut) plus the three new styles become the default set.
UPDATE app_settings SET value = jsonb_set(value, '{variants}', '["editorial","hype","cinematic","minimal"]'::jsonb)
 WHERE key = 'studio' AND NOT (value->'variants') @> '["hype"]'::jsonb;

-- suggestions can also arrive as a text file in the Drive "suggestions" folder
ALTER TABLE production_suggestions DROP CONSTRAINT IF EXISTS production_suggestions_source_check;
ALTER TABLE production_suggestions ADD CONSTRAINT production_suggestions_source_check CHECK (source IN ('email','app','drive'));
ALTER TABLE production_files DROP CONSTRAINT IF EXISTS production_files_kind_check;
ALTER TABLE production_files ADD CONSTRAINT production_files_kind_check CHECK (kind IN ('take','image','brief','script','other','suggestion_file'));
