-- Thumbnails (8 Nov 2026): every video has one.
--   finished video: "<JOB> thumbnail.jpg" delivered by Claude in content_final, one uploaded or picked from a frame on the
--   video page, or (when none is given) a frame taken automatically from the finished video.
--   raw takes: a frame of each take, shown with the material.
-- The thumbnail is the cover in the dashboard and is sent with the post to Instagram, Facebook and YouTube.
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT,            -- JPEG on this computer (the dashboard serves it)
  ADD COLUMN IF NOT EXISTS thumbnail_drive_id TEXT,        -- the same image in Drive › content_final
  ADD COLUMN IF NOT EXISTS thumbnail_source TEXT CHECK (thumbnail_source IN ('claude', 'upload', 'frame', 'auto')),
  ADD COLUMN IF NOT EXISTS thumbnail_time NUMERIC(10,2),   -- the video time of the frame, when it is a frame
  ADD COLUMN IF NOT EXISTS thumbnail_updated_at TIMESTAMPTZ;

ALTER TABLE production_files ADD COLUMN IF NOT EXISTS thumb_path TEXT;

ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS thumbnail_status TEXT;   -- set / not set and why

-- every thumbnail file seen in content_final is remembered, so a replaced one is never picked up again
ALTER TABLE production_files DROP CONSTRAINT IF EXISTS production_files_kind_check;
ALTER TABLE production_files ADD CONSTRAINT production_files_kind_check CHECK (kind IN ('take', 'image', 'voiceover', 'suggestion_file', 'final', 'thumbnail'));
