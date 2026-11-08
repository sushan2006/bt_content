-- =====================================================================
-- Social Media Intelligence Platform — Phase 1 schema
-- Design rules:
--  * One original content item (content_items) -> many platform publications
--  * Metrics are NEVER overwritten: every observation is a metric_snapshot
--  * Unavailable metrics are stored as availability <> 'available', value NULL
--  * Platforms are data (platforms table) so LinkedIn etc. need no restructuring
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Users & RBAC ------------------------------------------------
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,           -- admin, marketing_manager, content_creator, viewer
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,           -- e.g. integrations.manage
  description TEXT
);

CREATE TABLE role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Platforms & accounts ---------------------------------------
CREATE TABLE platforms (
  code         TEXT PRIMARY KEY,               -- instagram, facebook, youtube, linkedin, ga4
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'social' CHECK (kind IN ('social','web_analytics')),
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb  -- e.g. {"retention_curve":true}
);

CREATE TABLE social_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_code       TEXT NOT NULL REFERENCES platforms(code),
  external_account_id TEXT NOT NULL,           -- IG user id / FB page id / YT channel id / GA4 property id
  display_name        TEXT NOT NULL,
  handle              TEXT,
  avatar_url          TEXT,
  data_origin         TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  status              TEXT NOT NULL DEFAULT 'connected'
                        CHECK (status IN ('connected','token_expired','error','disconnected')),
  last_synced_at      TIMESTAMPTZ,
  last_sync_status    TEXT,
  last_error          TEXT,
  connected_by        UUID REFERENCES users(id),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_code, external_account_id)
);

-- Tokens are AES-256-GCM encrypted at the application layer
CREATE TABLE social_account_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  token_type        TEXT NOT NULL CHECK (token_type IN ('access','refresh','page_access','long_lived_user')),
  encrypted_value   TEXT NOT NULL,
  scopes            TEXT[],
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (social_account_id, token_type)
);

-- ---------- Campaigns & content ----------------------------------------
CREATE TABLE campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,           -- used as utm_campaign
  name         TEXT NOT NULL,
  objective    TEXT CHECK (objective IN ('brand_awareness','product_awareness','engagement','lead_generation')),
  start_date   DATE,
  end_date     DATE,
  description  TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE content_categories (
  id          SERIAL PRIMARY KEY,
  group_code  TEXT NOT NULL DEFAULT 'purpose',  -- purpose | topic | product | ...
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (group_code, code)
);

CREATE SEQUENCE content_code_seq START 1;

CREATE TABLE content_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE DEFAULT ('CNT-' || lpad(nextval('content_code_seq')::text, 3, '0')),
  title            TEXT NOT NULL,
  description      TEXT,
  category_id      INT REFERENCES content_categories(id),
  campaign_id      UUID REFERENCES campaigns(id),
  product          TEXT,
  topic            TEXT,
  language         TEXT,
  business_objective TEXT CHECK (business_objective IN ('brand_awareness','product_awareness','engagement','lead_generation')),
  data_origin      TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  owner_id         UUID REFERENCES users(id),
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_items_category ON content_items(category_id);
CREATE INDEX idx_content_items_campaign ON content_items(campaign_id);
CREATE INDEX idx_content_items_title_trgm ON content_items USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(product,'') || ' ' || coalesce(topic,'')));

-- Original media files (master video, thumbnails, platform renders)
CREATE TABLE content_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_type      TEXT NOT NULL CHECK (asset_type IN ('master_video','platform_video','thumbnail','image','audio','transcript')),
  storage_uri     TEXT NOT NULL,               -- file://..., s3://..., gdrive://<fileId>
  mime_type       TEXT,
  duration_sec    NUMERIC(10,3),
  width           INT,
  height          INT,
  size_bytes      BIGINT,
  checksum_sha256 TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, checksum_sha256)
);

-- A publication = one platform post of one content item
CREATE TABLE platform_publications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id   UUID REFERENCES content_items(id) ON DELETE SET NULL,  -- NULL = synced but not yet linked
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform_code     TEXT NOT NULL REFERENCES platforms(code),
  platform_post_id  TEXT NOT NULL,
  platform_video_id TEXT,                       -- FB video id may differ from post id
  publication_code  TEXT,                       -- INST-001 / FB-001 / YT-001
  format            TEXT,                       -- reel, feed_video, short, video, image, carousel, story
  title             TEXT,
  caption           TEXT,
  hashtags          TEXT[] NOT NULL DEFAULT '{}',
  permalink         TEXT,
  thumbnail_url     TEXT,
  asset_id          UUID REFERENCES content_assets(id),
  duration_sec      NUMERIC(10,3),
  published_at      TIMESTAMPTZ,
  publishing_status TEXT NOT NULL DEFAULT 'published' CHECK (publishing_status IN ('draft','scheduled','published','failed','deleted')),
  is_paid           BOOLEAN,                    -- NULL = unknown
  raw               JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at    TIMESTAMPTZ,
  UNIQUE (platform_code, platform_post_id)
);
CREATE INDEX idx_pub_content ON platform_publications(content_item_id);
CREATE INDEX idx_pub_account ON platform_publications(social_account_id, published_at DESC);

