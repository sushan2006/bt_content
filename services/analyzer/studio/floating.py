"""Overlay layout: the video stays full-frame and explanatory graphics float over it, away from the speaker's face.

A panel graphic (3D illustration, step flow, list, picture) is drawn off-screen, then composited as a floating
glass card with real perspective: it swings in from one side with a 3D turn, sways gently while it is on screen,
drifts a little left and right, and turns away on the other side when it leaves. The card is placed in the half of
the frame that does not contain the face (above it when the face is low, below it when the face is high).
"""
from __future__ import annotations

import math

import skia

from . import draw as D
from .motion import clamp, ease_in_cubic, ease_in_out, ease_out_back, ease_out_cubic, lerp, progress


def is_floating(g) -> bool:
    return g.params.get("layout") == "overlay"


def zone(ctx) -> tuple[skia.Rect, str]:
    """Where the card may go without covering the face. Returns (rect, 'top'|'bottom')."""
    W, H = ctx.W, ctx.H
    fy = getattr(ctx, "focus_y", 0.6)
    if ctx.vertical:
        if fy >= 0.42:
            # above the head (face centre minus ~0.19 of the height), leaving the logo corner free
            bottom = min(0.44, max(0.34, fy - 0.19))
            return skia.Rect.MakeLTRB(W * 0.035, H * 0.075, W * 0.775, H * bottom), "top"
        return skia.Rect.MakeXYWH(W * 0.04, H * 0.47, W * 0.92, H * 0.27), "bottom"
    fx = getattr(ctx, "focus_x", 0.5)
    if fx >= 0.5:
        return skia.Rect.MakeXYWH(W * 0.03, H * 0.10, W * 0.44, H * 0.70), "left"
    return skia.Rect.MakeXYWH(W * 0.53, H * 0.10, W * 0.44, H * 0.70), "right"


def _source_rect(ctx, g) -> skia.Rect:
    """The area of the full frame where the panel drawer paints."""
    if g.type == "illustration":
        if ctx.vertical:
            return skia.Rect.MakeXYWH(ctx.W * 0.03, ctx.H * 0.04, ctx.W * 0.94, ctx.H * 0.42)
    from .graphics import panel_rect
    p = panel_rect(ctx)
    return skia.Rect.MakeLTRB(p.left() - ctx.W * 0.03, p.top() - ctx.H * 0.03, p.right() + ctx.W * 0.03, p.bottom() + ctx.H * 0.02)


def _offscreen(ctx) -> skia.Surface:
    surf = getattr(ctx, "_float_surface", None)
    if surf is None:
        surf = skia.Surface(ctx.W, ctx.H)
        ctx._float_surface = surf
    return surf


def _quad_matrix(src: skia.Rect, dst_pts: list[tuple[float, float]]) -> skia.Matrix:
    m = skia.Matrix()
    s = [skia.Point(src.left(), src.top()), skia.Point(src.right(), src.top()), skia.Point(src.right(), src.bottom()), skia.Point(src.left(), src.bottom())]
    d = [skia.Point(x, y) for x, y in dst_pts]
    m.setPolyToPoly(s, d)
    return m


def card_quad(cx: float, cy: float, w: float, h: float, yaw: float, pitch: float = 0.0) -> list[tuple[float, float]]:
    """Corners of a card of size w x h centred at (cx, cy), turned by yaw (rad, around the vertical axis) with perspective."""
    k = 0.45  # perspective strength
    cw = math.cos(yaw)
    sw = math.sin(yaw)
    half_w = w / 2 * cw
    lh = h / 2 * (1 + k * sw)   # left edge grows when turning right
    rh = h / 2 * (1 - k * sw)
    py = h * 0.06 * math.sin(pitch)
    return [(cx - half_w, cy - lh + py), (cx + half_w, cy - rh + py), (cx + half_w, cy + rh - py), (cx - half_w, cy + lh - py)]


