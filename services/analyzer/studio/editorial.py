"""Editorial style (version E): the fast, story-led look of top short-form explainers.

What it adds on top of the base renderer:
  * full-screen cutaways every few seconds, in two looks:
      light: white studio with a soft floor, 3D halftone shapes and numbers (extruded, dotted face, reflection)
      dark:  the technical 3D illustrations full frame on the dark network background
  * a whip-pan entrance with motion blur on every cutaway
  * kinetic captions: 1 to 3 words at a time, each word pops in as it is spoken, key words drawn large
  * punch-in / punch-out between shots (the plan's edit.punches)
  * big text behind the speaker (person matte from MODNet)
  * sound design generated in code (whoosh, swish, pop, tick, hit, riser) placed on cuts and graphic beats
  * an original music bed generated in code (no licence questions), kept low under the voice
"""
from __future__ import annotations

import math
import os
import re

import numpy as np
import skia

from . import draw as D
from .logo import draw_logo
from .motion import clamp, ease_in_out, ease_out_back, ease_out_cubic, lerp, progress, spring

MODEL_DIR = os.path.join(os.path.dirname(__file__), "assets", "models")


# ---------------------------------------------------------------- colour helpers
def _hex(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(h: str, f: float) -> str:
    r, g, b = _hex(h)
    if f >= 0:
        r, g, b = (int(c + (255 - c) * f) for c in (r, g, b))
    else:
        r, g, b = (int(c * (1 + f)) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def C(h: str, a: float = 1.0) -> int:
    return D.color(h, a)


INK = "#14181F"


# ---------------------------------------------------------------- paths
def text_path(text: str, f: skia.Font) -> skia.Path:
    glyphs = f.textToGlyphs(text)
    xs = f.getXPos(glyphs)
    p = skia.Path()
    for gid, x in zip(glyphs, xs):
        gp = f.getPath(gid)
        if gp:
            p.addPath(gp, x, 0)
    return p


def fit_text_font(text: str, name: str, max_w: float, max_size: float) -> skia.Font:
    f = D.font(name, max_size)
    w = D.text_width(text, f)
    if w > max_w:
        f = D.font(name, max_size * max_w / w)
    return f


# ---------------------------------------------------------------- 3D halftone object
_TEX: dict = {}


def _halftone_tex(w: int, h: int, base: str, step: float) -> skia.Image:
    """Face texture: brand colour with a dot screen whose dots grow toward the lit corner, plus a gloss band."""
    key = (w, h, base, round(step, 1))
    if key in _TEX:
        return _TEX[key]
    surf = skia.Surface(max(1, w), max(1, h))
    c = surf.getCanvas()
    sh = skia.GradientShader.MakeLinear([skia.Point(0, 0), skia.Point(w * 0.4, h)], [C(shade(base, 0.12)), C(base), C(shade(base, -0.28))], [0, 0.5, 1])
    c.drawRect(skia.Rect.MakeWH(w, h), skia.Paint(Shader=sh))
    dot = D.fill(C(shade(base, 0.55), 0.85))
    lx, ly = w * 0.25, h * 0.15
    diag = math.hypot(w, h)
    y = step / 2
    row = 0
    while y < h + step:
        x = step / 2 + (step / 2 if row % 2 else 0)
        while x < w + step:
            d = math.hypot(x - lx, y - ly) / diag
            r = step * 0.46 * clamp(1.05 - d * 1.25, 0.18, 1.0)
            c.drawCircle(x, y, r, dot)
            x += step
        y += step * 0.866
        row += 1
    # gloss band
    g = skia.GradientShader.MakeLinear([skia.Point(0, h * 0.1), skia.Point(w * 0.5, h * 0.55)],
                                       [C("#FFFFFF", 0.0), C("#FFFFFF", 0.22), C("#FFFFFF", 0.0)], [0.3, 0.5, 0.7])
    c.drawRect(skia.Rect.MakeWH(w, h), skia.Paint(Shader=g))
    img = surf.makeImageSnapshot()
    _TEX[key] = img
    return img


def draw_halftone_path(canvas: skia.Canvas, path: skia.Path, base: str, u: float, depth: float = 1.0, alpha: float = 1.0,
                       shine: float = -1.0, reflect: float = 0.0) -> None:
    """Extruded 3D object: dark side walls, halftone face, rim light, optional moving shine and floor reflection."""
    b = path.getBounds()
    if b.isEmpty():
        return
    ext = 22 * u * depth
    steps = max(4, int(ext / (2.2 * u)))
    side = C(shade(base, -0.62), alpha)
    side2 = C(shade(base, -0.45), alpha)
    # contact shadow
    sp = D.fill(C("#000000", 0.18 * alpha))
    sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 26 * u))
    canvas.drawOval(skia.Rect.MakeLTRB(b.left() + b.width() * 0.04, b.bottom() + ext * 0.4, b.right() + ext, b.bottom() + ext * 0.4 + 46 * u), sp)
    for k in range(steps, 0, -1):
        d = ext * k / steps
        canvas.save()
        canvas.translate(d * 0.55, d)
        canvas.drawPath(path, D.fill(side if k > steps * 0.35 else side2))
        canvas.restore()
    tex = _halftone_tex(int(b.width()) + 2, int(b.height()) + 2, base, 15 * u)
    canvas.saveLayer(skia.Rect.MakeLTRB(b.left() - 2, b.top() - 2, b.right() + 2, b.bottom() + 2), skia.Paint(Alphaf=alpha))
    canvas.clipPath(path, skia.ClipOp.kIntersect, True)
    canvas.drawImage(tex, b.left(), b.top())
    if 0 <= shine <= 1:
        x = lerp(b.left() - b.width() * 0.5, b.right() + b.width() * 0.5, shine)
        g = skia.GradientShader.MakeLinear([skia.Point(x - b.width() * 0.18, b.top()), skia.Point(x + b.width() * 0.18, b.bottom())],
                                           [C("#FFFFFF", 0), C("#FFFFFF", 0.55), C("#FFFFFF", 0)])
        canvas.drawRect(b, skia.Paint(Shader=g))
    canvas.restore()
    canvas.drawPath(path, D.stroke(C(shade(base, 0.6), 0.55 * alpha), 1.6 * u))
    if reflect > 0:
        canvas.save()
        floor = b.bottom() + ext
        canvas.translate(0, floor * 2)
        canvas.scale(1, -1)
        canvas.saveLayer(skia.Rect.MakeLTRB(b.left() - 2, b.top() - 2, b.right() + ext + 2, b.bottom() + 2), skia.Paint(Alphaf=reflect * alpha))
        canvas.drawPath(path, D.fill(C(shade(base, 0.1))))
        fade = skia.GradientShader.MakeLinear([skia.Point(0, b.bottom()), skia.Point(0, b.bottom() - b.height() * 0.55)], [C("#000000", 1), C("#000000", 0)])
        canvas.drawRect(b, skia.Paint(Shader=fade, BlendMode=skia.BlendMode.kDstIn))
        canvas.restore()
        canvas.restore()


def triangle_path(cx: float, cy: float, s: float, rot: float = 0.0) -> skia.Path:
    p = skia.Path()
    for k in range(3):
        a = rot - math.pi / 2 + k * 2 * math.pi / 3
        x, y = cx + s * math.cos(a), cy + s * math.sin(a)
        (p.moveTo if k == 0 else p.lineTo)(x, y)
    p.close()
    return p


def arrow_path(cx: float, cy: float, s: float, direction: float) -> skia.Path:
    """Solid chevron-free arrowhead (the little ◀ ▶ markers beside big numbers)."""
    p = skia.Path()
    p.moveTo(cx + s * direction, cy)
    p.lineTo(cx - s * 0.6 * direction, cy - s * 0.8)
    p.lineTo(cx - s * 0.6 * direction, cy + s * 0.8)
    p.close()
    return p


# ---------------------------------------------------------------- backgrounds
_BG: dict = {}


