-- Phase 4 (8 Nov 2026): videos are edited by Claude Code from a copied prompt.
--
-- The dashboard no longer edits videos. A video is set up in the dashboard (topic, style, length, format, audio,
-- footage), the dashboard writes the prompt, and the edit happens in a Claude Code chat. The finished video is put in
-- Google Drive › content_final (or uploaded on the video's page); the dashboard picks it up there and publishes it.
--
-- Removed with this migration: the automatic rules editor and renderer, the Claude API director, approvals in the
-- dashboard and by email, and everything they stored.

-- ---------------------------------------------------------------- jobs: new life cycle
ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_status_check;

UPDATE production_jobs SET status = CASE
    WHEN status IN ('publishing', 'published', 'cancelled') THEN status
    WHEN status = 'rejected' THEN 'cancelled'
    WHEN completed_at IS NOT NULL OR final_drive_file_id IS NOT NULL OR status = 'approved' THEN 'completed'
    ELSE 'prompt_ready' END,
  status_detail = NULL, error = NULL;

ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_status_check
  CHECK (status IN ('prompt_ready', 'with_claude', 'completed', 'publishing', 'published', 'cancelled'));
ALTER TABLE production_jobs ALTER COLUMN status SET DEFAULT 'prompt_ready';

-- the style of an older video is the version that was approved
UPDATE production_jobs SET styles = ARRAY[approved_variant]
 WHERE approved_variant IS NOT NULL AND (styles IS NULL OR NOT (approved_variant = ANY(styles)));
UPDATE production_jobs SET styles = styles[1:1] WHERE cardinality(styles) > 1;

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'footage' CHECK (kind IN ('footage', 'voiceover', 'animation')),
  ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb,   -- length_sec, format, storyboard, music, sfx
  ADD COLUMN IF NOT EXISTS prompt_copied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prompt_copies INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_name TEXT,
  ADD COLUMN IF NOT EXISTS final_size BIGINT,
  ADD COLUMN IF NOT EXISTS final_source TEXT,                             -- drive (found in content_final) | upload (uploaded on the video page)
  ADD COLUMN IF NOT EXISTS final_captions JSONB,                          -- read from "<JOB> captions.txt" next to the video
  ADD COLUMN IF NOT EXISTS final_captions_file_id TEXT;

ALTER TABLE production_jobs DROP CONSTRAINT IF EXISTS production_jobs_source_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_source_check CHECK (source IN ('upload', 'drive', 'content_final'));

ALTER TABLE production_jobs
  DROP COLUMN IF EXISTS analysis,
  DROP COLUMN IF EXISTS overrides,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS suggestion_deadline,
  DROP COLUMN IF EXISTS recommended_variant,
  DROP COLUMN IF EXISTS approved_variant,
  DROP COLUMN IF EXISTS approved_by_email,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS director,
  DROP COLUMN IF EXISTS machine_photos,
  DROP COLUMN IF EXISTS machine_id;

CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_final_file ON production_jobs (final_drive_file_id) WHERE final_drive_file_id IS NOT NULL;

-- ---------------------------------------------------------------- files: voiceovers, and a link to each file in Drive
ALTER TABLE production_files DROP CONSTRAINT IF EXISTS production_files_kind_check;
DELETE FROM production_files WHERE kind NOT IN ('take', 'image', 'suggestion_file');
ALTER TABLE production_files ADD CONSTRAINT production_files_kind_check CHECK (kind IN ('take', 'image', 'voiceover', 'suggestion_file', 'final'));   -- final: every finished file seen in content_final
ALTER TABLE production_files ADD COLUMN IF NOT EXISTS drive_link TEXT;

-- suggestions are plain text now (they go into the prompt as written)
ALTER TABLE production_suggestions DROP COLUMN IF EXISTS ops, DROP COLUMN IF EXISTS unhandled;

-- ---------------------------------------------------------------- publishing works from the final video
ALTER TABLE publish_jobs DROP COLUMN IF EXISTS version_id;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------- machines and reference styles: material for Claude
ALTER TABLE machines DROP COLUMN IF EXISTS method;
ALTER TABLE machines DROP COLUMN IF EXISTS cad_path;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS photo_links TEXT[] NOT NULL DEFAULT '{}';   -- Drive links of the photos
UPDATE machines SET status = 'ready', error = NULL, meta = NULL;
ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_status_check;
ALTER TABLE machines DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS error, DROP COLUMN IF EXISTS meta;

ALTER TABLE style_profiles DROP COLUMN IF EXISTS card;
ALTER TABLE style_profiles DROP COLUMN IF EXISTS base;
ALTER TABLE style_profiles DROP COLUMN IF EXISTS params;
ALTER TABLE style_profiles ADD COLUMN IF NOT EXISTS notes TEXT;                  -- what to take from it, in your words
ALTER TABLE style_profiles ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
ALTER TABLE style_profiles ADD COLUMN IF NOT EXISTS drive_link TEXT;

ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS drive_link TEXT;

-- ---------------------------------------------------------------- removed
DROP TABLE IF EXISTS email_replies;
DROP TABLE IF EXISTS email_threads;
DROP TABLE IF EXISTS approval_decisions;
DROP TABLE IF EXISTS production_versions;
DROP TABLE IF EXISTS studio_assets;

DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'studio.approve');
DELETE FROM permissions WHERE code = 'studio.approve';

UPDATE app_settings SET value = (value - 'director' - 'review_mode' - 'approver_emails' - 'suggestion_emails' - 'suggestion_wait_hours'
                                       - 'suggestion_window_hours' - 'approval_rule' - 'variants' - 'auto_publish_after_approval' - 'local_drive')
                                || '{"default_style": "paper_cutout", "default_format": "9:16", "default_length_sec": 30}'::jsonb
 WHERE key = 'studio';
