# Social Media Intelligence & Content Automation Platform

Connects Instagram, Facebook and YouTube through their official APIs and analyses **social media performance only** (no website analytics). It keeps the full history of every metric, links each original video to all its platform publications, analyses what happens inside each video (opening, middle, ending, segments) and explains, with statistics and evidence, which content characteristics are associated with better retention, engagement, shares and saves.

- **Setup guide for API keys and accounts:** [`docs/SETUP_API_KEYS.md`](docs/SETUP_API_KEYS.md)
- **Architecture & flowcharts:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Research & design decisions:** [`docs/RESEARCH_AND_DECISIONS.md`](docs/RESEARCH_AND_DECISIONS.md)
- **Content Studio (videos edited by Claude Code):** [`docs/PHASE4_PLAN.md`](docs/PHASE4_PLAN.md) · how the edits are built: [`docs/EDITING_GUIDE.md`](docs/EDITING_GUIDE.md)

## Stack
React + TypeScript + Tailwind + ECharts · Node.js + TypeScript + Fastify · PostgreSQL · Redis + BullMQ (optional locally) · Python FastAPI analyzer with FFmpeg + faster-whisper.

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

## Content Studio (Phase 4: edited by Claude Code)

The dashboard sets the video up and writes the prompt; the edit itself is made in a Claude Code chat (your Claude plan, no API key or token cost).
1. **New video**: pick one of the 9 styles (8 animated looks plus **Simple Edit**: clean cuts of real footage, no graphics or captions, for office tours and factory walk-throughs; or a style copied from a reference video), say what the video is about, choose what Claude gets
   (camera takes, a voiceover MP3, or nothing), length, format (9:16 / 16:9), storyboard first, music and sound effects. Takes and pictures go to Drive.
2. The video page has **Copy prompt**. Paste it into a new Claude Code chat in the `content_bt` project and attach the footage.
   The prompt carries the brief, the full style spec, brand kit, Drive links, colleagues' suggestions and what the analytics say works.
3. When you approve the edit in the chat, Claude delivers `JOB-012 <title>.mp4`, `JOB-012 thumbnail.jpg` and `JOB-012 captions.txt`. Put them in Drive › **content_final**
   (or use *Upload final video* on the video page). The dashboard checks content_final every few minutes, completes the video and reads the captions.
   Any other video put in content_final is added as a new completed video.
   **Thumbnails:** every video gets one: Claude's `JOB-012 thumbnail.jpg`, else a good frame picked automatically. Change it on the video page (upload a picture, or pause on a frame and *Use the paused frame*). It shows in the dashboard and is the cover when publishing (Instagram `cover_url` when the API has a public https address, otherwise the frame time; Facebook and YouTube upload it after the post; YouTube needs a verified channel).
4. **Completed → Publish**: captions per platform (pre-filled), publish now or schedule. Posts are linked to the analytics.

Stages: Prompt ready → Editing with Claude → Ready to publish → Published. How Claude builds the edits: `docs/EDITING_GUIDE.md`. Plan: `docs/PHASE4_PLAN.md`.
The Python service (`services/analyzer`) only analyses published videos for the analytics and measures reference styles; it edits nothing.

## Tests

End to end (with RUN_DEMO.bat running): `node scripts/e2e-studio.mjs`

Python tests: `services/analyzer/.venv/Scripts/python -m pytest services/analyzer/tests`
```
createdb content_bt_test     # once (or: CREATE DATABASE content_bt_test;)
npm test
```
Tests: statistics, segment fitting, retention maths, platform parsing, the Claude Code prompt and captions file, and integration tests of all four adapters against mocked API responses with a real database (snapshots, unavailable-vs-zero, deprecated-metric fallback, token expiry, pagination loops).

## Project layout
```
apps/api            Fastify API, adapters, sync, intelligence engine (TypeScript)
apps/web            React dashboard
services/analyzer   Python video-understanding service
db/migrations       SQL schema + reference data
docs/               Setup guide, architecture, research, plans, editing guide
scripts/            setup + start scripts
storage/media       Uploaded master videos (local; object storage in cloud)
```

## Moving to the cloud later
Everything is configured through `.env`. Set `API_PUBLIC_URL` / `WEB_ORIGIN` to the public URL, add the new redirect URIs in Meta and Google, use managed PostgreSQL + Redis, and put `MEDIA_STORAGE_DIR` on persistent storage (or swap in object storage). Keep `TOKEN_ENCRYPTION_KEY` safe: without it, stored tokens cannot be decrypted.