def light_bg(ctx, canvas: skia.Canvas, t: float) -> None:
    W, H, u = ctx.W, ctx.H, ctx.u
    key = ("light", W, H)
    if key not in _BG:
        surf = skia.Surface(W, H)
        c = surf.getCanvas()
        sh = skia.GradientShader.MakeLinear([skia.Point(0, 0), skia.Point(0, H)],
                                            [C("#FFFFFF"), C("#F6F7F9"), C("#E4E7EC"), C("#CDD2DA")], [0, 0.55, 0.74, 1])
        c.drawRect(skia.Rect.MakeWH(W, H), skia.Paint(Shader=sh))
        # horizon line of the studio floor
        g = skia.GradientShader.MakeLinear([skia.Point(0, H * 0.70), skia.Point(0, H * 0.76)], [C("#FFFFFF", 0.0), C("#9AA3B2", 0.22), C("#FFFFFF", 0.0)])
        c.drawRect(skia.Rect.MakeLTRB(0, H * 0.70, W, H * 0.76), skia.Paint(Shader=g))
        dot = D.fill(C("#1E2A3A", 0.05))
        step = 34 * u
        y = step
        while y < H * 0.68:
            x = step
            while x < W:
                c.drawCircle(x, y, 2.0 * u, dot)
                x += step
            y += step
        v = skia.GradientShader.MakeRadial(skia.Point(W / 2, H * 0.42), H * 0.75, [C("#000000", 0.0), C("#000000", 0.10)], [0.55, 1])
        c.drawRect(skia.Rect.MakeWH(W, H), skia.Paint(Shader=v))
        _BG[key] = surf.makeImageSnapshot()
    canvas.drawImage(_BG[key], 0, 0)


def dark_bg(ctx, canvas: skia.Canvas, t: float) -> None:
    from .graphics import draw_network_bg
    canvas.drawRect(skia.Rect.MakeWH(ctx.W, ctx.H), D.fill(ctx.col("darker")))
    draw_network_bg(ctx, canvas, t, skia.Rect.MakeWH(ctx.W, ctx.H), 1.0, 1.0)
    v = skia.GradientShader.MakeRadial(skia.Point(ctx.W / 2, ctx.H * 0.45), ctx.H * 0.7, [C("#000000", 0.0), C("#000000", 0.45)], [0.5, 1])
    canvas.drawRect(skia.Rect.MakeWH(ctx.W, ctx.H), skia.Paint(Shader=v))


# ---------------------------------------------------------------- light-look content
def _float(t: float, amp: float, speed: float = 1.3, phase: float = 0.0) -> float:
    return math.sin(t * speed + phase) * amp


