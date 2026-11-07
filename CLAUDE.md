# Content Intelligence Platform (content_bt) — notes for Claude

Read this first in any session that works on this code. Plans and decisions: `docs/PHASE2_PLAN.md`, `docs/PHASE3_PLAN.md`, `docs/RESEARCH_AND_DECISIONS.md`.

## What it is
- **Content Studio**: raw takes → best take per line → one edited version per style → approval in the dashboard → final video in Google Drive `content_final` → publishing to Instagram, Facebook, YouTube.
- **Analytics**: synced posts from the three platforms → analysis engine (findings, recommendations, experiments) → Overview page. Studio videos are linked to their posts, so the engine measures which styles and editing rules work. Its findings feed back into the editor as rules.
- Scope is social media only (no website, UTM or lead tracking).

## Layout
| Path | What |
| --- | --- |
| `apps/api` | Fastify + TypeScript API, served on :4000 together with the built dashboard |
| `apps/api/src/studio/pipeline.ts` | Job state machine (`advance`, `step*`), Drive delivery (`deliverFinal`, `syncFinalsToDrive`), Claude director hand-off |
| `apps/api/src/integrations/workspace.ts` | Google Drive (or the local `drive_local/` folder when Google is not connected); `isDriveId()` tells a Google id from a local path |
| `apps/api/src/intelligence/` | Analysis engine (`engine.ts`), plain-language layer (`plain.ts`) |
| `apps/web` | React + Vite + Tailwind dashboard. Navigation is in `src/main.tsx` |
| `services/analyzer` | Python FastAPI video service on :8001 (takes, planner, renderer, 3D, Claude director) |
| `services/analyzer/studio/director/handbook/*.md` | The Director Handbook sent to Claude with every edit (all `.md` files, name order) |
| `db/migrations/*.sql` | Applied in order at start; never edit an applied migration, add the next number |

## Run and test (Windows laptop)
- Start everything: `RUN_DEMO.bat` (embedded PostgreSQL on 5433, migrations, video service, API, dashboard rebuild when `apps/web/src` changed). Login `demo@company.local` / `DemoPass123`.
- The API runs with `tsx` without watch: restart `RUN_DEMO.bat` after API changes.
- Typecheck: `npm run typecheck`. API tests: set `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/content_bt_test`, then `npm test`. Python: `services\analyzer\.venv\Scripts\python.exe -m pytest -q services/analyzer/tests`.
- End to end: `node scripts/e2e-studio.mjs <take.mp4> --styles=editorial,minimal --machines=Pump:<photo.jpg>,Motor:<photo.jpg>` (add `--claude` once the API key is set).

## Rules that must hold
- Live and demo data never mix (`data_origin`, `?origin=`).
- Two roles only: `admin` (all permissions) and `viewer` (`analytics.view`, `content.view_all`, `insights.view`, `reports.view`, `studio.view`, `studio.suggest`). New permissions go to admin in a migration.
- A video can have several machines (`production_jobs.machine_ids`); the first is the main one. In a direction, `machine:1`, `machine:2` … pick one.
- Videos live in Google Drive; the laptop keeps only a working copy. Use `ensureVersionLocal()` before reading a rendered file.
- Claude's output is validated data (direction JSON), never code that is run. Numbers in narratives must come from the evidence.
- Keep the UI plain and short: the user asked for a minimal dashboard. Do not add pages or panels without a clear need.
- Secrets live in `.env` only; never print or commit them.
