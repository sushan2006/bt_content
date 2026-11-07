"""Optional visual understanding.
- OCR of on-screen text with Tesseract if installed (pytesseract or CLI).
- Frame descriptions with a vision LLM (Anthropic Claude) when ANTHROPIC_API_KEY is set.
Without these the pipeline still runs; visual fields are marked 'unknown' for human correction.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess

import httpx


def ocr_available() -> bool:
    return shutil.which(os.environ.get("TESSERACT_BIN", "tesseract")) is not None


def ocr(path: str) -> str:
    if not ocr_available():
        return ""
    r = subprocess.run([os.environ.get("TESSERACT_BIN", "tesseract"), path, "-", "--psm", "11"], capture_output=True, text=True, timeout=60)
    txt = " ".join(w for w in r.stdout.split() if len(w) > 1 and any(c.isalnum() for c in w))
    return txt[:300]


VISION_PROMPT = """You are analysing frames sampled from a company's marketing video (product: {product}; company: {company}).
For each frame (timestamp in seconds is given before each image) describe what is visible.
Then answer about the OPENING (first 3 seconds) of the video.
Return ONLY JSON:
{{"frames":[{{"t":0.5,"description":"...","product_visible":true,"person_visible":false,"text_on_screen":"...","shot_type":"close-up|medium|wide|screen|graphic","is_demonstration":false,"is_diagram_or_animation":false,"logo_or_company_branding":false}}],
 "opening":{{"product_visible_by_sec":1.0 or null,"main_subject":"...","subject_clear_by_sec":1.0 or null,"surprising_visual":false,"starts_with_demo":false,"starts_with_company_branding":false,"shows_finished_product_first":false}},
 "visual_style":"talking_head|product_closeup|factory_process|screen_recording|animation|mixed|lifestyle",
 "has_diagrams_or_animations":false,
 "notes":"..."}}
Only describe what is visible. Use null when unsure."""


def describe_frames(frames: list[dict], product: str | None, company: str | None) -> dict | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not frames:
        return None
    content: list[dict] = [{"type": "text", "text": VISION_PROMPT.format(product=product or "unknown", company=company or "unknown")}]
    for f in frames[:20]:
        with open(f["path"], "rb") as fh:
            data = base64.b64encode(fh.read()).decode()
        content.append({"type": "text", "text": f"t={f['t']}s"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}})
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": 3000, "messages": [{"role": "user", "content": content}]},
            timeout=120,
        )
        r.raise_for_status()
        text = r.json()["content"][0]["text"]
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:300]}