def content_big_text(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    """A giant extruded halftone word or number. params: text, count_to (optional), prefix/suffix, sub, arrows, color."""
    W, H, u = ctx.W, ctx.H, ctx.u
    base = shade(ctx.hexc(prm.get("color", "primary")), prm.get("shade", -0.18))
    text = str(prm.get("text", ""))
    if "count_to" in prm:
        p = ease_out_cubic(progress(tl, 0.05, prm.get("count_time", 0.7)))
        v = prm["count_to"] * p
        dec = int(prm.get("decimals", 0))
        text = f"{prm.get('prefix', '')}{v:.{dec}f}{prm.get('suffix', '')}"
        full = f"{prm.get('prefix', '')}{prm['count_to']:.{dec}f}{prm.get('suffix', '')}"
    else:
        full = text
    f = fit_text_font(full, prm.get("font", "Montserrat-Black"), W * prm.get("width", 0.80), prm.get("size", 360) * u)
    path = text_path(text, f)
    fb = text_path(full, f).getBounds()
    cy = H * prm.get("y", 0.40)
    e = spring(progress(tl, 0.0, 0.55))
    sc = lerp(0.55, 1.0, e) * (1 + 0.025 * progress(tl, 0.5, max(0.6, dur)))
    rot = lerp(-7, 0, ease_out_cubic(progress(tl, 0, 0.5)))
    canvas.save()
    canvas.translate(W / 2, cy + _float(tl, 8 * u))
    canvas.rotate(rot)
    canvas.scale(sc, sc)
    canvas.translate(-fb.centerX(), -fb.centerY())
    draw_halftone_path(canvas, path, base, u, depth=1.3, alpha=clamp(tl / 0.12), shine=progress(tl, 0.35, 0.9), reflect=0.16)
    canvas.restore()
    if prm.get("arrows"):
        hw = fb.width() * sc / 2 + 48 * u
        for d in (-1, 1):
            s = 26 * u * ease_out_back(progress(tl, 0.25, 0.35))
            x = W / 2 + d * (hw + _float(tl, 6 * u, 4.0))
            if s > 0:
                draw_halftone_path(canvas, arrow_path(x, cy, s, d), base, u * 0.6, depth=0.8)
    if prm.get("sub"):
        p = ease_out_cubic(progress(tl, 0.3, 0.4))
        fs = D.font("Montserrat-ExtraBold", prm.get("sub_size", 58) * u)
        y = cy + fb.height() * sc / 2 + 120 * u
        D.draw_text(canvas, prm["sub"].upper(), W / 2, y + (1 - p) * 30 * u, fs, C(INK, p), align="center")


def content_shapes(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    """Floating halftone triangles with labels (the reference's 'Fewer games / Limited software' beats).
    params: items [{label, at}], color."""
    W, H, u = ctx.W, ctx.H, ctx.u
    base = shade(ctx.hexc(prm.get("color", "primary")), prm.get("shade", -0.18))
    items = prm.get("items", [])
    n = max(1, len(items))
    for k, it in enumerate(items):
        at = it.get("at", k * 0.35)
        p = spring(progress(tl, at, 0.5))
        if p <= 0:
            continue
        cx = W * (0.5 if n == 1 else lerp(0.27, 0.73, k / (n - 1)))
        cy = H * (0.30 + (0.08 if k % 2 else 0)) + _float(tl, 10 * u, 1.6, k)
        s = (190 if n <= 2 else 150) * u * p
        rot = _float(tl, 0.06, 1.1, k * 2)
        draw_halftone_path(canvas, triangle_path(cx, cy, s, rot), base, u, depth=1.0, alpha=clamp(p * 2))
        f = D.font("Inter-Bold", 36 * u)
        lines = D.wrap(it.get("label", ""), f, s * 1.2, 2)
        for j, ln in enumerate(lines):
            D.draw_text(canvas, ln, cx, cy + s * 0.32 + j * 42 * u, f, C("#FFFFFF", clamp(p)), align="center", shadow=3 * u)


def content_brand(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    """Logo build + wordmark + role pill."""
    W, H, u = ctx.W, ctx.H, ctx.u
    p = progress(tl, 0.0, 0.9)
    float_y = _float(tl, 8 * u)
    draw_logo(canvas, ctx.brand, W / 2, H * 0.30 + float_y, H * 0.17, p=p, on_dark=False)
    name = prm.get("name") or ctx.brand.company_name
    pe = ease_out_cubic(progress(tl, 0.35, 0.45))
    f = fit_text_font(name, "Montserrat-Black", W * 0.80, 128 * u)
    canvas.save()
    canvas.clipRect(skia.Rect.MakeLTRB(0, H * 0.40, W, H * 0.52))
    D.draw_text(canvas, name, W / 2, H * 0.49 + (1 - pe) * 120 * u, f, C(ctx.hexc("dark")), align="center")
    canvas.restore()
    if prm.get("role"):
        q = ease_out_back(progress(tl, 0.65, 0.4))
        if q > 0:
            fr = D.font("Inter-Bold", 44 * u)
            tw = D.text_width(prm["role"], fr) + 70 * u
            canvas.save()
            canvas.translate(W / 2, H * 0.56)
            canvas.scale(q, q)
            D.rrect(canvas, -tw / 2, -40 * u, tw, 80 * u, 40 * u, D.fill(ctx.col("primary")))
            D.draw_text(canvas, prm["role"], 0, 15 * u, fr, C("#FFFFFF"), align="center")
            canvas.restore()


def content_cta(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    W, H, u = ctx.W, ctx.H, ctx.u
    draw_logo(canvas, ctx.brand, W / 2, H * 0.26 + _float(tl, 6 * u), H * 0.12, p=progress(tl, 0, 0.8))
    p1 = ease_out_cubic(progress(tl, 0.25, 0.4))
    f = fit_text_font(prm.get("title", "Follow for more"), "Montserrat-Black", W * 0.84, 112 * u)
    D.draw_text(canvas, prm.get("title", "Follow for more"), W / 2, H * 0.43 + (1 - p1) * 40 * u, f, C(INK, p1), align="center")
    p2 = ease_out_back(progress(tl, 0.5, 0.45))
    if p2 > 0:
        handle = prm.get("handle") or ctx.brand.handle
        fr = D.font("Inter-Bold", 54 * u)
        tw = D.text_width(handle, fr) + 90 * u
        canvas.save()
        canvas.translate(W / 2, H * 0.52)
        canvas.scale(p2, p2)
        D.rrect(canvas, -tw / 2, -50 * u, tw, 100 * u, 50 * u, D.fill(ctx.col("primary")))
        D.draw_text(canvas, handle, 0, 19 * u, fr, C("#FFFFFF"), align="center")
        canvas.restore()
    p3 = progress(tl, 0.9, 0.4)
    if p3 > 0 and prm.get("sub"):
        fs = D.font("Inter-SemiBold", 40 * u)
        D.draw_text(canvas, prm["sub"], W / 2, H * 0.61, fs, C("#4A5363", p3), align="center")


def content_scene(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    """A 3D technical illustration, full frame."""
    from .illustrations import SCENES
    fn = SCENES.get(prm.get("scene", ""))
    if not fn:
        return
    W, H = ctx.W, ctx.H
    P = skia.Rect.MakeXYWH(W * 0.06, H * 0.17, W * 0.88, H * 0.44)
    fn(ctx, canvas, P, tl + prm.get("offset", 0.0), dur + prm.get("offset", 0.0), prm, 1.0)


def stage_bg(ctx, canvas, t):
    W, H, u = ctx.W, ctx.H, ctx.u
    key = ("stage", W, H)
    if key not in _BG:
        surf = skia.Surface(W, H)
        c = surf.getCanvas()
        sh = skia.GradientShader.MakeRadial(skia.Point(W * 0.5, H * 0.38), H * 0.78, [C("#24364B"), C("#152131"), C("#0A1019")], [0, 0.55, 1])
        c.drawRect(skia.Rect.MakeWH(W, H), skia.Paint(Shader=sh))
        dot = D.fill(C("#FFFFFF", 0.035))
        step = 40 * u
        y = step / 2
        while y < H:
            x = step / 2
            while x < W:
                c.drawCircle(x, y, 1.6 * u, dot)
                x += step
            y += step
        _BG[key] = surf.makeImageSnapshot()
    canvas.drawImage(_BG[key], 0, 0)


_STAGE: dict = {}


def content_stage(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    """A full-screen 3D explainer: the camera moves around the machine while the voice carries on."""
    from . import scene3d
    stage_bg(ctx, canvas, tl)
    if not _gl_ok() and prm.get("stage") == "kit":
        dark_bg(ctx, canvas, tl)
        content_big_text(ctx, canvas, {"text": (prm.get("asset") or {}).get("name", "")[:18] or " ", "size": 160, "y": 0.38}, tl, dur)
        return
    if not _gl_ok():
        from .schema import Graphic
        alt = {"energy": "energy_flow", "lift": "energy_flow", "motor_inside": "stator_rotor", "pump_inside": "impeller", "pump_flow": "impeller", "head": "specs"}
        content_scene(ctx, canvas, dict(prm, scene=alt.get(prm.get("stage"), "pump_set"), switch_at=0 if prm.get("stage") == "lift" else 99), tl, dur)
        return
    key = (prm.get("stage"), round(tl, 4), id(prm))
    if _STAGE.get("k") != key:
        img, labels = scene3d.render_stage(prm["stage"], prm, tl, dur, ctx.W, ctx.H, ctx.plan.format.fps)
        _STAGE["k"] = key
        _STAGE["v"] = (skia.Image.fromarray(np.ascontiguousarray(img), colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType), labels)
    img, labels = _STAGE["v"]
    canvas.drawImage(img, 0, 0, skia.SamplingOptions(), skia.Paint(ImageFilter=skia.ImageFilters.DropShadow(0, 26 * ctx.u, 30 * ctx.u, 30 * ctx.u, D.color("#000000", 0.45), None)))
    draw_labels(ctx, canvas, labels, tl, dur, 0.0, 1.0, 0.25)


from .styles import content_chapter, content_statement  # noqa: E402

CONTENT = {"stage": content_stage, "statement": content_statement, "chapter": content_chapter, "big_text": content_big_text, "shapes": content_shapes, "brand": content_brand, "cta": content_cta, "scene": content_scene}
from .diagram import content_diagram  # noqa: E402
CONTENT["diagram"] = content_diagram


def look_of(g) -> str:
    return g.params.get("look") or ("dark" if g.params.get("kind") in ("scene", "stage", "statement", "chapter", "diagram") else "light")


# ---------------------------------------------------------------- full-screen cutaway with whip entrance
_SURF: dict = {}


def _scratch(W: int, H: int) -> skia.Surface:
    key = (W, H)
    if key not in _SURF:
        _SURF[key] = skia.Surface(W, H)
    return _SURF[key]


def _paint_cutaway(ctx, canvas, g, t):
    tl = t - g.start
    if g.params.get("kind") not in ("stage", "statement", "chapter"):
        (light_bg if look_of(g) == "light" else dark_bg)(ctx, canvas, t)
    fn = CONTENT.get(g.params.get("kind", "big_text"))
    if fn:
        fn(ctx, canvas, g.params, tl, g.end - g.start)


TRANSITIONS = ("cut", "whip", "fade", "zoom")
T_IN = {"whip": 0.38, "fade": 0.32, "zoom": 0.36}      # seconds the entrance takes
T_OUT = {"whip": 0.30, "fade": 0.28, "zoom": 0.30}     # seconds the exit takes


def _transition_phase(g, tl: float, dur: float):
    """('in' | 'out', progress 0..1 of the move, how) while a full-screen beat enters or leaves, else None.
    Entrance and exit never overlap: on a short beat the exit is skipped rather than squeezed."""
    how_in = g.params.get("enter", "whip")
    how_out = g.params.get("exit", "cut")
    if how_in in T_IN and tl < T_IN[how_in]:
        return "in", tl / T_IN[how_in], how_in
    if how_out in T_OUT and dur - tl < T_OUT[how_out] and dur >= T_IN.get(how_in, 0.0) + T_OUT[how_out] + 0.6:
        return "out", (dur - tl) / T_OUT[how_out], how_out
    return None


def draw_fullscreen(ctx, canvas: skia.Canvas, g, t: float) -> None:
    """A full-screen cutaway over the speaker. Entrances and exits:
      cut  - straight cut on the word (the default for explainers: clean, no lag)
      whip - slides in fast with motion blur (and out the other way)
      fade - short dissolve between the speaker and the cutaway
      zoom - the cutaway scales in from 108 % while it fades in (out: scales to 96 % while it fades)
    Every move is eased (quintic/cubic) and lasts 0.28-0.38 s, so it reads as smooth at 30 fps without slowing the edit."""
    tl = t - g.start
    dur = g.end - g.start
    W, H = ctx.W, ctx.H
    phase = _transition_phase(g, tl, dur)
    if phase is None:
        _paint_cutaway(ctx, canvas, g, t)
        return
    side, p, how = phase
    from .scene3d import ease_in_cubic, ease_out_quint
    surf = _scratch(W, H)
    sc = surf.getCanvas()
    sc.clear(skia.ColorTRANSPARENT)
    _paint_cutaway(ctx, sc, g, t)
    img = surf.makeImageSnapshot()
    lin = skia.SamplingOptions(skia.FilterMode.kLinear)
    d = g.params.get("dir", 1)
    if how == "whip":
        # in: from the side to the centre, out: from the centre off the other side; a few faded copies give the motion blur
        if side == "in":
            e = ease_out_quint(p)
            x = (1 - e) * W * d
            speed = 5 * (1 - p) ** 4
        else:
            q = 1 - p
            x = -ease_in_cubic(q) * W * d
            speed = 3 * q ** 2
        vel = speed * W / T_IN["whip"] / 30
        n = 9
        for k in range(n):
            off = d * vel * 0.6 * (k / (n - 1) - 0.5)
            canvas.drawImage(img, x + off, 0, lin, skia.Paint(Alphaf=1.0 / (k + 1)))
        return
    if how == "fade":
        e = ease_out_quint(p) if side == "in" else ease_in_cubic(p)
        canvas.drawImage(img, 0, 0, lin, skia.Paint(Alphaf=max(0.0, min(1.0, e))))
        return
    # zoom
    if side == "in":
        e = ease_out_quint(p)
        scale = 1.08 - 0.08 * e
    else:
        e = ease_in_cubic(p)
        scale = 0.96 + 0.04 * e
    canvas.save()
    canvas.translate(W / 2, H / 2)
    canvas.scale(scale, scale)
    canvas.translate(-W / 2, -H / 2)
    canvas.drawImage(img, 0, 0, lin, skia.Paint(Alphaf=max(0.0, min(1.0, e))))
    canvas.restore()


# ---------------------------------------------------------------- text behind the speaker
class Matte:
    """Person matte (MODNet, Apache-2.0). Runs only on frames that need it."""

    _sess = None

    @classmethod
    def available(cls) -> bool:
        return os.path.exists(os.path.join(MODEL_DIR, "modnet.onnx"))

    @classmethod
    def session(cls):
        if cls._sess is None:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = int(os.environ.get("STUDIO_MATTE_THREADS", "2"))
            cls._sess = ort.InferenceSession(os.path.join(MODEL_DIR, "modnet.onnx"), so, providers=["CPUExecutionProvider"])
        return cls._sess

    @classmethod
    def alpha(cls, rgba: np.ndarray) -> np.ndarray:
        import cv2
        H, W = rgba.shape[:2]
        h = 512
        w = int(round(W * h / H / 32)) * 32
        x = cv2.resize(rgba[..., :3], (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 127.5 - 1.0
        s = cls.session()
        m = s.run(None, {s.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]
        m = cv2.resize(m, (W, H), interpolation=cv2.INTER_LINEAR)
        return np.clip(m, 0, 1)


def draw_text_behind(ctx, canvas: skia.Canvas, g, t: float) -> None:
    """Draws the big text only; the compositor puts the speaker back on top with the matte."""
    W, H, u = ctx.W, ctx.H, ctx.u
    tl = t - g.start
    lines = g.params.get("lines") or [g.params.get("text", "")]
    y0 = H * g.params.get("y", 0.30)
    colors = g.params.get("colors") or ["#FFFFFF"] * len(lines)
    for k, ln in enumerate(lines):
        p = ease_out_back(progress(tl, 0.06 * k, 0.4))
        a = clamp(progress(tl, 0.06 * k, 0.12)) * (1 - progress(tl, g.end - g.start - 0.15, 0.15))
        f = fit_text_font(ln, "Montserrat-Black", W * 0.94, g.params.get("size", 300) * u)
        m = f.getMetrics()
        lh = (-m.fAscent) * 0.92
        y = y0 + k * lh
        sc = lerp(1.25, 1.0, p)
        canvas.save()
        canvas.translate(W / 2, y)
        canvas.scale(sc, sc)
        sp = D.fill(C("#000000", 0.35 * a))
        sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 18 * u))
        blob = skia.TextBlob.MakeFromString(ln, f)
        w = D.text_width(ln, f)
        canvas.drawTextBlob(blob, -w / 2, 10 * u, sp)
        col = ctx.hexc(colors[k % len(colors)])
        sh = skia.GradientShader.MakeLinear([skia.Point(0, -lh), skia.Point(0, 0)], [C(shade(col, 0.0), a), C(shade(col, -0.12), a)])
        canvas.drawTextBlob(blob, -w / 2, 0, skia.Paint(Shader=sh, AntiAlias=True))
        canvas.restore()


# ---------------------------------------------------------------- kinetic captions
_WORD = re.compile(r"[^\w.%'-]+")


def _key(w: str) -> str:
    return re.sub(r"[^\w.]", "", w.lower())


def kinetic_chunks(words: list[dict], emphasis: list[str], max_words: int = 3) -> list[dict]:
    from .captions import FILLERS
    emph = {_key(e) for e in emphasis}
    ws = [w for w in words if _key(w["text"]) not in FILLERS and w["text"].strip()]
    chunks, cur = [], []
    for w in ws:
        is_e = _key(w["text"]) in emph
        if cur:
            gap = w["start"] - cur[-1]["end"]
            prev = cur[-1]["text"]
            if len(cur) >= max_words or gap > 0.32 or re.search(r"[.!?,;:]$", prev) or is_e and len(cur) >= 2 \
                    or any(_key(c["text"]) in emph for c in cur) and len(cur) >= 2:
                chunks.append(cur)
                cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    out = []
    for i, c in enumerate(chunks):
        nxt = chunks[i + 1][0]["start"] if i + 1 < len(chunks) else None
        end = c[-1]["end"] + 0.35
        if nxt is not None:
            end = nxt if nxt - end < 0.3 else min(end, nxt)
        out.append({"words": c, "start": c[0]["start"], "end": end, "emph": [(_key(w["text"]) in emph) for w in c]})
    return out


class KineticCaptions:
    def __init__(self, style, W: int, H: int):
        self.s, self.W, self.H = style, W, H
        self.u = W / 1080.0
        self.chunks: list[dict] = []
        self._lay: dict = {}

    def set_words(self, words, emphasis):
        self.chunks = kinetic_chunks(words, emphasis, max(2, min(3, self.s.max_words)))

    def _layout(self, i: int):
        if i in self._lay:
            return self._lay[i]
        ch = self.chunks[i]
        u = self.u
        small = D.font("Inter-Bold", self.s.size * self.W * 0.82)
        rows: list[dict] = []
        cur = None
        for w, e in zip(ch["words"], ch["emph"]):
            txt = re.sub(r"[,;:]$", "", w["text"].strip())
            if e:
                f = fit_text_font(txt, "Montserrat-Black", self.W * 0.86, self.s.size * self.W * 2.1)
                rows.append({"items": [(txt, f, w)], "big": True})
                cur = None
            else:
                if cur is None or cur["big"]:
                    cur = {"items": [], "big": False}
                    rows.append(cur)
                cur["items"].append((txt, small, w))
        for r in rows:
            sp = D.text_width(" ", r["items"][0][1])
            r["widths"] = [D.text_width(x[0], x[1]) for x in r["items"]]
            r["total"] = sum(r["widths"]) + sp * (len(r["items"]) - 1)
            m = r["items"][0][1].getMetrics()
            r["h"] = (-m.fAscent) * (0.95 if r["big"] else 1.15)
            r["sp"] = sp
        self._lay[i] = rows
        return rows

    def draw(self, canvas: skia.Canvas, t: float, cy_frac: float, on_light: bool = False) -> None:
        if not self.s.enabled:
            return
        i = next((k for k, c in enumerate(self.chunks) if c["start"] - 0.02 <= t < c["end"]), None)
        if i is None:
            return
        rows = self._layout(i)
        total_h = sum(r["h"] for r in rows)
        y = self.H * cy_frac - total_h / 2
        u = self.u
        for r in rows:
            y += r["h"]
            x = self.W / 2 - r["total"] / 2
            for (txt, f, w), wd in zip(r["items"], r["widths"]):
                p = progress(t, w["start"] - 0.03, 0.12)
                if p <= 0:
                    x += wd + r["sp"]
                    continue
                sc = lerp(0.7, 1.0, ease_out_back(p))
                a = clamp(p * 2.5)
                if r["big"]:
                    col = ctx_col = self.s.highlight if not on_light else "#1F4FD6"
                else:
                    col = INK if on_light else self.s.color
                cx = x + wd / 2
                canvas.save()
                canvas.translate(cx, y - r["h"] * 0.35)
                canvas.scale(sc, sc)
                canvas.translate(-cx, -(y - r["h"] * 0.35))
                if not on_light:
                    blob = skia.TextBlob.MakeFromString(txt, f)
                    sp = D.fill(C("#000000", 0.55 * a))
                    sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 7 * u))
                    canvas.drawTextBlob(blob, x, y + 3 * u, sp)
                    if r["big"]:
                        canvas.drawTextBlob(blob, x, y, D.stroke(C("#000000", 0.85 * a), f.getSize() * 0.07))
                D.draw_text(canvas, txt, x, y, f, C(col, a))
                canvas.restore()
                x += wd + r["sp"]


# ---------------------------------------------------------------- shots (punch-ins)
def punch_at(edit: dict, t: float) -> tuple[float, float, float]:
    """Returns (zoom, x_shift_frac, local_time) for the shot covering t."""
    ps = edit.get("punches") or []
    cur = (0.0, 1.0, 0.0)
    for p in ps:
        if p["t"] <= t:
            cur = (p["t"], p.get("zoom", 1.0), p.get("dx", 0.0))
        else:
            break
    t0, z, dx = cur
    tl = t - t0
    return z, dx, tl


def caption_y(edit: dict, t: float, default: float) -> float:
    y = default
    for p in edit.get("punches") or []:
        if p["t"] <= t:
            y = p.get("cap_y", y)
        else:
            break
    return y


# ---------------------------------------------------------------- sound design (procedural, original)
SR = 48000


def _env(n: int, a: float, r: float) -> np.ndarray:
    t = np.arange(n) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    rel = np.exp(-np.maximum(0, t - a) / max(r, 1e-4))
    return att * rel


def _bandnoise(n: int, rng, f_lo: np.ndarray, f_hi: np.ndarray) -> np.ndarray:
    """Noise through a time-varying band-pass (simple state-variable filter)."""
    x = rng.standard_normal(n)
    y = np.zeros(n)
    low = band = 0.0
    fc = np.sqrt(f_lo * f_hi)
    q = np.clip(fc / np.maximum(1.0, f_hi - f_lo), 0.4, 3.0)
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR / 6) / SR)
    for i in range(n):
        high = x[i] - low - band / q[i]
        band += f[i] * high
        low += f[i] * band
        y[i] = band
    return y / (np.max(np.abs(y)) + 1e-9)


def sfx(kind: str, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    if kind == "whoosh":
        n = int(SR * 0.42)
        tt = np.linspace(0, 1, n)
        sweep = 300 * (12 ** np.sin(np.pi * tt * 0.95))
        y = _bandnoise(n, rng, sweep * 0.6, sweep * 1.6)
        env = np.sin(np.pi * np.clip(tt * 1.15, 0, 1)) ** 2.2
        return y * env * 0.9
    if kind == "air":
        # soft, low-passed air movement for an object travelling in from far away
        n = int(SR * 0.62)
        tt = np.linspace(0, 1, n)
        sweep = 250 + 1400 * np.sin(np.pi * np.clip(tt * 0.9, 0, 1)) ** 2
        y = _bandnoise(n, rng, sweep * 0.5, sweep * 1.5)
        env = np.clip(tt / 0.62, 0, 1) ** 2 * np.clip((1 - tt) / 0.38, 0, 1) ** 1.5
        # gentle one-pole low-pass
        out = np.zeros(n)
        a = 0.18
        acc = 0.0
        for i in range(n):
            acc += a * (y[i] - acc)
            out[i] = acc
        return out / (np.max(np.abs(out)) + 1e-9) * env * 0.6
    if kind == "tap":
        n = int(SR * 0.09)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 540 * t) * 0.6 + np.sin(2 * np.pi * 1080 * t) * 0.15) * _env(n, 0.002, 0.022) * 0.5
    if kind == "thump":
        n = int(SR * 0.45)
        t = np.arange(n) / SR
        fr = 90 * np.exp(-t * 10) + 48
        return np.sin(2 * np.pi * np.cumsum(fr) / SR) * _env(n, 0.004, 0.13) * 0.6
    if kind == "swish":
        n = int(SR * 0.22)
        tt = np.linspace(0, 1, n)
        sweep = 2500 + 5000 * tt
        y = _bandnoise(n, rng, sweep * 0.7, sweep * 1.4)
        return y * np.sin(np.pi * tt) ** 1.5 * 0.55
    if kind == "pop":
        n = int(SR * 0.12)
        t = np.arange(n) / SR
        fr = 900 * np.exp(-t * 30) + 260
        y = np.sin(2 * np.pi * np.cumsum(fr) / SR) * _env(n, 0.002, 0.03)
        return y * 0.7
    if kind == "tick":
        n = int(SR * 0.03)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 3200 * t) * _env(n, 0.0005, 0.006) + 0.3 * rng.standard_normal(n) * _env(n, 0.0002, 0.002)) * 0.45
    if kind == "hit":
        n = int(SR * 0.9)
        t = np.arange(n) / SR
        fr = 120 * np.exp(-t * 9) + 42
        boom = np.sin(2 * np.pi * np.cumsum(fr) / SR) * _env(n, 0.003, 0.32)
        crack = _bandnoise(int(SR * 0.08), rng, np.full(int(SR * 0.08), 1500.0), np.full(int(SR * 0.08), 7000.0)) * _env(int(SR * 0.08), 0.001, 0.025)
        boom[: len(crack)] += crack * 0.5
        return np.tanh(boom * 1.6) * 0.8
    if kind == "riser":
        n = int(SR * 1.1)
        tt = np.linspace(0, 1, n)
        sweep = 400 + 6000 * tt ** 2
        y = _bandnoise(n, rng, sweep * 0.7, sweep * 1.3)
        return y * tt ** 2 * 0.6
    if kind == "ding":
        n = int(SR * 0.7)
        t = np.arange(n) / SR
        y = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((1318.5, 1), (2637, 0.35), (1975.5, 0.25))) * _env(n, 0.002, 0.18)
        return y * 0.35
    return np.zeros(1)


