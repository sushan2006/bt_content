-- Engine v2: every finding carries a plain-language story for non-specialists,
-- with the statistics kept separately as "evidence".
ALTER TABLE ai_insights
  ADD COLUMN IF NOT EXISTS headline   TEXT,
  ADD COLUMN IF NOT EXISTS story      JSONB,      -- {what_happened, why, what_to_do, how_sure, impact}
  ADD COLUMN IF NOT EXISTS certainty  TEXT,       -- 'strong evidence' | 'good evidence' | 'early signal' | 'not enough data'
  ADD COLUMN IF NOT EXISTS audience   TEXT NOT NULL DEFAULT 'all',  -- all | creative | management
  ADD COLUMN IF NOT EXISTS rank_score NUMERIC;    -- ordering by expected business impact

-- Executive brief generated with each intelligence run
CREATE TABLE IF NOT EXISTS ai_briefs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL,
  data_origin TEXT NOT NULL DEFAULT 'live',
  brief       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_briefs_origin ON ai_briefs(data_origin, created_at DESC);

-- Per-video diagnostics (curve shape, expected vs actual, grade) cached per run
CREATE TABLE IF NOT EXISTS video_diagnostics (
  publication_id UUID PRIMARY KEY REFERENCES platform_publications(id) ON DELETE CASCADE,
  run_id         UUID NOT NULL,
  grade          TEXT,
  diagnostics    JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
