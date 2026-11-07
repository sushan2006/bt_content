-- Phase 2: Content Studio (takes -> edited versions -> email approval -> publishing)

INSERT INTO permissions (code, description) VALUES
 ('studio.view', 'View production jobs, edits and approvals'),
 ('studio.manage', 'Create production jobs, upload takes, change edits, render and publish'),
 ('studio.approve', 'Approve or reject videos for publishing inside the app')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE p.code IN ('studio.view','studio.manage','studio.approve') AND r.code IN ('admin','marketing_manager') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE p.code IN ('studio.view','studio.manage') AND r.code = 'content_creator' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p
 WHERE p.code = 'studio.view' AND r.code = 'viewer' ON CONFLICT DO NOTHING;

-- Google account used for Drive (footage in, renders out) and Gmail (suggestion + approval emails).
-- Separate from the YouTube connection: the channel owner and the mailbox are often different accounts.
CREATE TABLE workspace_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL DEFAULT 'google',
  email             TEXT NOT NULL,
  display_name      TEXT,
  encrypted_refresh TEXT,
  encrypted_access  TEXT,
  access_expires_at TIMESTAMPTZ,
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','token_expired','disconnected')),
  last_error        TEXT,
  folders           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {root, raw, working, pending, approved, published, brand, music, references}
  last_scan_at      TIMESTAMPTZ,
  connected_by      UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, email)
);

-- Licensed music only: a track without licence proof cannot be selected.
CREATE TABLE music_tracks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT NOT NULL,
  artist                TEXT,
  source                TEXT NOT NULL CHECK (source IN ('pixabay','youtube_audio_library','meta_sound_collection','uppbeat','epidemic_sound','artlist','own','other')),
  storage_path          TEXT NOT NULL,
  license_path          TEXT,
  license_note          TEXT,
  source_url            TEXT,
  content_id_registered BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_platforms     TEXT[] NOT NULL DEFAULT '{instagram,facebook,youtube}',
  mood                  TEXT,
  duration_sec          NUMERIC(10,2),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  added_by              UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE production_code_seq START 1;

CREATE TABLE production_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE DEFAULT ('JOB-' || lpad(nextval('production_code_seq')::text, 3, '0')),
  content_item_id     UUID REFERENCES content_items(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  brief               JSONB NOT NULL DEFAULT '{}'::jsonb,   -- headline, script, speaker, keywords, cta, hashtags, notes
  source              TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','drive')),
  drive_folder_id     TEXT,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','waiting_suggestions','analyzing','planning','rendering','in_review',
                         'changes_requested','approved','publishing','published','rejected','failed','cancelled')),
  status_detail       TEXT,
  error               TEXT,
  analysis            JSONB,                                -- takes + chosen lines (from the studio service)
  overrides           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- accumulated change-request operations
  revision            INT NOT NULL DEFAULT 1,
  suggestion_deadline TIMESTAMPTZ,
  platforms           TEXT[] NOT NULL DEFAULT '{instagram,facebook,youtube}',
  recommended_variant TEXT NOT NULL DEFAULT 'motion' CHECK (recommended_variant IN ('clean','branded','motion')),
  approved_variant    TEXT CHECK (approved_variant IN ('clean','branded','motion')),
  approved_by_email   TEXT,
  approved_at         TIMESTAMPTZ,
  publish_at          TIMESTAMPTZ,
  music_track_id      UUID REFERENCES music_tracks(id) ON DELETE SET NULL,
  data_origin         TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prod_jobs_status ON production_jobs(status, updated_at DESC);

CREATE TABLE production_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('take','image','brief','script','other')),
  take_id       TEXT,                                   -- T1, T2, T3 for takes
  name          TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  drive_file_id TEXT,
  md5           TEXT,
  size_bytes    BIGINT,
  duration_sec  NUMERIC(10,3),
  width         INT,
  height        INT,
  tags          TEXT[] NOT NULL DEFAULT '{}',          -- for images: words that trigger the picture
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, storage_path)
);