def sfx_track(events: list[dict], total: float) -> np.ndarray:
    n = int(SR * (total + 1.5))
    out = np.zeros(n)
    cache: dict = {}
    for k, e in enumerate(events):
        kind = e.get("kind", "whoosh")
        key = (kind, k % 4)
        if key not in cache:
            cache[key] = sfx(kind, seed=k % 4)
        s = cache[key] * (10 ** (e.get("gain_db", 0) / 20))
        lead = {"whoosh": 0.20, "riser": 1.05, "swish": 0.08, "air": 0.0}.get(kind, 0.0)
        i0 = int(SR * max(0.0, e["t"] - lead))
        i1 = min(n, i0 + len(s))
        out[i0:i1] += s[: i1 - i0]
    return out[: int(SR * total)]


def music_bed(total: float, bpm: float = 100.0, seed: int = 3) -> np.ndarray:
    """Original, royalty-free bed: soft pad chords, muted pluck, light kick and shaker. Written in code."""
    rng = np.random.default_rng(seed)
    n = int(SR * (total + 2))
    t = np.arange(n) / SR
    beat = 60.0 / bpm
    out = np.zeros(n)
    prog = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G
    bar = beat * 4
    for b in range(int(total / bar) + 2):
        chord = prog[b % 4]
        i0, i1 = int(b * bar * SR), min(n, int((b + 1) * bar * SR) + int(0.4 * SR))
        if i0 >= n:
            break
        tt = t[i0:i1] - b * bar
        env = np.clip(tt / 0.4, 0, 1) * np.clip((bar + 0.4 - tt) / 0.6, 0, 1)
        for m in chord:
            f = 440 * 2 ** ((m - 69) / 12)
            out[i0:i1] += (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt + 0.3)) * env * 0.06
        bass = 440 * 2 ** ((chord[0] - 12 - 69) / 12)
        out[i0:i1] += np.sin(2 * np.pi * bass * tt) * env * 0.09
        for s in range(8):  # pluck arpeggio on 8ths
            j0 = i0 + int(s * beat / 2 * SR)
            ln = int(0.25 * SR)
            if j0 + ln >= n:
                continue
            f = 440 * 2 ** ((chord[s % 3] + 12 - 69) / 12)
            tp = np.arange(ln) / SR
            out[j0:j0 + ln] += np.sin(2 * np.pi * f * tp) * np.exp(-tp * 14) * 0.05
    for k in range(int(total / beat) + 2):
        j0 = int(k * beat * SR)
        if j0 >= n:
            break
        ln = min(int(0.25 * SR), n - j0)
        tp = np.arange(ln) / SR
        if k % 2 == 0:
            out[j0:j0 + ln] += np.sin(2 * np.pi * (50 + 90 * np.exp(-tp * 30)) * tp) * np.exp(-tp * 12) * 0.35
        h0 = j0 + int(beat / 2 * SR)
        hl = min(int(0.05 * SR), n - h0)
        if hl > 0:
            out[h0:h0 + hl] += rng.standard_normal(hl) * np.exp(-np.arange(hl) / SR * 80) * 0.05
    out = out[: int(SR * total)]
    return out / (np.max(np.abs(out)) + 1e-9) * 0.8


