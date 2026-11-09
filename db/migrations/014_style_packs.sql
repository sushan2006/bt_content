-- Style packs (8 Nov 2026): a new editing style is added from the dashboard, with no code change.
-- A pack is style.json (card text + options), template.md (the full prompt template), a thumbnail picture and an
-- optional README. It is stored here, so it survives deploys and moves with the database. A pack is used like one
-- of the nine built-in styles; its key is "pack_<name>".
CREATE TABLE IF NOT EXISTS style_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE CHECK (key ~ '^pack_[a-z0-9_]{2,30}$'),
  name        TEXT NOT NULL,
  meta        JSONB NOT NULL,          -- tagline, technique, about, looks, best_for, good_to_know, example_topic, options
  template    TEXT NOT NULL,           -- section 1 holds {{TOPIC}}, {{SETTINGS}}, {{AUDIO_SETTINGS}}
  readme      TEXT,
  thumb       BYTEA NOT NULL,          -- the picture on the style card (png / jpeg / webp / gif, under 2 MB)
  thumb_type  TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
