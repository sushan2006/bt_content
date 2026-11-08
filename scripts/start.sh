#!/usr/bin/env bash
# macOS/Linux: start analyzer + API (API serves the built dashboard on :4000)
cd "$(dirname "$0")/.."
(cd services/analyzer && source .venv/bin/activate && uvicorn app:app --port 8001) &
npm run dev:api
