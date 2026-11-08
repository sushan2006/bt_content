"""Optional visual understanding.
- OCR of on-screen text with Tesseract if installed (pytesseract or CLI).
Visual judgements that need a person (product visible, demo first) are left 'unknown' for human correction.
"""
from __future__ import annotations

import os
import shutil
import subprocess


def ocr_available() -> bool:
    return shutil.which(os.environ.get("TESSERACT_BIN", "tesseract")) is not None


def ocr(path: str) -> str:
    if not ocr_available():
        return ""
    r = subprocess.run([os.environ.get("TESSERACT_BIN", "tesseract"), path, "-", "--psm", "11"], capture_output=True, text=True, timeout=60)
    txt = " ".join(w for w in r.stdout.split() if len(w) > 1 and any(c.isalnum() for c in w))
    return txt[:300]
