"""Speech-to-text. Uses faster-whisper when installed (local, free). Falls back to a supplied transcript (SRT/VTT/JSON)."""
from __future__ import annotations

import os
import re

_model = None


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def transcribe(wav_path: str, language: str | None = None) -> tuple[list[dict], str]:
    """Returns (segments, status). segments = [{start, end, text, words:[{start,end,word}]}]"""
    global _model
    if not whisper_available():
        return [], "unavailable: faster-whisper not installed"
    from faster_whisper import WhisperModel

    if _model is None:
        size = os.environ.get("WHISPER_MODEL", "small")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute = "int8" if device == "cpu" else "float16"
        _model = WhisperModel(size, device=device, compute_type=compute)
    segs, info = _model.transcribe(wav_path, language=language, word_timestamps=True, vad_filter=True)
    out = []
    for s in segs:
        out.append({
            "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
            "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in (s.words or [])],
        })
    return out, f"ok: whisper ({info.language}, p={info.language_probability:.2f})"


def _ts(s: str) -> float:
    s = s.strip().replace(",", ".")
    parts = s.split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_subtitles(text: str) -> list[dict]:
    """SRT or WebVTT -> segments."""
    out = []
    blocks = re.split(r"\r?\n\r?\n", text.strip())
    for b in blocks:
        m = re.search(r"(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})", b)
        if not m:
            continue
        body = b[m.end():].strip()
        body = re.sub(r"<[^>]+>", "", body).replace("\n", " ").strip()
        if body:
            out.append({"start": round(_ts(m.group(1)), 2), "end": round(_ts(m.group(2)), 2), "text": body, "words": []})
    return out


def text_between(segments: list[dict], start: float, end: float) -> str:
    parts = []
    for s in segments:
        if s["end"] > start and s["start"] < end:
            if s.get("words"):
                parts.extend(w["word"] for w in s["words"] if w["end"] > start and w["start"] < end)
            else:
                parts.append(s["text"])
    return " ".join(p for p in parts if p).strip()


def speech_seconds(segments: list[dict], start: float, end: float) -> float:
    total = 0.0
    for s in segments:
        a, b = max(start, s["start"]), min(end, s["end"])
        if b > a:
            total += b - a
    return total