-- ---------- Metric definitions & historical snapshots -------------------
CREATE TABLE metric_definitions (
  id               SERIAL PRIMARY KEY,
  platform_code    TEXT NOT NULL REFERENCES platforms(code),
  metric_key       TEXT NOT NULL,               -- canonical key: views, reach, likes, avg_watch_time_sec ...
  platform_metric  TEXT NOT NULL,               -- the platform's own name: ig_reels_avg_watch_time
  scope            TEXT NOT NULL CHECK (scope IN ('publication','account')),
  unit             TEXT NOT NULL DEFAULT 'count',  -- count | seconds | ratio | percent
  version          INT NOT NULL DEFAULT 1,
  description      TEXT,
  valid_from       DATE,
  deprecated_at    DATE,
  UNIQUE (platform_code, metric_key, scope, version)
);

CREATE TABLE sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE CASCADE,
  job_type          TEXT NOT NULL,              -- full | incremental | backfill | ga4 | retention
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed')),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  items_processed   INT NOT NULL DEFAULT 0,
  metrics_written   INT NOT NULL DEFAULT 0,
  error_count       INT NOT NULL DEFAULT 0,
  error_summary     TEXT,
  triggered_by      TEXT NOT NULL DEFAULT 'schedule',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_jobs_account ON sync_jobs(social_account_id, created_at DESC);

-- Every observation, never overwritten.
CREATE TABLE metric_snapshots (
  id                   BIGSERIAL PRIMARY KEY,
  publication_id       UUID REFERENCES platform_publications(id) ON DELETE CASCADE,
  social_account_id    UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform_code        TEXT NOT NULL REFERENCES platforms(code),
  metric_key           TEXT NOT NULL,
  metric_definition_id INT REFERENCES metric_definitions(id),
  value                NUMERIC,                 -- NULL when not available
  availability         TEXT NOT NULL DEFAULT 'available'
                         CHECK (availability IN ('available','unavailable','not_supported','permission_missing','error')),
  period               TEXT NOT NULL DEFAULT 'lifetime',  -- lifetime | day | week | days_28
  period_start         DATE,
  period_end           DATE,
  distribution         TEXT NOT NULL DEFAULT 'all' CHECK (distribution IN ('all','organic','paid','unknown')),
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_hour       TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', now()),
  sync_job_id          UUID REFERENCES sync_jobs(id) ON DELETE SET NULL,
  raw                  JSONB
);
-- Duplicate prevention: one observation per metric/period per hour
CREATE UNIQUE INDEX uq_metric_snapshot ON metric_snapshots (
  coalesce(publication_id, '00000000-0000-0000-0000-000000000000'::uuid), social_account_id, metric_key, period,
  coalesce(period_start, '1900-01-01'::date), coalesce(period_end, '1900-01-01'::date), distribution, collected_hour);
CREATE INDEX idx_snap_pub_metric ON metric_snapshots(publication_id, metric_key, collected_at DESC);
CREATE INDEX idx_snap_account_metric ON metric_snapshots(social_account_id, metric_key, period_end);

-- Latest known value per publication+metric (fast reads; history stays in snapshots)
CREATE TABLE publication_metrics (
  publication_id   UUID NOT NULL REFERENCES platform_publications(id) ON DELETE CASCADE,
  metric_key       TEXT NOT NULL,
  value            NUMERIC,
  availability     TEXT NOT NULL,
  snapshot_id      BIGINT REFERENCES metric_snapshots(id) ON DELETE SET NULL,
  collected_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (publication_id, metric_key)
);

