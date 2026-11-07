"""Deterministic media measurements with FFmpeg / FFprobe."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def require_ffmpeg() -> None:
    if not shutil.which(FFMPEG) or not shutil.which(FFPROBE):
        raise RuntimeError("FFmpeg/FFprobe not found on PATH. Install FFmpeg and restart the analyzer.")


def _run(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")


@dataclass
class Probe:
    duration: float
    width: int | None
    height: int | None
    fps: float | None
    has_audio: bool
    aspect_ratio: str | None


def probe(path: str) -> Probe:
    r = _run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path])
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()[:300]}")
    info = json.loads(r.stdout)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    duration = float(info.get("format", {}).get("duration") or (v or {}).get("duration") or 0)
    fps = None
    if v and v.get("avg_frame_rate") and v["avg_frame_rate"] != "0/0":
        n, d = v["avg_frame_rate"].split("/")
        fps = float(n) / float(d) if float(d) else None
    w, h = (v or {}).get("width"), (v or {}).get("height")
    ar = None
    if w and h:
        ratio = w / h
        ar = "9:16" if abs(ratio - 9 / 16) < 0.05 else "16:9" if abs(ratio - 16 / 9) < 0.05 else "1:1" if abs(ratio - 1) < 0.05 else "4:5" if abs(ratio - 0.8) < 0.04 else f"{w}:{h}"
    return Probe(duration=duration, width=w, height=h, fps=fps, has_audio=a is not None, aspect_ratio=ar)


def detect_scenes(path: str, threshold: float = 0.30, duration: float | None = None) -> list[dict]:
    """Shot boundaries via FFmpeg scene score. Returns [{start, end}] covering the whole video."""
    r = _run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-an", "-vf", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"])
    cuts = sorted({round(float(m), 3) for m in re.findall(r"pts_time:([0-9.]+)", r.stderr)})
    dur = duration or 0
    bounds = [0.0] + [c for c in cuts if 0.2 < c < dur - 0.1] + [dur]
    scenes = []
    for s, e in zip(bounds, bounds[1:]):
        if e - s >= 0.1:
            scenes.append({"start": round(s, 3), "end": round(e, 3)})
    return scenes


def detect_silences(path: str, noise_db: int = -35, min_dur: float = 0.6) -> list[dict]:
    r = _run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-vn", "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", r.stderr)]
    out = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        out.append({"start": round(s, 3), "end": round(e, 3) if e is not None else None})
    return out


def loudness(path: str) -> dict:
    r = _run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    m = re.search(r"Integrated loudness:\s+I:\s+(-?[0-9.]+) LUFS", r.stderr)
    p = re.search(r"True peak:\s+Peak:\s+(-?[0-9.]+) dBFS", r.stderr)
    return {"integrated_lufs": float(m.group(1)) if m else None, "true_peak_dbfs": float(p.group(1)) if p else None}


def extract_frames(path: str, times: list[float], out_dir: str, width: int = 512) -> list[dict]:
    os.makedirs(out_dir, exist_ok=True)
    frames = []
    for t in times:
        fn = os.path.join(out_dir, f"frame_{t:08.2f}.jpg")
        r = _run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "4", "-y", fn])
        if r.returncode == 0 and os.path.exists(fn):
            frames.append({"t": round(t, 2), "path": fn})
    return frames


def extract_audio_wav(path: str) -> str | None:
    fd, out = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    r = _run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-y", out])
    return out if r.returncode == 0 else None


def frame_motion(path: str, seconds: float = 3.0) -> float | None:
    """Mean absolute luma difference between consecutive frames in the first `seconds` (0-255). Low = static/slow opening."""
    r = _run([FFMPEG, "-hide_banner", "-nostats", "-t", str(seconds), "-i", path, "-an", "-vf", "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"])
    vals = [float(x) for x in re.findall(r"lavfi\.signalstats\.YAVG=([0-9.]+)", r.stderr)]
    return round(sum(vals) / len(vals), 3) if vals else None
