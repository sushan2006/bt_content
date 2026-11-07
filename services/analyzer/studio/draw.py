"""Low-level skia drawing helpers: fonts, colours, text layout, shapes, icons, images."""
from __future__ import annotations

import functools
import os
import re

import numpy as np
import skia

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
FONT_DIR = os.path.join(ASSETS, "fonts")
ICON_DIR = os.path.join(ASSETS, "icons")


# ---------- colours ----------
def color(hex_or_name: str, alpha: float = 1.0) -> int:
    h = hex_or_name.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    a = int(max(0, min(1, alpha)) * 255)
    return skia.ColorSetARGB(a, r, g, b)


def mix(hex_a: str, hex_b: str, p: float) -> str:
    a = [int(hex_a.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    b = [int(hex_b.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{int(x + (y - x) * p):02x}" for x, y in zip(a, b))


# ---------- fonts ----------
@functools.lru_cache(maxsize=None)
def typeface(name: str) -> skia.Typeface:
    for ext in (".ttf", ".otf"):
        p = os.path.join(FONT_DIR, name + ext)
        if os.path.exists(p):
            tf = skia.Typeface.MakeFromFile(p)
            if tf:
                return tf
    return skia.Typeface("Arial")


def font(name: str, size: float) -> skia.Font:
    f = skia.Font(typeface(name), size)
    f.setSubpixel(True)
    f.setEdging(skia.Font.Edging.kSubpixelAntiAlias)
    return f


def text_width(text: str, f: skia.Font) -> float:
    return f.measureText(text)


def wrap(text: str, f: skia.Font, max_w: float, max_lines: int = 3) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = (cur + " " + w).strip()
        if not cur or text_width(trial, f) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[: max_lines - 1] + [" ".join(lines[max_lines - 1:])]
    return lines


def fit_font(text: str, name: str, size: float, max_w: float, max_lines: int, min_size: float) -> tuple[skia.Font, list[str]]:
    s = size
    while True:
        f = font(name, s)
        lines = wrap(text, f, max_w, max_lines=99)
        if (len(lines) <= max_lines and all(text_width(l, f) <= max_w for l in lines)) or s <= min_size:
            return f, wrap(text, f, max_w, max_lines)
        s *= 0.92


# ---------- paints ----------
def fill(c: int) -> skia.Paint:
    return skia.Paint(Color=c, AntiAlias=True, Style=skia.Paint.kFill_Style)


def stroke(c: int, width: float, cap=skia.Paint.kRound_Cap) -> skia.Paint:
    return skia.Paint(Color=c, AntiAlias=True, Style=skia.Paint.kStroke_Style, StrokeWidth=width,
                      StrokeCap=cap, StrokeJoin=skia.Paint.kRound_Join)


class Shadowed:
    """A fill paint plus a soft drop shadow (drawn with a cheap blur mask instead of an image filter)."""

    def __init__(self, paint: skia.Paint, blur: float, dy: float, alpha: float):
        self.paint, self.blur, self.dy, self.alpha = paint, blur, dy, alpha

    def shadow(self) -> skia.Paint:
        sp = fill(color("#000000", max(0.0, min(1.0, self.alpha))))
        sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, max(0.5, self.blur * 0.5)))
        return sp


def shadow_paint(base: skia.Paint, blur: float, dy: float, alpha: float = 0.45) -> Shadowed:
    return Shadowed(base, blur, dy, alpha)


def circle(canvas: skia.Canvas, cx: float, cy: float, r: float, paint) -> None:
    if isinstance(paint, Shadowed):
        canvas.drawCircle(cx, cy + paint.dy, r, paint.shadow())
        paint = paint.paint
    canvas.drawCircle(cx, cy, r, paint)


# ---------- text ----------
def draw_text(canvas: skia.Canvas, text: str, x: float, y: float, f: skia.Font, c: int,
              stroke_c: int | None = None, stroke_w: float = 0.0, shadow: float = 0.0, align: str = "left") -> float:
    """Draws one line; y is the baseline. Returns the drawn width."""
    w = text_width(text, f)
    if align == "center":
        x -= w / 2
    elif align == "right":
        x -= w
    blob = skia.TextBlob.MakeFromString(text, f)
    if blob is None:
        return w
    if shadow > 0:
        sp = fill(color("#000000", 0.55))
        sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, shadow))
        canvas.drawTextBlob(blob, x, y + shadow * 0.6, sp)
    if stroke_c is not None and stroke_w > 0:
        canvas.drawTextBlob(blob, x, y, stroke(stroke_c, stroke_w))
    canvas.drawTextBlob(blob, x, y, fill(c))
    return w


