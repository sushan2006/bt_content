# Content Intelligence Platform (content_bt) — notes for Claude

Read this first in any session that works on this code. Plans and decisions: `docs/PHASE4_PLAN.md` (current Content Studio), `docs/RESEARCH_AND_DECISIONS.md`, `docs/PHASE2_PLAN.md` (history).

**If the chat starts with a prompt "# Video edit — JOB-…"**, you are editing a video, not changing this code: follow `docs/EDITING_GUIDE.md`.

## What it is
- **Content Studio**: a video is set up in the dashboard (style, topic, material, length, format, audio). The dashboard writes a prompt; the edit is made in a Claude Code chat (no API, no token cost). The finished `JOB-012 Title.mp4` + `JOB-012 captions.txt` go to Google Drive `content_final`; the dashboard picks them up (Completed) and publishes to Instagram, Facebook, YouTube.
- **Analytics**: synced posts from the three platforms → analysis engine (findings, recommendations, experiments) → Overview page. Studio videos are linked to their posts; the engine measures which styles work, and its findings go into the next prompt.
- Scope is social media only (no website, UTM or lead tracking).

## Layout
| Path | What |
| --- | --- |
| `apps/api` | Fastify + TypeScript API, served on :4000 together with the built dashboard |
| `apps/api/src/studio/pipeline.ts` | Job life cycle (prompt_ready → with_claude → completed → publishing → published), Drive uploads, prompt context, content_final scan, `tick()` |
| `apps/api/src/studio/handoff.ts` | The prompt, file names, captions-file parser (pure functions, unit tested) |
| `apps/api/src/studio/presets.ts` | The 9 preset styles (card text, defaults; Simple Edit is footage only) |
| `apps/api/templates/studio/*.md` | The full prompt template of each preset (section 1 has `{{TOPIC}}`, `{{SETTINGS}}`, `{{AUDIO_SETTINGS}}`, filled by `handoff.ts`) |
| `apps/api/src/studio/thumbs.ts` | Thumbnails: FFmpeg frames, JPEG under 2 MB. `setThumbnail()` in pipeline.ts stores one and copies it to content_final |
| `apps/api/src/integrations/workspace.ts` | Google Drive (or the local `drive_local/` folder when Google is not connected); `isDriveId()` tells a Google id from a local path |
| `apps/api/src/intelligence/` | Analysis engine (`engine.ts`), plain-language layer (`plain.ts`) |
| `apps/web` | React + Vite + Tailwind dashboard. Navigation is in `src/main.tsx`; studio pages in `src/pages/studio` |
| `services/analyzer` | Python FastAPI service on :8001: video analysis for the analytics, reference-style measurement, logo colours. It edits nothing |
| `db/migrations/*.sql` | Applied in order at start; never edit an applied migration, add the next number |

## Run and test (Windows laptop)
- Start everything: `RUN_DEMO.bat` (embedded PostgreSQL on 5433, migrations, video service, API, dashboard rebuild when `apps/web/src` changed). Login `demo@company.local` / `DemoPass123`.
- The API runs with `tsx` without watch: restart `RUN_DEMO.bat` after API changes.
- Typecheck: `npm run typecheck`. API tests: set `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/content_bt_test`, then `npm test`. Python: `services\analyzer\.venv\Scripts\python.exe -m pytest -q services/analyzer/tests`.
- End to end (with RUN_DEMO running): `node scripts/e2e-studio.mjs [take.mp4]`.

## Rules that must hold
- No paid API anywhere (no Anthropic key, no LLM calls). Videos are edited only by Claude Code from the copied prompt; nothing in the app edits or renders video.
- The prompt only contains web links (Google Drive), never paths on this computer.
- A finished file is found by the job code at the start of its name; every final file seen is recorded (`production_files.kind='final'`) so a set-aside file is never picked up again.
- Live and demo data never mix (`data_origin`, `?origin=`).
- Two roles only: `admin` (all permissions) and `viewer` (`analytics.view`, `content.view_all`, `insights.view`, `reports.view`, `studio.view`, `studio.suggest`). New permissions go to admin in a migration.
- Videos live in Google Drive; the laptop keeps only a working copy. Use `ensureFinalLocal()` before reading a finished file.
- Keep the UI plain and short: the user asked for a minimal dashboard. Do not add pages or panels without a clear need.
- Secrets live in `.env` only; never print or commit them.