-- Audience retention curves (YouTube 100 pts, Facebook ~40 buckets; Instagram: none via API)
CREATE TABLE retention_curves (
  id             BIGSERIAL PRIMARY KEY,
  publication_id UUID NOT NULL REFERENCES platform_publications(id) ON DELETE CASCADE,
  source_metric  TEXT NOT NULL,                 -- audienceWatchRatio | total_video_retention_graph
  points         JSONB NOT NULL,                -- [{"r":0.01,"t":0.3,"v":0.95}] r=ratio of duration, t=sec, v=share watching
  rel_points     JSONB,                         -- relativeRetentionPerformance where available
  duration_sec   NUMERIC(10,3),
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_date DATE NOT NULL DEFAULT current_date,
  UNIQUE (publication_id, source_metric, collected_date)
);

CREATE TABLE audience_insights (
  id                BIGSERIAL PRIMARY KEY,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  publication_id    UUID REFERENCES platform_publications(id) ON DELETE CASCADE,
  dimension         TEXT NOT NULL,              -- country | city | age | gender | age_gender | traffic_source | viewer_type
  bucket            TEXT NOT NULL,
  value             NUMERIC,
  value_unit        TEXT NOT NULL DEFAULT 'count',
  period_start      DATE,
  period_end        DATE,
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_date    DATE NOT NULL DEFAULT current_date
);
CREATE UNIQUE INDEX uq_audience ON audience_insights (social_account_id,
  coalesce(publication_id,'00000000-0000-0000-0000-000000000000'::uuid), dimension, bucket, collected_date);

-- ---------- Video understanding ----------------------------------------
CREATE TABLE segment_templates (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  -- [{"code":"opening","label":"Opening","start":0,"end":3}, ... {"code":"ending","start":"-15%","end":"100%"}]
  segments    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE video_analysis_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_id         UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  analyzer_version TEXT,
  duration_sec     NUMERIC(10,3),
  transcript       JSONB,                        -- [{"start":0.0,"end":2.1,"text":"..."}]
  scenes           JSONB,                        -- [{"start":0,"end":2.4,"keyframe":"..."}]
  silences         JSONB,
  loudness         JSONB,
  frames           JSONB,                        -- sampled frame descriptions (vision model)
  summary          JSONB,                        -- opening/middle/ending structured answers
  error            TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_var_content ON video_analysis_results(content_item_id, created_at DESC);

CREATE TABLE video_segments (
  id                 BIGSERIAL PRIMARY KEY,
  analysis_id        UUID NOT NULL REFERENCES video_analysis_results(id) ON DELETE CASCADE,
  content_item_id    UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  segment_code       TEXT NOT NULL,              -- opening | hook | main | demo | ending
  label              TEXT NOT NULL,
  start_sec          NUMERIC(10,3) NOT NULL,
  end_sec            NUMERIC(10,3) NOT NULL,
  transcript_text    TEXT,
  scene_changes      INT,
  speech_ratio       NUMERIC(5,4),               -- share of segment containing speech
  silence_sec        NUMERIC(10,3),
  observations       JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (analysis_id, segment_code)
);

-- Structured, comparable features (AI, heuristic or human-corrected)
CREATE TABLE content_features (
  id              BIGSERIAL PRIMARY KEY,
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  feature_key     TEXT NOT NULL,                 -- opening_style, cta_type, duration_bucket, narration_style ...
  value_text      TEXT,
  value_num       NUMERIC,
  source          TEXT NOT NULL CHECK (source IN ('ai','heuristic','human','platform')),
  confidence      NUMERIC(4,3),
  analysis_id     UUID REFERENCES video_analysis_results(id) ON DELETE SET NULL,
  corrected_by    UUID REFERENCES users(id),
  evidence        JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, feature_key)
);
CREATE INDEX idx_features_key_value ON content_features(feature_key, value_text);

-- ---------- Website attribution ----------------------------------------
CREATE TABLE website_traffic (
  id                BIGSERIAL PRIMARY KEY,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE CASCADE,  -- the GA4 property "account"
  date              DATE NOT NULL,
  source            TEXT NOT NULL,
  medium            TEXT NOT NULL,
  campaign          TEXT NOT NULL DEFAULT '(not set)',
  utm_content       TEXT NOT NULL DEFAULT '(not set)',
  landing_page      TEXT NOT NULL DEFAULT '(not set)',
  platform_code     TEXT REFERENCES platforms(code),      -- derived from source
  content_item_id   UUID REFERENCES content_items(id) ON DELETE SET NULL,  -- derived from utm_content
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  sessions          INT,
  users             INT,
  new_users         INT,
  engaged_sessions  INT,
  engagement_rate   NUMERIC(6,4),
  key_events        NUMERIC,
  data_origin       TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (social_account_id, date, source, medium, campaign, utm_content, landing_page)
);
CREATE INDEX idx_wt_content ON website_traffic(content_item_id, date);