def cap_height(f: skia.Font) -> float:
    m = f.getMetrics()
    return -m.fAscent * 0.72


# ---------- shapes ----------
def rrect(canvas: skia.Canvas, x: float, y: float, w: float, h: float, r: float, paint) -> None:
    if isinstance(paint, Shadowed):
        canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(x, y + paint.dy, w, h), r, r), paint.shadow())
        paint = paint.paint
    canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(x, y, w, h), r, r), paint)


def vgradient(x: float, y: float, w: float, h: float, top: str, bottom: str, alpha: float = 1.0) -> skia.Paint:
    shader = skia.GradientShader.MakeLinear([skia.Point(x, y), skia.Point(x, y + h)], [color(top, alpha), color(bottom, alpha)])
    return skia.Paint(Shader=shader, AntiAlias=True)


def radial(cx: float, cy: float, r: float, inner: str, alpha: float) -> skia.Paint:
    shader = skia.GradientShader.MakeRadial(skia.Point(cx, cy), r, [color(inner, alpha), color(inner, 0.0)])
    return skia.Paint(Shader=shader, AntiAlias=True)


# ---------- icons ----------
@functools.lru_cache(maxsize=256)
def _icon_dom(name: str, hex_color: str, stroke_width: float):
    p = os.path.join(ICON_DIR, f"{name}.svg")
    if not os.path.exists(p):
        p = os.path.join(ICON_DIR, "sparkles.svg")
    svg = open(p, encoding="utf-8").read()
    svg = svg.replace("currentColor", hex_color)
    svg = re.sub(r'stroke-width="[0-9.]+"', f'stroke-width="{stroke_width}"', svg)
    svg = re.sub(r'width="24"', 'width="240"', svg, count=1)
    svg = re.sub(r'height="24"', 'height="240"', svg, count=1)
    dom = skia.SVGDOM.MakeFromStream(skia.MemoryStream(svg.encode("utf-8")))
    return dom


def icon_names() -> list[str]:
    return sorted(f[:-4] for f in os.listdir(ICON_DIR) if f.endswith(".svg"))


def draw_icon(canvas: skia.Canvas, name: str, cx: float, cy: float, size: float, hex_color: str, stroke_width: float = 2.2) -> None:
    dom = _icon_dom(name, hex_color, stroke_width)
    if dom is None:
        return
    dom.setContainerSize(skia.Size(240, 240))
    canvas.save()
    canvas.translate(cx - size / 2, cy - size / 2)
    canvas.scale(size / 240, size / 240)
    dom.render(canvas)
    canvas.restore()


# ---------- images ----------
@functools.lru_cache(maxsize=64)
def load_image(path: str) -> skia.Image | None:
    if not path or not os.path.exists(path):
        return None
    from PIL import Image as PILImage
    im = PILImage.open(path).convert("RGBA")
    arr = np.ascontiguousarray(np.array(im))
    return skia.Image.fromarray(arr, colorType=skia.kRGBA_8888_ColorType)


def draw_image_cover(canvas: skia.Canvas, img: skia.Image, dst: skia.Rect, focus_x: float = 0.5, focus_y: float = 0.5,
                     zoom: float = 1.0, radius: float = 0.0, alpha: float = 1.0) -> None:
    iw, ih = img.width(), img.height()
    scale = max(dst.width() / iw, dst.height() / ih) * zoom
    sw, sh = dst.width() / scale, dst.height() / scale
    sx = min(max(focus_x * iw - sw / 2, 0), iw - sw)
    sy = min(max(focus_y * ih - sh / 2, 0), ih - sh)
    src = skia.Rect.MakeXYWH(sx, sy, sw, sh)
    paint = skia.Paint(AntiAlias=True, Alphaf=alpha)
    canvas.save()
    if radius > 0:
        canvas.clipRRect(skia.RRect.MakeRectXY(dst, radius, radius), True)
    canvas.drawImageRect(img, src, dst, skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear), paint)
    canvas.restore()


def draw_image_contain(canvas: skia.Canvas, img: skia.Image, cx: float, cy: float, max_w: float, max_h: float, alpha: float = 1.0) -> skia.Rect:
    s = min(max_w / img.width(), max_h / img.height())
    w, h = img.width() * s, img.height() * s
    dst = skia.Rect.MakeXYWH(cx - w / 2, cy - h / 2, w, h)
    canvas.drawImageRect(img, dst, skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear), skia.Paint(AntiAlias=True, Alphaf=alpha))
    return dst