CREATE TABLE production_suggestions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  from_email  TEXT NOT NULL,
  text        TEXT NOT NULL,
  ops         JSONB NOT NULL DEFAULT '[]'::jsonb,
  unhandled   TEXT[] NOT NULL DEFAULT '{}',
  is_none     BOOLEAN NOT NULL DEFAULT FALSE,          -- "no suggestions"
  source      TEXT NOT NULL DEFAULT 'email' CHECK (source IN ('email','app')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One rendered version = variant x aspect x revision
CREATE TABLE production_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  revision       INT NOT NULL,
  variant        TEXT NOT NULL CHECK (variant IN ('clean','branded','motion')),
  aspect         TEXT NOT NULL DEFAULT '9:16' CHECK (aspect IN ('9:16','16:9')),
  label          TEXT NOT NULL,                        -- A / B / C
  plan           JSONB NOT NULL,
  summary        JSONB,
  notes          TEXT[] NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','rendering','ready','failed')),
  render_task_id TEXT,
  output_path    TEXT,
  previews       TEXT[] NOT NULL DEFAULT '{}',
  qc             JSONB,
  drive_file_id  TEXT,
  drive_link     TEXT,
  render_seconds NUMERIC(10,1),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, revision, variant, aspect)
);

CREATE TABLE email_threads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('suggestions','approval','info')),
  revision         INT,
  to_emails        TEXT[] NOT NULL,
  subject          TEXT NOT NULL,
  gmail_thread_id  TEXT,
  gmail_message_id TEXT,
  rfc_message_id   TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed','failed','not_sent')),
  error            TEXT,
  sent_at          TIMESTAMPTZ,
  last_checked_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_threads_open ON email_threads(status) WHERE status = 'open';

CREATE TABLE email_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id TEXT UNIQUE,
  from_email       TEXT NOT NULL,
  body             TEXT NOT NULL,
  classification   JSONB,
  handled          BOOLEAN NOT NULL DEFAULT FALSE,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval_decisions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  revision   INT NOT NULL,
  decision   TEXT NOT NULL CHECK (decision IN ('approve','reject','changes')),
  variant    TEXT CHECK (variant IN ('clean','branded','motion')),
  by_email   TEXT,
  by_user    UUID REFERENCES users(id),
  via        TEXT NOT NULL CHECK (via IN ('email','app')),
  note       TEXT,
  ops        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE publish_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  version_id        UUID NOT NULL REFERENCES production_versions(id) ON DELETE CASCADE,
  platform_code     TEXT NOT NULL CHECK (platform_code IN ('instagram','facebook','youtube')),
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  format            TEXT NOT NULL,                       -- reel | short | video
  scheduled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','uploading','processing','published','failed','manual','cancelled')),
  attempts          INT NOT NULL DEFAULT 0,
  external_id       TEXT,
  permalink         TEXT,
  publication_id    UUID REFERENCES platform_publications(id) ON DELETE SET NULL,
  title             TEXT,
  caption           TEXT,
  error             TEXT,
  log               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, platform_code, format)
);

INSERT INTO app_settings (key, value) VALUES ('studio', '{
  "suggestion_emails": [],
  "approver_emails": [],
  "approval_rule": "any",
  "suggestion_wait_hours": 24,
  "default_platforms": ["instagram","facebook","youtube"],
  "variants": ["clean","branded","motion"],
  "youtube_privacy": "private",
  "auto_publish_after_approval": true,
  "drive_scan_minutes": 5,
  "brand": {"company_name": "", "handle": "", "tagline": "", "cta": "Follow for more", "logo_path": null, "logo_light_path": null,
            "logo_vector_path": null, "colors": {"primary":"#19a287","accent":"#f29c13","alert":"#e64d3c","dark":"#2d4053","darker":"#1b2631","light":"#FFFFFF"}},
  "glossary": []
}'::jsonb) ON CONFLICT (key) DO NOTHING;
