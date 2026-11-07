-- Phase 3: Claude directs every edit (research, edit plan, 3D assets, storyboard check), styles get a Claude-written
-- style card, machines can be modelled by Claude from photos, and every 3D asset built is kept for later videos.

ALTER TABLE style_profiles ADD COLUMN IF NOT EXISTS card JSONB;

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS director JSONB,            -- progress, research notes, usage and cost, assets built, errors
  ADD COLUMN IF NOT EXISTS machine_photos TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE production_versions
  ADD COLUMN IF NOT EXISTS direction JSONB,           -- what Claude wrote for this version
  ADD COLUMN IF NOT EXISTS planner TEXT;              -- 'claude' or 'rules'

ALTER TABLE machines ADD COLUMN IF NOT EXISTS method TEXT;   -- 'claude' (kit model from photos) or 'relief'

CREATE TABLE IF NOT EXISTS studio_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      TEXT NOT NULL,                        -- the id Claude uses ("transformer")
  name          TEXT NOT NULL,
  spec_key      TEXT NOT NULL UNIQUE,                 -- hash of the spec, so the same model is stored once
  spec_path     TEXT NOT NULL,
  glb_path      TEXT,
  preview_path  TEXT,
  parts         INT NOT NULL DEFAULT 0,
  drive_file_id TEXT,
  source_job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_assets_asset_id ON studio_assets (asset_id, created_at DESC);

ALTER TABLE production_files DROP CONSTRAINT IF EXISTS production_files_kind_check;
ALTER TABLE production_files ADD CONSTRAINT production_files_kind_check CHECK (kind IN ('take','image','brief','script','other','suggestion_file','machine_photo'));

UPDATE app_settings SET value = value || '{"director": {"planner": "claude", "model": "claude-opus-5-5", "helper_model": "claude-sonnet-5-5", "research": true, "check_rounds": 1, "budget_usd": 3}}'::jsonb
 WHERE key = 'studio' AND NOT (value ? 'director');
