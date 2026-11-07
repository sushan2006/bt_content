"""Video analyzer + content studio HTTP service. Run:  uvicorn app:app --port 8001"""
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

try:  # load repo-root .env so ANTHROPIC_API_KEY / WHISPER_MODEL are shared with the API
    from pathlib import Path
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
except Exception:  # noqa: BLE001
    pass

app = FastAPI(title="CIP Video Analyzer + Studio", version=pipeline.ANALYZER_VERSION)


def _env_refresh() -> None:
    """Re-reads the ANTHROPIC_* settings from .env, so a key added while the service runs is used without a restart."""
    try:
        from pathlib import Path
        env_path = Path(__file__).resolve().parents[2] / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    val = v.strip().strip('"').strip("'")
                    if k.strip().startswith("ANTHROPIC_") and val:
                        os.environ[k.strip()] = val
    except Exception:  # noqa: BLE001
        pass


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
        import skia  # noqa: F401
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
        "ocr": vision.ocr_available(), "vision_llm": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "studio": _studio_ok(), "director": _director_ok(),
    }


def _director_ok() -> dict:
    _env_refresh()
    try:
        from studio.director import claude
        from studio import scene3d
        return {"claude": claude.available(), "gl": scene3d.available()}
    except Exception as e:  # noqa: BLE001
        return {"claude": False, "error": str(e)[:200]}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    try:
        return pipeline.analyze(req.path, transcript_text=req.transcript_text, language=req.language, product=req.product,
                                company=req.company, company_keywords=req.company_keywords, use_vision=req.use_vision)
    except FileNotFoundError as e:
        raise HTTPException(404, f"File not found: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))


# ------------------------------------------------------------------ studio (Phase 2)
# Long tasks run in background threads; the API polls /studio/tasks/{id}.
_pool = ThreadPoolExecutor(max_workers=int(os.environ.get("STUDIO_PARALLEL_TASKS", "2")))
_tasks: dict[str, dict] = {}
_lock = threading.Lock()


def _submit(kind: str, fn, *args) -> dict:
    tid = uuid.uuid4().hex[:12]
    task = {"id": tid, "kind": kind, "status": "running", "log": [], "result": None, "error": None, "started": time.time()}
    with _lock:
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
    return {k: v for k, v in t.items()}


class TakesRequest(BaseModel):
    takes: list[dict]          # [{take_id, path, transcript?:[words]}]
    script: str | None = None
    language: str | None = None
    hints: str | None = None   # names and technical words from the brief, so the transcript spells them right
    on_camera_ai: bool = True


def _analyze_takes(req: TakesRequest, log):
    from studio import llm, takes as T
    out = []
    for tk in req.takes:
        log(f"analysing take {tk['take_id']} ({os.path.basename(tk['path'])})")
        out.append(T.analyze_take(tk["take_id"], tk["path"], words=tk.get("transcript"), language=req.language, hints=req.hints))
    if req.on_camera_ai and llm.available():
        try:
            import tempfile
            from analyzer import media
            frames = {}
            for tk in out:
                d = tempfile.mkdtemp(prefix="oncam_")
                times = [tk["duration"] * f for f in (0.15, 0.4, 0.65, 0.9)]
                frames[tk["take_id"]] = [f["path"] for f in media.extract_frames(tk["path"], times, d, width=512)]
            scores = llm.score_takes_on_camera(frames)
            for tk in out:
                if tk["take_id"] in scores:
                    tk["on_camera"] = scores[tk["take_id"]]
                    for s in tk["sentences"]:
                        s.setdefault("visual", {})["on_camera"] = scores[tk["take_id"]]
            log(f"on-camera ratings from Claude: {scores}")
        except Exception as e:  # noqa: BLE001
            log(f"on-camera rating skipped: {e}")
    log("lining up the takes and choosing the best version of each line")
    selection = T.select(out, req.script)
    return {"takes": out, "selection": selection}


@app.post("/studio/analyze-takes")
def analyze_takes(req: TakesRequest):
    return _submit("analyze-takes", _analyze_takes, req)


class PlanRequest(BaseModel):
    inputs: dict
    variant: str
    aspect: str = "9:16"
    overrides: list[dict] = []
    use_llm: bool = True


@app.post("/studio/plan")
def make_plan(req: PlanRequest):
    from studio import llm, planner
    try:
        out = planner.build_plan(req.inputs, req.variant, req.aspect, req.overrides)
        notes: list[str] = []
        if req.variant in ("motion", "overlay", "editorial") and req.use_llm and llm.available():
            try:
                plan, notes = llm.enrich_motion(out["plan"], req.inputs.get("brief") or {}, req.inputs.get("rules") or [], req.inputs.get("suggestions_text") or [])
                from studio.schema import Plan
                p = Plan.model_validate(plan)
                if req.variant == "overlay":
                    planner.set_overlay(p.graphics)
                if req.variant == "editorial":
                    from studio import editorial
                    editorial.convert(p, req.inputs.get("brief") or {})
                # change requests still win over Claude's graphics
                planner.apply_plan_ops(p, [o for o in (req.inputs.get("suggestion_ops") or []) + req.overrides if o["op"] in ("remove_graphic", "add_keyword", "headline", "cta", "logo")])
                out = {"plan": p.model_dump(), "summary": planner.summarize(p, [])}
                notes = ["Graphics planned with Claude"] + notes
            except Exception as e:  # noqa: BLE001
                notes = [f"Claude graphics skipped ({str(e)[:120]}); automatic graphics used"]
        out["notes"] = notes
        return out
    except ValueError as e:
        raise HTTPException(400, str(e))


class RenderRequest(BaseModel):
    plan: dict
    out_path: str
    preview_times: list[float] = []


def _render(req: RenderRequest, log):
    from studio.render import render
    return render(req.plan, req.out_path, preview_times=req.preview_times, log=log)


@app.post("/studio/render")
def render_video(req: RenderRequest):
    return _submit("render", _render, req)


class StoryboardRequest(BaseModel):
    plan: dict
    times: list[float]
    out_dir: str
    width: int = 540


@app.post("/studio/storyboard")
def storyboard(req: StoryboardRequest):
    from studio.render import storyboard as sb
    try:
        return {"files": sb(req.plan, req.times, req.out_dir, req.width)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))