def write_wav(path: str, mono: np.ndarray) -> str:
    import wave
    y = np.clip(mono, -1, 1)
    st = np.repeat((y * 32767).astype(np.int16)[:, None], 2, axis=1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(st.tobytes())
    return path


# ---------------------------------------------------------------- planning: turn a plan into the editorial cut
def finish(plan, grade: str = "warm") -> None:
    """Shots, sound design, kinetic captions and the music bed for a plan whose graphics are set.

    Cutting: two framings only (wide and close), changed on sentence starts, each shot held at least 2.5 s,
    and always wide while a 3D object is on screen. Sound: soft air movement when an object travels in, a quiet
    tap when it lands, nothing on plain cuts.
    """
    speech = plan.speech_duration
    offs = plan.clip_offsets()
    fulls = [g for g in plan.graphics if g.type == "fullscreen"]
    pops = [g for g in plan.graphics if g.type in ("pop3d", "model3d")]

    def in_pop(t):
        return any(g.start - 0.05 <= t < g.end for g in pops)

    # sentence starts = clip starts that follow a sentence end or a real pause
    starts = [0.0]
    for i in range(1, len(plan.clips)):
        prev = plan.clips[i - 1]
        last = (prev.words[-1].text if prev.words else "").strip()
        if last.endswith((".", "?", "!")) or prev.line != plan.clips[i].line:
            starts.append(round(offs[i], 3))
    def in_full(t):
        return any(g.start - 1e-3 <= t < g.end - 1e-3 for g in fulls)

    returns = {round(g.end, 3) for g in fulls if g.end < speech - 0.3}
    events = sorted(set(starts + [round(g.start, 3) for g in pops] + list(returns)))
    punches = []
    last_t = -10.0
    for t in events:
        if in_full(t + 0.01):
            continue
        if t - last_t < 2.5 and t not in returns:
            continue
        if any(g.start + 0.05 < t < g.start + 1.0 for g in pops):
            continue   # never cut while an object is still flying in
        z = 1.0 if (not punches or punches[-1]["zoom"] > 1.0) else 1.15
        if not punches:
            z = 1.15
        if t in returns and any(abs(g.start - t) < 0.4 for g in pops):
            z = 1.0      # coming back to the speaker with an object about to rise: wide
        punches.append({"t": t, "zoom": z, "cap_y": 0.80 if z > 1 else 0.79})
        last_t = t
    if not punches or punches[0]["t"] > 0:
        punches.insert(0, {"t": 0.0, "zoom": 1.15, "cap_y": 0.80})
    sfx = []
    for g in pops:
        sfx.append({"t": g.start, "kind": "air", "gain_db": -2})
        sfx.append({"t": g.start + 0.62, "kind": "tap", "gain_db": -8})
        if g.params.get("kind") == "brand" or g.params.get("model") == "brand":
            sfx.append({"t": g.start + 1.05, "kind": "ding", "gain_db": -12})
    for g in fulls:
        how = g.params.get("enter", "whip")
        if how == "whip":
            sfx.append({"t": g.start - 0.25, "kind": "air", "gain_db": -3})
        elif how == "zoom":
            sfx.append({"t": g.start - 0.2, "kind": "air", "gain_db": -6})
        elif how == "fade":
            continue          # a dissolve is silent: the voice carries it
        elif g.params.get("kind") == "stage":
            sfx.append({"t": g.start - 0.35, "kind": "air", "gain_db": -7})
    for g in plan.graphics:
        if g.type == "text_behind":
            sfx.append({"t": g.start, "kind": "thump", "gain_db": -4})
    plan.captions.mode = "kinetic"
    plan.captions.size = 0.062
    plan.captions.position = 0.79
    edit = dict(plan.edit or {})
    edit.update({"style": "editorial", "grade": grade, "punches": punches, "sfx": sorted(sfx, key=lambda e: e["t"]), "sfx_db": -16.0})
    if plan.music is None:
        edit["music_bed"] = {"bpm": 96, "volume_db": -23.0, "duck_db": 8.0}
    else:
        plan.music.volume_db = min(plan.music.volume_db, -21.0)
    plan.edit = edit
    for c in plan.clips:
        c.zoom_start = c.zoom_end = 1.0


# words that call for a 3D explainer when no graphics plan exists (automatic mode, no Claude)
_SCENE_WORDS = [
    ("motor_inside", "stage", ("stator", "rotor", "winding", "windings", "magnetic", "armature")),
    ("pump_inside", "stage", ("impeller", "centrifugal")),
    ("pump_flow", "stage", ("suction", "pipe")),
    ("lift", "stage", ("sump", "tank", "tanks", "elevated", "borewell", "overhead", "height", "lift")),
    ("energy", "stage", ("electrical", "mechanical", "energy", "converts", "electricity", "power")),
    ("pump_set", "rise", ("pump", "motor", "parts", "driver")),
]


def auto_scenes(plan, machine: dict | list | None = None) -> list:
    """Picks full-screen 3D explainers and rising objects from what is said, sentence by sentence.
    `machine` is the company's machine, or a list of them (each gets its own turn-table when it is named)."""
    from .schema import Graphic
    machines = [m for m in (machine if isinstance(machine, list) else [machine]) if m]
    words = plan.output_words()
    speech = plan.speech_duration
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.!?]$", w["text"].strip()):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    out, used, last_end, d = [], set(), 2.5, 1
    for snt in sents:
        a, b = snt[0]["start"], snt[-1]["end"]
        if a < last_end + 1.2 or b - a < 1.6:
            continue
        keys = [re.sub(r"[^\w]", "", w["text"].lower()) for w in snt]
        pick = None
        # the company's own machine comes first when it is named; generic built-in scenes only otherwise
        for m in machines:
            if id(m) in used:
                continue
            names = [x.lower() for x in [m.get("name", "")] + list(m.get("keywords") or []) if x]
            if any(k and (k in names or any(k in n.split() for n in names)) for k in keys if len(k) > 3):
                pick, machine = ("machine", "stage", a), m
                break
        if not pick:
            for name, kind, trig in _SCENE_WORDS:
                if name in used and name not in ("pump_set",):
                    continue
                hit = next((i for i, k in enumerate(keys) if k in trig), None)
                if hit is not None:
                    pick = (name, kind, snt[hit]["start"])
                    break
        if not pick:
            continue
        name, kind, at = pick
        start, end = max(0.0, a - 0.1), min(speech, max(b + 0.2, a + 2.6), a + 7.0)
        if kind == "stage":
            prm = {"kind": "stage", "stage": name, "enter": "cut", "cap_y": 0.80}
            if name == "energy":
                prm.update(strike_at=round(max(0.4, at - start), 2), mech_at=round(max(1.6, (end - start) * 0.55), 2))
            if name == "motor_inside":
                prm.update(energize_at=round((end - start) * 0.5, 2), label_times={"stator": 1.6, "rotor": 2.3, "field": round((end - start) * 0.6, 2)})
            if name in ("pump_inside", "pump_flow"):
                prm.update(label_times={"impeller": 1.0, "water": 1.4, "centrifugal": 2.0, "suction": 0.4, "delivery": 1.4})
            if name == "machine":
                prm.update(machine=machine, name=machine.get("name", ""), sub=machine.get("tagline", ""))
            out.append(Graphic(type="fullscreen", start=start, end=end, params=prm, reason="full-screen 3D explainer for what is being said"))
        else:
            d = -d
            out.append(Graphic(type="model3d", start=start - 0.3, end=end, params={"model": name, "dir": d, "enter": "rise", "label_times": {"motor": 0.9, "pump": 1.4}},
                               reason="3D object rises from behind the speaker"))
        used.add(id(machine) if name == "machine" else name)
        last_end = end
    return out


_STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "this", "that", "for", "with", "your", "you", "how", "does", "do", "what", "why", "my", "our"}


def convert(plan, brief: dict | None = None) -> None:
    """Motion plan -> editorial plan: panels become full-screen cutaways, pop-ups become large caption words."""
    from .schema import Graphic
    brief = brief or {}
    out, emphasis = [], []
    dirn = 1
    for g in plan.graphics:
        p = dict(g.params)
        if g.type == "illustration":
            sc = p.get("scene", "")
            model = {"pump_set": "pump_set", "stator_rotor": "stator_rotor", "impeller": "impeller", "specs": None}.get(sc, None)
            if sc == "energy_flow":
                model = "lift" if float(p.get("switch_at", 1.0)) < 0.5 else "energy"
            stage = {"energy": "energy", "lift": "lift", "stator_rotor": "motor_inside", "impeller": "pump_inside"}.get(model or "")
            if stage:
                # cut away to a full-screen 3D explainer while the voice carries on, then back to the speaker
                prm = {**p, "kind": "stage", "stage": stage, "enter": "cut", "cap_y": 0.80}
                if stage == "energy":
                    prm.setdefault("strike_at", 0.6)
                out.append(Graphic(type="fullscreen", start=g.start, end=g.end, params=prm, reason=g.reason or "full-screen 3D explainer"))
            elif model:
                out.append(Graphic(type="model3d", start=g.start - 0.3, end=g.end, params={**p, "model": model, "dir": dirn, "enter": "rise"}, reason=g.reason or "3D object rises from behind the speaker"))
            else:
                out.append(Graphic(type="pop3d", start=g.start, end=g.end, params={**p, "kind": "scene", "dir": dirn}, reason=g.reason or "3D illustration pops out over the shot"))
        elif g.type == "stat_counter":
            v = float(p.get("value", 0))
            words = [w for w in re.findall(r"[A-Za-z]+", p.get("label", "")) if w.lower() not in (_STOP - {"of"}) | {"up", "pull", "has", "can", "around", "about", "upto"}]
            sub = " ".join(words[-3:])
            if "to" in p:
                fmt = lambda x: f"{x:g}"
                out.append(Graphic(type="model3d", start=g.start - 0.3, end=g.end, params={"model": "text", "enter": "rise", "size3d": 1.7, "kind": "big_text", "text": f"{p.get('prefix', '')}{fmt(v)}–{fmt(float(p['to']))}{p.get('suffix', '')}",
                                                                                        "sub": sub, "arrows": True, "size": 300, "width": 0.72, "y": 0.36, "dir": dirn}, reason=g.reason))
                dirn = -dirn
                continue
            p["label"] = sub
            out.append(Graphic(type="model3d", start=g.start - 0.3, end=g.end, params={"model": "text", "enter": "rise", "size3d": 2.0, "kind": "big_text", "count_to": v, "decimals": 0 if v.is_integer() else 1,
                                                                                    "prefix": p.get("prefix", ""), "suffix": p.get("suffix", ""), "sub": sub,
                                                                                    "arrows": True, "size": 400, "y": 0.36, "dir": dirn}, reason=g.reason))
        elif g.type in ("process_flow", "bullet_list"):
            items = p.get("steps") or p.get("items") or []
            times = p.get("item_times") or []
            its = [{"label": (it if isinstance(it, str) else it.get("title") or it.get("text", "")), "at": max(0.0, (times[i] - g.start) if i < len(times) else i * 0.4)}
                   for i, it in enumerate(items[:3])]
            out.append(Graphic(type="fullscreen", start=g.start, end=g.end, params={"kind": "shapes", "items": its, "cap_y": 0.66, "dir": dirn}, reason=g.reason))
        elif g.type == "hook_title":
            hl = [w for w in (p.get("highlight") or []) if w]
            if not hl:
                hl = [w for w in re.findall(r"[\w'-]+", p.get("text", "")) if w.lower() not in _STOP][-2:]
            if hl:
                out.append(Graphic(type="text_behind", start=g.start + 0.1, end=min(g.end, g.start + 2.4), params={"lines": [w.upper() for w in hl[:2]], "y": 0.335, "size": 340,
                                                                                                                 "colors": ["#FFFFFF", "accent"]}, reason="headline behind the speaker"))
        elif g.type in ("keyword_pop", "icon_callout"):
            emphasis += [w for w in re.findall(r"[\w'-]+", p.get("text", "")) if w.lower() not in _STOP][:1]
        elif g.type == "end_card":
            out.append(Graphic(type="fullscreen", start=g.start, end=g.end, params={"kind": "cta", "title": p.get("cta") or "Follow for more", "sub": p.get("tagline", "")}, reason=g.reason))
        elif g.type in ("broll_full", "cta_banner", "fullscreen", "text_behind", "model3d"):
            out.append(g)
        else:
            continue
        if out and out[-1].type in ("fullscreen", "pop3d", "model3d"):
            dirn = -dirn
    if not any((g.type == "model3d" and g.params.get("model") != "text") or (g.type == "fullscreen" and g.params.get("kind") == "stage") for g in out):
        auto = auto_scenes(plan, brief.get("_machines") or brief.get("_machine"))
        busy = [(g.start, g.end) for g in out if g.type in ("fullscreen", "model3d", "text_behind")]
        out += [g for g in auto if all(g.end <= a or g.start >= b for a, b in busy)]
        out.sort(key=lambda g: g.start)
    plan.graphics = out
    plan.captions.emphasis = list(dict.fromkeys(emphasis + list(brief.get("keywords") or [])))
    finish(plan)


