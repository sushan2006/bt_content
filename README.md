# Social Media Intelligence & Content Automation Platform — Phase 1

Connects Instagram, Facebook and YouTube through their official APIs and analyses **social media performance only** (no website analytics). It keeps the full history of every metric, links each original video to all its platform publications, analyses what happens inside each video (opening, middle, ending, segments) and explains, with statistics and evidence, which content characteristics are associated with better retention, engagement, shares and saves.

- **Setup guide for API keys and accounts:** [`docs/SETUP_API_KEYS.md`](docs/SETUP_API_KEYS.md)
- **Architecture & flowcharts:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Research & design decisions:** [`docs/RESEARCH_AND_DECISIONS.md`](docs/RESEARCH_AND_DECISIONS.md)
- **Phase 2 plan:** [`docs/PHASE2_PLAN.md`](docs/PHASE2_PLAN.md)

## Stack
React + TypeScript + Tailwind + ECharts · Node.js + TypeScript + Fastify · PostgreSQL · Redis + BullMQ (optional locally) · Python FastAPI analyzer with FFmpeg + faster-whisper (+ optional Claude vision).

## Requirements (Windows, macOS or Linux)
| Tool | Version | Windows install |
|---|---|---|
| Node.js | 20+ (22 LTS recommended) | https://nodejs.org |
| Python | 3.10–3.12 | https://python.org (tick *Add to PATH*) |
| PostgreSQL | 14+ | Docker (below) **or** https://www.postgresql.org/download/windows |
| FFmpeg | any recent | `winget install Gyan.FFmpeg` |
| Redis | optional | Docker (below). Leave `REDIS_URL` empty to use the built-in scheduler |
| Tesseract OCR | optional | `winget install UB-Mannheim.TesseractOCR` (reads on-screen text) |

## First-time setup
```powershell
# 1. In the project folder
npm install
npm run setup                # creates .env with random secrets

# 2. Database (+Redis) — either Docker…
docker compose up -d
#    …or a local PostgreSQL: create database "content_bt" and set DATABASE_URL in .env
#    No Redis? set  REDIS_URL=  (empty) in .env

# 3. Create tables and the first admin user
npm run migrate
npm run seed:admin -- you@company.com "Your Name" "AStrongPassword123"

# 4. Video analyzer (Python)
cd services\analyzer
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cd ..\..

# 5. Build the dashboard once
npm run build
```

## Run
```powershell
.\scripts\start-windows.ps1     # Windows: opens the analyzer + API, then http://localhost:4000
./scripts/start.sh              # macOS / Linux
```
Or manually, in two terminals: `cd services/analyzer && uvicorn app:app --port 8001` and `npm run dev:api`.
For dashboard development with hot reload, also run `npm run dev:web` → http://localhost:5173.

Open **http://localhost:4000** and sign in.

### Try it before connecting accounts
```
npm run seed:demo
```
Then switch **Data → Demo data** at the top right. Demo records are synthetic, labelled DEMO everywhere, and never mixed with live analytics.

## Using it
1. **Integrations** → connect Facebook/Instagram (Meta) and YouTube (Google). See the setup guide.
2. **Publications** → link each synced post to its original content item (one CNT code → INST/FB/YT publications).
3. **Content library → item → Media & analysis** → upload the master video. Analysis runs automatically: transcript, scenes, pauses, opening/middle/ending answers, features.
4. Correct any wrong AI features on the **Content features** tab.
5. **AI insights → Run analysis**. Findings come with evidence level, confidence, compared videos, segments, action and a validating experiment. The analysis also runs from the scheduler as data arrives.
6. **Recommendations** → accept, reject or test. **Experiments** → assign videos to variants → evaluate.
7. **Executive brief** → the one-page summary for management.

## Content Studio (Phase 2)

Sidebar → **Content Studio**. Upload the raw video with a few details (or drop a folder into Google Drive › `content_raw`), and the studio:
picks the best take for every line → edits one version per chosen style → the versions appear in the dashboard (and in `content_mid_suggestions`
in Drive) → a colleague approves one or asks for changes in the dashboard → the approved video goes to `content_final` and the Completed page.
The video service (Python, `services/analyzer`) is started automatically by `RUN_DEMO.bat`; the first run installs its packages
and the first video downloads the speech model (~460 MB).

## Claude director (Phase 3)

With `ANTHROPIC_API_KEY=...` in `.env` (no restart needed) Claude plans every edit instead of the fixed rules:
1. **Watches and listens**: the timed transcript (word ids) and frames of the footage.
2. **Researches** the topic on the web (facts, terms, how it works, how it looks), shown with sources on the job page.
3. **Directs** each style: what to cut, when to leave the speaker for a full-screen 3D explainer or diagram and when to come back,
   which 3D objects rise behind the speaker, what they do on which word, which words become big, spelling fixes for the captions.
   New objects are **modelled by Claude** with the 3D building kit and saved as `.glb` in the asset library (reused by later videos).
4. **Checks its storyboard** (frames of its own edit + previews of its models) and fixes what is wrong.
5. The engine renders exactly that on this computer. Change requests from reviewers go back to Claude as a revision.

How Claude knows how to edit: the **Director Handbook** in `services/analyzer/studio/director/handbook/` (role, editing principles,
what the engine can render, the direction format, and the approved water-motor edit as a worked example). Edit those files to change the house style.
Styles learned from a reference video get a **style card** written by Claude (Editing styles page, editable).
Machines can be modelled by Claude from photos (Machine library, or "+ A new machine" on the New video form), with the photos mapped on, as `.glb`.
Studio settings → Claude director: planner on/off, models (Opus 5.5 to direct, Sonnet 5.5 for research), web research, storyboard checks, budget per video.
Typical cost: about $1–2 per style for a 1-minute video. Without a key, or when the budget is reached, the automatic editor is used.

## Tests

Python studio tests: `services/analyzer/.venv/Scripts/python -m pytest services/analyzer/tests`
```
createdb content_bt_test     # once (or: CREATE DATABASE content_bt_test;)
npm test
```
21 tests: statistics, segment fitting, retention maths, platform parsing, the LLM grounding guard, and integration tests of all four adapters against mocked API responses with a real database (snapshots, unavailable-vs-zero, deprecated-metric fallback, token expiry, pagination loops).

## Project layout
```
apps/api            Fastify API, adapters, sync, intelligence engine (TypeScript)
apps/web            React dashboard
services/analyzer   Python video-understanding service
db/migrations       SQL schema + reference data
docs/               Setup guide, architecture, research, Phase 2 plan
scripts/            setup + start scripts
storage/media       Uploaded master videos (local; object storage in cloud)
```

## Moving to the cloud later
Everything is configured through `.env`. Set `API_PUBLIC_URL` / `WEB_ORIGIN` to the public URL, add the new redirect URIs in Meta and Google, use managed PostgreSQL + Redis, and put `MEDIA_STORAGE_DIR` on persistent storage (or swap in object storage). Keep `TOKEN_ENCRYPTION_KEY` safe: without it, stored tokens cannot be decrypted.
