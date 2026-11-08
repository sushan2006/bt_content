"""Video service tests: python -m pytest services/analyzer/tests"""
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

import app as service  # noqa: E402
from studio import brand, style_extract  # noqa: E402

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
needs_ffmpeg = pytest.mark.skipif(shutil.which(FFMPEG) is None, reason="ffmpeg not installed")


def _clip(path: str, seconds: int = 6):
    """Three hard cuts between solid colours with a tone: a tiny 'edited' video."""
    parts = [f"color=c={c}:s=360x640:d={seconds / 3}" for c in ("0x203050", "0xd0c0a0", "0x205030")]
    inputs = sum((["-f", "lavfi", "-i", p] for p in parts), [])
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}",
                    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", "-shortest",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path], check=True)


@needs_ffmpeg
def test_style_extract_measures_cuts_and_reports_in_words():
    d = tempfile.mkdtemp()
    p = os.path.join(d, "ref.mp4")
    _clip(p)
    out = style_extract.extract(p, "Test style")
    assert out["name"] == "Test style"
    assert 1 <= len(out["measured"]["cuts"]) <= 4          # the two colour changes are found
    assert any(line.startswith("Cuts every") for line in out["report"])
    assert not any("built-in" in line for line in out["report"])   # no references to the old renderer's styles
    assert "base" not in out and "params" not in out


def test_logo_palette(tmp_path):
    from PIL import Image
    img = Image.new("RGB", (120, 120), (255, 255, 255))
    for x in range(20, 100):
        for y in range(20, 60):
            img.putpixel((x, y), (25, 162, 135))
        for y in range(60, 100):
            img.putpixel((x, y), (242, 156, 19))
    p = tmp_path / "logo.png"
    img.save(p)
    pal = brand.extract_palette(str(p))
    assert pal.get("primary", "").startswith("#")


def test_service_has_no_editing_or_paid_api_endpoints():
    paths = {r.path for r in service.app.routes}
    assert {"/health", "/analyze", "/studio/extract-style", "/studio/brand/logo", "/studio/tasks/{tid}"} <= paths
    for gone in ("/studio/plan", "/studio/render", "/studio/direct", "/studio/analyze-takes", "/studio/classify-reply", "/studio/machine/build"):
        assert gone not in paths
    h = TestClient(service.app).get("/health").json()
    assert h["ok"] is True and "director" not in h and "vision_llm" not in h


def test_no_anthropic_calls_anywhere_in_the_service():
    root = os.path.join(os.path.dirname(__file__), "..")
    for base, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".venv", "__pycache__", "tests")]
        for f in files:
            if f.endswith(".py"):
                text = open(os.path.join(base, f), encoding="utf-8").read()
                assert "api.anthropic.com" not in text and "ANTHROPIC_API_KEY" not in text, f