def draw_floating(ctx, canvas: skia.Canvas, g, t: float, drawer) -> None:
    u = ctx.u
    dur = g.end - g.start
    tl = t - g.start
    pin = progress(tl, 0, 0.75)
    pout = progress(tl, dur - 0.55, 0.55)
    if pin <= 0 or pout >= 1:
        return
    side = g.params.get("enter", "left")
    sgn = -1 if side == "left" else 1
    # off-screen panel drawn exactly as in the split layout (but on a transparent surface)
    surf = _offscreen(ctx)
    oc = surf.getCanvas()
    oc.clear(skia.ColorTRANSPARENT)
    oc.save()
    drawer(ctx, oc, g, t)
    oc.restore()
    src = _source_rect(ctx, g)
    ir = skia.IRect.MakeLTRB(int(src.left()), int(src.top()), int(src.right()), int(src.bottom()))
    img = surf.makeImageSnapshot(ir)
    if img is None:
        return
    Z, where = zone(ctx)
    scale = min(Z.width() / src.width(), Z.height() / src.height())
    w, h = src.width() * scale, src.height() * scale
    # motion: swing in with a 3D turn, idle sway + drift, swing out to the other side
    e_in = ease_out_back(pin, 1.1) if pin < 1 else 1.0
    e_out = ease_in_cubic(pout)
    drift = math.sin(tl * 0.55) * Z.width() * 0.045
    bob = math.sin(tl * 1.4) * 7 * u
    cx = Z.centerX() + drift + sgn * (1 - e_in) * ctx.W * 0.75 - sgn * e_out * ctx.W * 0.75
    cy = Z.centerY() + bob
    yaw = sgn * (1 - clamp(e_in)) * 1.05 + math.sin(tl * 0.9) * 0.2 - sgn * e_out * 1.0
    pitch = math.sin(tl * 0.7 + 1.0) * 0.6
    alpha = clamp(pin * 2.5) * (1 - e_out)
    quad = card_quad(cx, cy, w, h, yaw, pitch)
    # soft shadow + glass plate
    plate_src = skia.Rect.MakeWH(src.width(), src.height())
    m = _quad_matrix(plate_src, quad)
    shadow = skia.Path()
    shadow.addPoly([skia.Point(x + 10 * u, y + 22 * u) for x, y in quad], True)
    sp = D.fill(D.color("#000000", 0.38 * alpha))
    sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 22 * u))
    canvas.drawPath(shadow, sp)
    canvas.save()
    canvas.concat(m)
    r = 38 * u / scale
    plate = skia.RRect.MakeRectXY(plate_src, r, r)
    canvas.clipRRect(plate, True)
    canvas.drawRRect(plate, skia.Paint(AntiAlias=True, Shader=skia.GradientShader.MakeLinear(
        [skia.Point(0, 0), skia.Point(0, src.height())], [ctx.col("darker", 0.80 * alpha), ctx.col("dark", 0.70 * alpha)])))
    # light sweep across the glass as it turns
    sweep = (tl * 0.35) % 1.0
    gx = lerp(-src.width() * 0.4, src.width() * 1.4, sweep)
    canvas.drawRect(plate_src, skia.Paint(Shader=skia.GradientShader.MakeLinear(
        [skia.Point(gx - src.width() * 0.25, 0), skia.Point(gx + src.width() * 0.25, src.height())],
        [D.color("#FFFFFF", 0.0), D.color("#FFFFFF", 0.07 * alpha), D.color("#FFFFFF", 0.0)])))
    canvas.drawImage(img, 0, 0, skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kLinear), skia.Paint(Alphaf=alpha))
    canvas.drawRRect(plate, D.stroke(ctx.col("light", 0.22 * alpha), 3 * u / scale))
    canvas.drawRect(skia.Rect.MakeXYWH(0, 0, src.width(), 8 * u / scale), D.fill(ctx.col("accent", 0.9 * alpha)))
    canvas.restore()