# ---------------------------------------------------------------- 3D assets popping out over the live shot
# The speaker stays on screen. The 3D object (an animated illustration, a 3D number, the logo) pops out above
# and around him with no panel behind it, hovers and turns in 3D while its animation keeps running, then pops away.
# With depth "behind" the person is put back on top with the matte, so the object sits behind his head and
# shoulders and the face is never covered.
SCENE_SRC = (0.03, 0.02, 0.94, 0.43)       # where a scene is painted off-screen (fractions of W, H)
POP_ZONE = (0.02, 0.025, 0.96, 0.405)      # where the object hovers on screen


def _src_rect(ctx, g) -> skia.Rect:
    W, H = ctx.W, ctx.H
    kind = g.params.get("kind", "scene")
    if kind == "scene":
        x, y, w, h = SCENE_SRC
        return skia.Rect.MakeXYWH(W * x, H * y, W * w, H * h)
    if kind == "brand":
        return skia.Rect.MakeLTRB(0, H * 0.19, W, H * 0.60)
    if kind == "big_text":
        y = g.params.get("y", 0.36)
        return skia.Rect.MakeLTRB(0, H * (y - 0.20), W, H * (y + 0.17))
    return skia.Rect.MakeLTRB(0, H * 0.10, W, H * 0.55)


def _pop_paint_content(ctx, oc, g, t):
    tl = t - g.start
    dur = g.end - g.start
    prm = dict(g.params)
    kind = prm.get("kind", "scene")
    if kind == "scene":
        from .illustrations import SCENES
        fn = SCENES.get(prm.get("scene", ""))
        if not fn:
            return
        prm.setdefault("title", "")
        prm.setdefault("title_a", "")
        prm.setdefault("title_b", "")
        x, y, w, h = SCENE_SRC
        P = skia.Rect.MakeXYWH(ctx.W * x, ctx.H * y, ctx.W * w, ctx.H * h)
        off = prm.get("offset", 0.0)
        fn(ctx, oc, P, tl + off, dur + off, prm, 1.0)
    else:
        fn = CONTENT.get(kind)
        if fn:
            fn(ctx, oc, prm, tl, dur)


def is_behind(g) -> bool:
    return g.type == "text_behind" or (g.type in ("pop3d", "model3d") and g.params.get("depth", "behind") == "behind")


def draw_pop3d(ctx, canvas: skia.Canvas, g, t: float) -> None:
    from .floating import _offscreen, _quad_matrix, card_quad
    W, H, u = ctx.W, ctx.H, ctx.u
    tl = t - g.start
    dur = g.end - g.start
    pin = progress(tl, 0.0, 0.55)
    pout = progress(tl, dur - 0.28, 0.28)
    if pout >= 1:
        return
    surf = _offscreen(ctx)
    oc = surf.getCanvas()
    oc.clear(skia.ColorTRANSPARENT)
    _pop_paint_content(ctx, oc, g, t)
    src = _src_rect(ctx, g)
    ir = skia.IRect.MakeLTRB(int(src.left()), int(src.top()), int(src.right()), int(src.bottom()))
    img = surf.makeImageSnapshot(ir)
    if img is None:
        return
    zx, zy, zw, zh = g.params.get("zone", POP_ZONE)
    Z = skia.Rect.MakeXYWH(W * zx, H * zy, W * zw, H * zh)
    scale = min(Z.width() / src.width(), Z.height() / src.height()) * g.params.get("scale", 1.0)
    w, h = src.width() * scale, src.height() * scale
    sgn = g.params.get("dir", 1)
    # pop out: grows from small with an overshoot while swinging round to face the camera
    grow = (0.15 + 0.85 * ease_out_back(pin, 1.6)) if pin < 1 else 1.0
    shrink = 1 - ease_out_cubic(pout) * 0.85
    sc = grow * shrink
    hover = min(1.0, tl / 0.8)
    drift = math.sin(tl * 0.6 + sgn) * Z.width() * 0.035 * hover
    bob = math.sin(tl * 1.5) * 9 * u * hover
    cx = Z.centerX() + drift
    cy = Z.centerY() + bob + (1 - grow) * 40 * u
    yaw = sgn * (1 - clamp(pin * 1.15)) * 0.95 + math.sin(tl * 0.95) * 0.16 * hover + sgn * ease_in_out(pout) * 0.6
    pitch = math.sin(tl * 0.75 + 0.6) * 0.5 * hover
    alpha = clamp(pin * 3.0) * (1 - ease_in_out(pout))
    quad = card_quad(cx, cy, w * sc, h * sc, yaw, pitch)
    m = _quad_matrix(skia.Rect.MakeWH(src.width(), src.height()), quad)
    smp = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear)
    canvas.save()
    canvas.concat(m)
    # the object's own soft shadow (no plate behind it) so it reads on any background
    sh = skia.Paint(Alphaf=alpha, ImageFilter=skia.ImageFilters.DropShadowOnly(10 * u / scale, 26 * u / scale, 16 * u / scale, 16 * u / scale, D.color("#000000", 0.55), None))
    canvas.drawImage(img, 0, 0, smp, sh)
    canvas.drawImage(img, 0, 0, smp, skia.Paint(Alphaf=alpha))
    canvas.restore()
    # burst ring when it pops out
    if 0 < pin < 1 and g.params.get("burst", True):
        r = lerp(0.2, 1.0, ease_out_cubic(pin)) * min(w, h) * 0.55
        canvas.drawCircle(cx, cy, r, D.stroke(ctx.col("accent", 0.55 * (1 - pin)), 10 * u * (1 - pin) + 1))
        rnd = (hash(g.start) % 97) / 97.0
        for k in range(10):
            a = k * 0.628 + rnd
            rr = r * 1.15
            canvas.drawCircle(cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.8, 7 * u * (1 - pin), D.fill(ctx.col("primary" if k % 2 else "accent", 0.9 * (1 - pin))))


