"""Logo drawing: animated vector build (when a vector redraw exists) or the cleaned raster logo."""
from __future__ import annotations

import functools
import json
import os

import skia

from . import draw as D
from .motion import clamp, ease_out_cubic, spring

BRAND_DIR = os.path.join(D.ASSETS, "brand")


@functools.lru_cache(maxsize=8)
def load_vector(path: str | None = None) -> dict | None:
    p = path or os.path.join(BRAND_DIR, "logo_vector.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _col(vec: dict, name: str, on_dark: bool) -> str:
    if on_dark and name in vec.get("on_dark", {}):
        return vec["on_dark"][name]
    return vec.get("colors", {}).get(name, name if name.startswith("#") else "#ffffff")


def vector_aspect(vec: dict) -> float:
    x0, y0, x1, y1 = vec["viewbox"]
    return (x1 - x0) / (y1 - y0)


def draw_vector(canvas: skia.Canvas, vec: dict, cx: float, cy: float, height: float, p: float = 1.0,
                on_dark: bool = False, alpha: float = 1.0) -> skia.Rect:
    """Draws the logo centred at (cx, cy). p in 0..1 animates the build (lines draw on, dots pop)."""
    x0, y0, x1, y1 = vec["viewbox"]
    s = height / (y1 - y0)
    w = (x1 - x0) * s
    canvas.save()
    canvas.translate(cx - w / 2, cy - height / 2)
    canvas.scale(s, s)
    canvas.translate(-x0, -y0)
    max_order = max(sh.get("order", 0) for sh in vec["shapes"]) or 1
    for sh in vec["shapes"]:
        k = sh.get("order", 0) / max_order
        start = k * 0.62
        lp = clamp((p - start) / 0.38) if p < 1 else 1.0
        if lp <= 0:
            continue
        kind = sh["kind"]
        if kind in ("line", "poly") and "stroke" in sh:
            path = skia.Path()
            pts = [sh["a"], sh["b"]] if kind == "line" else sh["points"]
            path.moveTo(*pts[0])
            for q in pts[1:]:
                path.lineTo(*q)
            if sh.get("closed"):
                path.close()
            paint = D.stroke(D.color(_col(vec, sh["stroke"], on_dark), alpha), sh.get("width", 1.5))
            if lp < 1:
                # TrimPathEffect.Make returns None for an empty trim (start of the build): draw nothing then
                pe = skia.TrimPathEffect.Make(0, ease_out_cubic(lp))
                if pe is None:
                    continue
                paint.setPathEffect(pe)
            canvas.drawPath(path, paint)
        elif kind == "poly":
            path = skia.Path()
            pts = sh["points"]
            path.moveTo(*pts[0])
            for q in pts[1:]:
                path.lineTo(*q)
            path.close()
            canvas.drawPath(path, D.fill(D.color(_col(vec, sh["fill"], on_dark), alpha * ease_out_cubic(lp))))
        elif kind in ("circle", "ring"):
            r = sh["r"] * (spring(lp) if lp < 1 else 1.0)
            if r <= 0:
                continue
            cxx, cyy = sh["c"]
            if kind == "circle":
                canvas.drawCircle(cxx, cyy, r, D.fill(D.color(_col(vec, sh["fill"], on_dark), alpha)))
            else:
                canvas.drawCircle(cxx, cyy, r, D.stroke(D.color(_col(vec, sh["stroke"], on_dark), alpha), sh.get("width", 2)))
    canvas.restore()
    return skia.Rect.MakeXYWH(cx - w / 2, cy - height / 2, w, height)


def draw_logo(canvas: skia.Canvas, brand, cx: float, cy: float, height: float, p: float = 1.0,
              on_dark: bool = False, alpha: float = 1.0) -> skia.Rect:
    """Vector logo when the brand kit has one (crisp + animated build), otherwise the cleaned raster logo."""
    vec_path = getattr(brand, "logo_vector_path", None)
    vec = load_vector(vec_path) if vec_path and os.path.exists(vec_path) else None
    if vec is not None:
        return draw_vector(canvas, vec, cx, cy, height, p, on_dark, alpha)
    path = (getattr(brand, "logo_light_path", None) if on_dark else None) or brand.logo_path
    img = D.load_image(path) if path else None
    if img is None:
        return skia.Rect.MakeXYWH(cx, cy, 0, 0)
    sc = spring(p) if p < 1 else 1.0
    h = height * sc
    return D.draw_image_contain(canvas, img, cx, cy, h * img.width() / img.height(), h, alpha=alpha * clamp(p * 3))