CREATE TABLE website_conversions (
  id                BIGSERIAL PRIMARY KEY,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  event_name        TEXT NOT NULL,              -- form_submit, generate_lead, contact_page_view ...
  source            TEXT NOT NULL,
  medium            TEXT NOT NULL,
  campaign          TEXT NOT NULL DEFAULT '(not set)',
  utm_content       TEXT NOT NULL DEFAULT '(not set)',
  platform_code     TEXT REFERENCES platforms(code),
  content_item_id   UUID REFERENCES content_items(id) ON DELETE SET NULL,
  event_count       INT NOT NULL,
  data_origin       TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (social_account_id, date, event_name, source, medium, campaign, utm_content)
);

CREATE TABLE business_leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref     TEXT UNIQUE,                 -- CRM / form submission id (dedupe)
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_platform  TEXT REFERENCES platforms(code),
  utm_source       TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
  landing_page     TEXT,
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  content_item_id  UUID REFERENCES content_items(id) ON DELETE SET NULL,
  company_name     TEXT,
  contact_name     TEXT,
  contact_email    TEXT,                        -- personal data: restrict access, honour deletion requests
  product_interest TEXT,
  message          TEXT,
  lead_status      TEXT NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new','contacted','qualified','unqualified','won','lost')),
  conversion_status TEXT NOT NULL DEFAULT 'open' CHECK (conversion_status IN ('open','converted','not_converted')),
  data_origin      TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_content ON business_leads(content_item_id);

-- ---------- Intelligence ------------------------------------------------
CREATE TABLE ai_insights (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL,
  insight_type     TEXT NOT NULL,               -- opening_style | duration | cta | segment_dropoff | platform_fit | business_value ...
  title            TEXT NOT NULL,
  observation      TEXT NOT NULL,
  explanation      TEXT,                        -- possible reasons (hypothesis)
  evidence_level   TEXT NOT NULL CHECK (evidence_level IN ('direct_data','statistical_association','hypothesis','needs_testing')),
  confidence       TEXT NOT NULL CHECK (confidence IN ('insufficient','preliminary','moderate','strong')),
  sample_size      INT NOT NULL,
  effect_size      NUMERIC,
  p_value          NUMERIC,
  metrics          JSONB NOT NULL,              -- supporting numbers
  compared_items   JSONB NOT NULL,              -- [{content_item_id, publication_id, platform, value, group}]
  segments         JSONB,                       -- [{content_item_id, segment_code, start_sec, end_sec}]
  recommended_action TEXT,
  next_experiment  TEXT,
  cohort           JSONB,                       -- cohort definition used
  narrative_source TEXT NOT NULL DEFAULT 'template' CHECK (narrative_source IN ('template','llm')),
  data_origin      TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo','mixed')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dismissed','superseded')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_insights_run ON ai_insights(run_id);

CREATE TABLE ai_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL,
  category       TEXT NOT NULL,                 -- content | platform | publishing | experiment
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  platform_code  TEXT REFERENCES platforms(code),
  confidence     TEXT NOT NULL CHECK (confidence IN ('insufficient','preliminary','moderate','strong')),
  insight_ids    UUID[] NOT NULL DEFAULT '{}',
  priority       INT NOT NULL DEFAULT 3,
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','in_test','done')),
  feedback       TEXT,
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  data_origin    TEXT NOT NULL DEFAULT 'live' CHECK (data_origin IN ('live','demo','mixed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE analysis_experiments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID REFERENCES ai_recommendations(id) ON DELETE SET NULL,
  hypothesis       TEXT NOT NULL,
  variable         TEXT NOT NULL,               -- e.g. opening_style
  variant_a        TEXT NOT NULL,
  variant_b        TEXT NOT NULL,
  primary_metric   TEXT NOT NULL,               -- e.g. retention_3s
  min_sample_per_arm INT NOT NULL DEFAULT 5,
  content_item_ids_a UUID[] NOT NULL DEFAULT '{}',
  content_item_ids_b UUID[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','concluded','abandoned')),
  result           JSONB,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Logs --------------------------------------------------------
CREATE TABLE integration_logs (
  id                BIGSERIAL PRIMARY KEY,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE CASCADE,
  sync_job_id       UUID REFERENCES sync_jobs(id) ON DELETE CASCADE,
  level             TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  endpoint          TEXT,
  http_status       INT,
  message           TEXT NOT NULL,
  details           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_intlog_account ON integration_logs(social_account_id, created_at DESC);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                    -- account.connect, user.role_change, data.export ...
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  state       TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