# ---------------------------------------------------------------- real 3D objects (scene3d) over the live shot
MODEL_VIEW = 0.46          # the 3D viewport covers the top 46% of the frame (above and behind the speaker)
_M3D: dict = {}


def _model3d_frame(ctx, g, t):
    key = (id(g), round(t, 4))
    hit = _M3D.get("last")
    if hit and hit[0] == key:
        return hit[1]
    from . import scene3d
    W, H = ctx.W, ctx.H
    vh = int(H * g.params.get("view_h", MODEL_VIEW)) // 2 * 2
    img, labels, settled = scene3d.render_object(g.params["model"], g.params, t - g.start, g.end - g.start, W, vh, g.params.get("dir", 1), ctx.plan.format.fps)
    sk = skia.Image.fromarray(np.ascontiguousarray(img), colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
    res = (sk, labels, settled, vh)
    _M3D["last"] = (key, res)
    return res


_FALLBACK_SCENE = {"pump_set": "pump_set", "stator_rotor": "stator_rotor", "impeller": "impeller", "energy": "energy_flow", "lift": "energy_flow"}
_GL_OK = {"ok": None}


def _gl_ok() -> bool:
    if _GL_OK["ok"] is None:
        from . import scene3d
        try:
            _GL_OK["ok"] = scene3d.available() and scene3d.Renderer.get(64, 64) is not None
        except Exception:  # noqa: BLE001
            _GL_OK["ok"] = False
    return bool(_GL_OK["ok"])


def _fallback(ctx, canvas, g, t):
    """No OpenGL on this machine: draw the same beat with the 2.5D pop-out instead."""
    from .schema import Graphic
    m = g.params.get("model")
    if m in _FALLBACK_SCENE:
        prm = dict(g.params, kind="scene", scene=_FALLBACK_SCENE[m])
        if m == "lift":
            prm.update(switch_at=0.0, offset=0.3)
        elif m == "energy":
            prm.update(switch_at=99)
    elif m == "text":
        prm = dict(g.params, kind="big_text", size=360, y=0.36)
    elif m == "brand":
        prm = dict(g.params, kind="brand", zone=[0.03, 0.02, 0.94, 0.33])
    else:
        return
    draw_pop3d(ctx, canvas, Graphic(type="pop3d", start=g.start, end=g.end, params=prm), t)


def draw_model3d(ctx, canvas: skia.Canvas, g, t: float) -> None:
    if not _gl_ok():
        _fallback(ctx, canvas, g, t)
        return
    u = ctx.u
    img, labels, settled, vh = _model3d_frame(ctx, g, t)
    tl = t - g.start
    fade = clamp(tl / 0.18) * (1 - progress(tl, g.end - g.start - 0.12, 0.12))
    y0 = ctx.H * g.params.get("view_y", 0.0)
    # soft shadow the object casts on the wall behind it, then the object
    sh = skia.Paint(Alphaf=fade * 0.55 * settled, ImageFilter=skia.ImageFilters.DropShadowOnly(16 * u, 34 * u, 22 * u, 22 * u, D.color("#000000", 0.5), None))
    canvas.drawImage(img, 0, y0, skia.SamplingOptions(), sh)
    canvas.drawImage(img, 0, y0, skia.SamplingOptions(), skia.Paint(Alphaf=fade))


def draw_model3d_labels(ctx, canvas: skia.Canvas, g, t: float) -> None:
    """Call-outs, drawn in front of the speaker so they are never hidden."""
    if not _gl_ok():
        return
    _, labels, settled, vh = _model3d_frame(ctx, g, t)
    draw_labels(ctx, canvas, labels, t - g.start, g.end - g.start, ctx.H * g.params.get("view_y", 0.0), settled, 0.75)


def draw_labels(ctx, canvas, labels, tl, dur, y0=0.0, settled=1.0, earliest=0.0):
    u, W = ctx.u, ctx.W
    out_a = 1 - progress(tl, dur - 0.45, 0.25)
    for lb in labels:
        p = ease_out_cubic(progress(tl, max(lb["at"], earliest), 0.35)) * out_a * (1 if settled > 0.6 else 0)
        if p <= 0:
            continue
        ax, ay = lb["x"], lb["y"] + y0
        style = lb.get("style", "callout")
        if style == "caption":
            f = D.font("Montserrat-ExtraBold", 50 * u)
            txt = lb["title"].upper()
            D.draw_text(canvas, txt, ax, ay + (1 - p) * 20 * u, f, D.color("#14181F", p), stroke_c=D.color("#FFFFFF", 0.85 * p), stroke_w=10 * u, align="center")
            continue
        if style == "counter":
            f = D.font("Montserrat-Black", 96 * u)
            tw = D.text_width(lb["title"], f)
            x = ax - tw - 26 * u if lb.get("side", 1) < 0 else ax + 26 * u
            x = max(24 * u, min(W - tw - 24 * u, x))
            D.draw_text(canvas, lb["title"], x, ay + 34 * u, f, ctx.col("primary", p), stroke_c=D.color("#0A1019", 0.7 * p), stroke_w=8 * u, shadow=10 * u)
            continue
        if style == "pill":
            fr = D.font("Inter-Bold", 42 * u)
            tw = D.text_width(lb["title"], fr) + 64 * u
            canvas.save()
            canvas.translate(ax, ay)
            canvas.scale(lerp(0.85, 1.0, p), lerp(0.85, 1.0, p))
            sp = D.fill(D.color("#000000", 0.25 * p))
            sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10 * u))
            canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(-tw / 2, -36 * u + 6 * u, tw, 72 * u), 36 * u, 36 * u), sp)
            D.rrect(canvas, -tw / 2, -36 * u, tw, 72 * u, 36 * u, D.fill(ctx.col("primary", p)))
            D.draw_text(canvas, lb["title"], 0, 14 * u, fr, D.color("#FFFFFF", p), align="center")
            canvas.restore()
            continue
        side = lb.get("side", 1) or 1
        ft = D.font("Inter-Bold", 38 * u)
        fs = D.font("Inter-Medium", 27 * u)
        tw = max(D.text_width(lb["title"], ft), D.text_width(lb["sub"], fs) if lb["sub"] else 0) + 44 * u
        bh = (94 if lb["sub"] else 64) * u
        lx = ax + side * 120 * u
        ly = ay - 70 * u
        bx = lx if side > 0 else lx - tw
        bx = min(max(bx, 18 * u), W - tw - 18 * u)
        ly = max(ly, 60 * u)
        # anchor dot and leader line (draws on)
        canvas.drawCircle(ax, ay, 9 * u * p, D.fill(D.color("#FFFFFF", p)))
        canvas.drawCircle(ax, ay, 9 * u * p, D.stroke(ctx.col("primary", p), 3.5 * u))
        ex = bx if side > 0 else bx + tw
        path = skia.Path()
        path.moveTo(ax, ay)
        path.lineTo(lerp(ax, ex, 0.55), ly + bh / 2)
        path.lineTo(ex, ly + bh / 2)
        lp = D.stroke(D.color("#FFFFFF", 0.95 * p), 3 * u)
        if p < 0.999:
            pe = skia.TrimPathEffect.Make(0, p)
            if pe is not None:
                lp.setPathEffect(pe)
        sp_line = D.stroke(D.color("#000000", 0.25 * p), 5 * u)
        canvas.drawPath(path, sp_line)
        canvas.drawPath(path, lp)
        q = ease_out_cubic(progress(tl, max(lb["at"], earliest) + 0.12, 0.3)) * out_a
        if q <= 0:
            continue
        canvas.save()
        canvas.translate(side * (1 - q) * -18 * u, 0)
        sp = D.fill(D.color("#000000", 0.22 * q))
        sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 12 * u))
        canvas.drawRRect(skia.RRect.MakeRectXY(skia.Rect.MakeXYWH(bx, ly + 8 * u, tw, bh), 16 * u, 16 * u), sp)
        D.rrect(canvas, bx, ly, tw, bh, 16 * u, D.fill(D.color("#FFFFFF", 0.96 * q)))
        D.rrect(canvas, bx, ly, 7 * u, bh, 3 * u, D.fill(ctx.col("primary", q)))
        D.draw_text(canvas, lb["title"], bx + 24 * u, ly + 44 * u, ft, D.color("#14181F", q))
        if lb["sub"]:
            D.draw_text(canvas, lb["sub"], bx + 24 * u, ly + 78 * u, fs, D.color("#5A6372", q))
        canvas.restore()


POST_DRAWERS = {"model3d": draw_model3d_labels}