class TextRequest(BaseModel):
    text: str
    context: dict = {}


@app.post("/studio/parse-request")
def parse_request(req: TextRequest):
    from studio import llm
    ops, unhandled = llm.parse_request(req.text, req.context)
    return {"ops": ops, "unhandled": unhandled}


@app.post("/studio/classify-reply")
def classify_reply(req: TextRequest):
    from studio import llm
    return llm.classify_reply(req.text)


class LogoRequest(BaseModel):
    src: str
    out_dir: str


@app.post("/studio/brand/logo")
def brand_logo(req: LogoRequest):
    from studio import brand
    try:
        info = brand.prepare_logo(req.src, os.path.join(req.out_dir, "logo.png"))
        info["palette"] = brand.extract_palette(req.src)
        return info
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the logo: {e}")


@app.get("/studio/icons")
def icons():
    from studio.draw import icon_names
    return {"icons": icon_names()}


# ---------------------------------------------------------------- styles + machines
@app.get("/studio/styles")
def list_styles():
    from studio.styles import STYLES
    return {"styles": [{"key": k, **v} for k, v in STYLES.items()]}


class StyleRequest(BaseModel):
    path: str
    name: str | None = None
    card: bool = True              # ask Claude to watch it and write a style card (when a key is set)
    work_dir: str | None = None
    model: str = "claude-sonnet-5-5"


def _extract_style(req: StyleRequest, log):
    from studio.style_extract import extract
    log(f"measuring the edit of {os.path.basename(req.path)}: cuts, graphics, picture, captions, sound")
    out = extract(req.path, req.name)
    _env_refresh()
    from studio.director import claude
    if req.card and claude.available():
        from studio.director import style_card
        log("Claude is watching the reference video and writing the style card")
        try:
            res = style_card.make_card(req.path, out, out["name"], req.work_dir or os.path.join(os.path.dirname(req.path), "_card"), log, req.model)
            out.update(card=res["card"], params=res["params"], base=res["base"], summary=res["card"].get("summary") or out["summary"], usage=res["usage"])
            log(f"Style card written (${res['usage']['cost_usd']:.2f})")
        except Exception as e:  # noqa: BLE001
            log(f"Style card skipped: {str(e)[:200]}; the measured style is used")
    return out


@app.post("/studio/extract-style")
def extract_style(req: StyleRequest):
    return _submit("extract-style", _extract_style, req)


class MachineRequest(BaseModel):
    images: list[str]
    out_dir: str
    name: str = "Machine"
    cad: str | None = None
    method: str = "auto"          # auto: Claude builds it when a key is set; claude; relief (photo relief, no Claude)
    notes: str = ""
    model: str = "claude-opus-5-5"


def _build_machine(req: MachineRequest, log):
    from studio import machine
    _env_refresh()
    from studio.director import claude
    if not req.cad and req.method in ("auto", "claude") and claude.available():
        from studio.director import machine_build
        try:
            meta = machine_build.build(req.images, req.out_dir, req.name, req.notes, log, req.model)
            log(f"3D model ready: {os.path.basename(meta.get('glb') or '')} (${meta['usage']['cost_usd']:.2f})")
            return meta
        except Exception as e:  # noqa: BLE001
            if req.method == "claude":
                raise
            log(f"Claude could not build it ({str(e)[:160]}); building the photo relief instead")
    log(f"cutting the machine out of {len(req.images)} photo(s) and building the 3D model")
    return machine.build(req.images, req.out_dir, req.name, req.cad)


# ---------------------------------------------------------------- Claude director (Phase 3)
class DirectRequest(BaseModel):
    inputs: dict
    styles: list[dict]
    settings: dict = {}
    library: list[dict] = []
    work_dir: str
    previous: dict = {}
    request: str | None = None
    only: list[str] = []
    overrides: list[dict] = []


def _direct(req: DirectRequest, log):
    _env_refresh()
    from studio.director import director
    return director.direct(req.model_dump(), log)


@app.post("/studio/direct")
def direct(req: DirectRequest):
    return _submit("direct", _direct, req)


@app.post("/studio/machine/build")
def build_machine(req: MachineRequest):
    return _submit("machine", _build_machine, req)
