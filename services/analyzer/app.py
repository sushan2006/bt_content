"""Video analyzer HTTP service. Run:  uvicorn app:app --port 8001

- /analyze                 Phase 1 analytics: transcript, pauses, on-screen text and features of a published video
- /studio/extract-style    measures how a reference video is edited (for the "copy the style of a video" feature)
- /studio/brand/logo       reads the brand colours from the logo

Nothing here edits videos: the edits are made by Claude Code from the prompt the dashboard writes. No paid API is used.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from analyzer import pipeline, speech, vision

app = FastAPI(title="CIP Video Analyzer", version=pipeline.ANALYZER_VERSION)


class AnalyzeRequest(BaseModel):
    path: str
    transcript_text: str | None = None
    language: str | None = None
    product: str | None = None
    company: str | None = None
    company_keywords: list[str] | None = None
    use_vision: bool = True


def _studio_ok() -> dict:
    try:
        import numpy  # noqa: F401
        import cv2  # noqa: F401
        from studio import STUDIO_VERSION
        return {"ok": True, "version": STUDIO_VERSION}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


@app.get("/health")
def health():
    return {
        "ok": True, "version": pipeline.ANALYZER_VERSION,
        "ffmpeg": shutil.which(os.environ.get("FFMPEG_BIN", "ffmpeg")) is not None,
        "whisper": speech.whisper_available(), "whisper_model": os.environ.get("WHISPER_MODEL", "small"),
        "ocr": vision.ocr_available(), "studio": _studio_ok(),
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    try:
        return pipeline.analyze(req.path, transcript_text=req.transcript_text, language=req.language, product=req.product,
                                company=req.company, company_keywords=req.company_keywords)
    except FileNotFoundError as e:
        raise HTTPException(404, f"File not found: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))


# ------------------------------------------------------------------ background tasks (the API polls /studio/tasks/{id})
_pool = ThreadPoolExecutor(max_workers=int(os.environ.get("STUDIO_PARALLEL_TASKS", "2")))
_tasks: dict[str, dict] = {}
_lock = threading.Lock()


def _submit(kind: str, fn, *args) -> dict:
    tid = uuid.uuid4().hex[:12]
    task = {"id": tid, "kind": kind, "status": "running", "log": [], "result": None, "error": None, "started": time.time()}
    with _lock:
        # keep the table small: forget finished tasks after an hour
        for k in [k for k, t in _tasks.items() if t.get("finished") and time.time() - t["finished"] > 3600]:
            _tasks.pop(k, None)
        _tasks[tid] = task

    def log(msg: str):
        task["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")
        task["log"] = task["log"][-200:]

    def run():
        try:
            task["result"] = fn(*args, log)
            task["status"] = "done"
        except Exception as e:  # noqa: BLE001
            task["status"] = "failed"
            task["error"] = str(e)
            log(traceback.format_exc()[-1500:])
        task["finished"] = time.time()

    _pool.submit(run)
    return {"task_id": tid}


@app.get("/studio/tasks/{tid}")
def task_status(tid: str):
    t = _tasks.get(tid)
    if not t:
        raise HTTPException(404, "unknown task")
    return dict(t)


# ------------------------------------------------------------------ reference styles + brand
class StyleRequest(BaseModel):
    path: str
    name: str | None = None


def _extract_style(req: StyleRequest, log):
    from studio.style_extract import extract
    log(f"measuring the edit of {os.path.basename(req.path)}: cuts, graphics, picture, captions, sound")
    return extract(req.path, req.name)


@app.post("/studio/extract-style")
def extract_style(req: StyleRequest):
    if not os.path.exists(req.path):
        raise HTTPException(404, f"File not found: {req.path}")
    return _submit("extract-style", _extract_style, req)


class LogoRequest(BaseModel):
    src: str
    out_dir: str


@app.post("/studio/brand/logo")
def brand_logo(req: LogoRequest):
    from studio import brand
    try:
        return {"palette": brand.extract_palette(req.src)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the logo: {e}")
