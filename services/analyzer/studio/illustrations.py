"""Animated 3D-style technical illustrations, drawn in code (no stock images, no licensing questions).

Each scene is drawn inside a panel rect and animates with local time. Shading (gradients, highlights,
soft shadows, visible thickness) gives a 3D look while staying crisp at any resolution.
Scenes: pump_set, energy_flow, stator_rotor, impeller, specs.
"""
from __future__ import annotations

import math

import skia

from . import draw as D
from .motion import clamp, ease_in_out, ease_out_back, ease_out_cubic, lerp, progress, spring


# ---------------------------------------------------------------- colour + primitives
def shade(hex_color: str, f: float) -> str:
    """f < 0 darkens, f > 0 lightens."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if f >= 0:
        r, g, b = (int(c + (255 - c) * f) for c in (r, g, b))
    else:
        r, g, b = (int(c * (1 + f)) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def _label(c, text, x, y, f, col, align="left"):
    """Bare label with a dark outline so it reads on a dark panel and on bright live video alike."""
    a = ((col >> 24) & 255) / 255.0
    D.draw_text(c, text, x, y, f, col, stroke_c=D.color("#0B1220", 0.85 * a), stroke_w=f.getSize() * 0.24, shadow=f.getSize() * 0.12, align=align)


def C(hex_color: str, a: float = 1.0) -> int:
    return D.color(hex_color, a)


def lin(p0, p1, stops: list[tuple[float, str]], a: float = 1.0) -> skia.Paint:
    sh = skia.GradientShader.MakeLinear([skia.Point(*p0), skia.Point(*p1)], [C(c, a) for _, c in stops], [s for s, _ in stops])
    return skia.Paint(Shader=sh, AntiAlias=True)


def rad(cx, cy, r, stops: list[tuple[float, str]], a: float = 1.0) -> skia.Paint:
    sh = skia.GradientShader.MakeRadial(skia.Point(cx, cy), max(r, 1), [C(c, a) for _, c in stops], [s for s, _ in stops])
    return skia.Paint(Shader=sh, AntiAlias=True)


def soft_shadow(c: skia.Canvas, cx: float, cy: float, rx: float, ry: float, a: float = 0.45):
    p = D.fill(C("#000000", a))
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, max(2, ry * 0.6)))
    c.drawOval(skia.Rect.MakeLTRB(cx - rx, cy - ry, cx + rx, cy + ry), p)


def hcyl(c: skia.Canvas, x: float, y: float, length: float, r: float, base: str, a: float = 1.0, cap_right: bool = True, fins: int = 0):
    """Horizontal cylinder: shaded body, back rim on the left, lit end cap on the right."""
    e = r * 0.34
    c.drawOval(skia.Rect.MakeLTRB(x - e, y - r, x + e, y + r), D.fill(C(shade(base, -0.45), a)))
    body = skia.Rect.MakeLTRB(x, y - r, x + length, y + r)
    c.drawRect(body, lin((0, y - r), (0, y + r), [(0, shade(base, -0.35)), (0.22, shade(base, 0.25)), (0.4, shade(base, 0.45)), (0.7, base), (1, shade(base, -0.5))], a))
    for k in range(fins):
        fx = x + length * (0.08 + 0.84 * k / max(1, fins - 1))
        path = skia.Path()
        path.addArc(skia.Rect.MakeLTRB(fx - e, y - r, fx + e, y + r), -90, 180)
        c.drawPath(path, D.stroke(C(shade(base, -0.4), 0.55 * a), max(1.0, r * 0.035)))
    if cap_right:
        cap = skia.Rect.MakeLTRB(x + length - e, y - r, x + length + e, y + r)
        c.drawOval(cap, rad(x + length - e * 0.3, y - r * 0.3, r * 1.1, [(0, shade(base, 0.55)), (1, shade(base, -0.15))], a))
        c.drawOval(cap, D.stroke(C(shade(base, -0.45), a), max(1.0, r * 0.03)))


def vcyl(c: skia.Canvas, cx: float, top: float, height: float, r: float, base: str, a: float = 1.0, open_top: bool = False, fill_level: float | None = None, water: str = "#3da5ff"):
    """Vertical cylinder (pipe, tank). fill_level 0..1 shows water inside through a 'glass' body."""
    e = r * 0.30
    body = skia.Rect.MakeLTRB(cx - r, top, cx + r, top + height)
    c.drawOval(skia.Rect.MakeLTRB(cx - r, top + height - e, cx + r, top + height + e), D.fill(C(shade(base, -0.45), a)))
    c.drawRect(body, lin((cx - r, 0), (cx + r, 0), [(0, shade(base, -0.4)), (0.25, shade(base, 0.35)), (0.45, shade(base, 0.5)), (0.75, base), (1, shade(base, -0.5))], a))
    if fill_level is not None and fill_level > 0:
        wl = top + height * (1 - clamp(fill_level))
        c.drawRect(skia.Rect.MakeLTRB(cx - r * 0.92, wl, cx + r * 0.92, top + height), lin((cx - r, 0), (cx + r, 0), [(0, shade(water, -0.35)), (0.4, shade(water, 0.25)), (1, shade(water, -0.4))], 0.9 * a))
        c.drawOval(skia.Rect.MakeLTRB(cx - r * 0.92, wl - e * 0.9, cx + r * 0.92, wl + e * 0.9), D.fill(C(shade(water, 0.35), 0.95 * a)))
    topo = skia.Rect.MakeLTRB(cx - r, top - e, cx + r, top + e)
    c.drawOval(topo, D.fill(C(shade(base, -0.6) if open_top else shade(base, 0.35), a)))
    c.drawOval(topo, D.stroke(C(shade(base, -0.5), a), max(1.0, r * 0.05)))


def iso_box(c: skia.Canvas, x: float, y: float, w: float, h: float, d: float, base: str, a: float = 1.0):
    """Box with visible top and right side (simple oblique projection). (x, y) = front-top-left."""
    dx, dy = d * 0.7, -d * 0.45
    front = skia.Rect.MakeXYWH(x, y, w, h)
    top = skia.Path()
    top.moveTo(x, y); top.lineTo(x + dx, y + dy); top.lineTo(x + w + dx, y + dy); top.lineTo(x + w, y); top.close()
    side = skia.Path()
    side.moveTo(x + w, y); side.lineTo(x + w + dx, y + dy); side.lineTo(x + w + dx, y + h + dy); side.lineTo(x + w, y + h); side.close()
    c.drawRect(front, lin((0, y), (0, y + h), [(0, base), (1, shade(base, -0.25))], a))
    c.drawPath(top, D.fill(C(shade(base, 0.35), a)))
    c.drawPath(side, D.fill(C(shade(base, -0.35), a)))


def gear_path(cx: float, cy: float, r: float, teeth: int, angle: float, depth: float = 0.16) -> skia.Path:
    p = skia.Path()
    n = teeth * 4
    for k in range(n + 1):
        th = angle + 2 * math.pi * k / n
        rr = r if (k % 4) in (1, 2) else r * (1 - depth)
        x, y = cx + rr * math.cos(th), cy + rr * math.sin(th)
        p.moveTo(x, y) if k == 0 else p.lineTo(x, y)
    p.close()
    p.addCircle(cx, cy, r * 0.32)
    p.setFillType(skia.PathFillType.kEvenOdd)
    return p


def gear3d(c: skia.Canvas, cx: float, cy: float, r: float, teeth: int, angle: float, base: str, a: float = 1.0):
    th = r * 0.14
    for k in range(int(th), 0, -2):
        c.drawPath(gear_path(cx + k * 0.6, cy + k * 0.6, r, teeth, angle), D.fill(C(shade(base, -0.5), a)))
    c.drawPath(gear_path(cx, cy, r, teeth, angle), rad(cx - r * 0.3, cy - r * 0.3, r * 1.4, [(0, shade(base, 0.5)), (1, shade(base, -0.2))], a))


def arrow(c: skia.Canvas, x0, y0, x1, y1, color: int, w: float, head: float):
    c.drawLine(x0, y0, x1, y1, D.stroke(color, w))
    ang = math.atan2(y1 - y0, x1 - x0)
    p = skia.Path()
    p.moveTo(x1 + math.cos(ang) * head * 0.4, y1 + math.sin(ang) * head * 0.4)
    p.lineTo(x1 - math.cos(ang - 0.5) * head, y1 - math.sin(ang - 0.5) * head)
    p.lineTo(x1 - math.cos(ang + 0.5) * head, y1 - math.sin(ang + 0.5) * head)
    p.close()
    c.drawPath(p, D.fill(color))


def callout(ctx, c: skia.Canvas, text: str, sub: str, ax: float, ay: float, lx: float, ly: float, p: float, role: str = "accent", align: str = "left"):
    """Leader line from an anchor point to a label chip. p animates it in."""
    if p <= 0:
        return
    u = ctx.u
    e = ease_out_cubic(p)
    mx, my = lerp(ax, lx, e), lerp(ay, ly, e)
    c.drawCircle(ax, ay, 9 * u * min(1, p * 3), D.fill(ctx.col(role)))
    c.drawCircle(ax, ay, 16 * u * min(1, p * 3), D.stroke(ctx.col(role, 0.5), 3 * u))
    c.drawLine(ax, ay, mx, my, D.stroke(ctx.col("light", 0.9), 3.2 * u))
    if p < 0.55:
        return
    a = clamp((p - 0.55) / 0.3)
    f = D.font(ctx.heading, 34 * u)
    fs = D.font(ctx.body.replace("SemiBold", "Medium"), 25 * u)
    tw = max(D.text_width(text.upper(), f), D.text_width(sub, fs) if sub else 0)
    w, h = tw + 36 * u, (88 if sub else 58) * u
    x = lx if align == "left" else lx - w
    y = ly - h / 2
    D.rrect(c, x, y, w, h, 14 * u, D.shadow_paint(D.fill(ctx.col("darker", 0.92 * a)), 14 * u, 6 * u, 0.4 * a))
    D.rrect(c, x, y, 8 * u, h, 4 * u, D.fill(ctx.col(role, a)))
    D.draw_text(c, text.upper(), x + 22 * u, y + 40 * u, f, D.color("#FFFFFF", a))
    if sub:
        D.draw_text(c, sub, x + 22 * u, y + 72 * u, fs, D.color("#FFFFFF", 0.78 * a))


def water_dots(c: skia.Canvas, pts: list[tuple[float, float]], t: float, speed: float, spacing: float, r: float, color: str, a: float = 1.0):
    """Droplets moving along a polyline."""
    segs, total = [], 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        segs.append((x0, y0, x1, y1, L))
        total += L
    if total <= 0:
        return
    off = (t * speed) % spacing
    d = off
    while d < total:
        acc = 0.0
        for x0, y0, x1, y1, L in segs:
            if acc + L >= d:
                q = (d - acc) / L
                x, y = lerp(x0, x1, q), lerp(y0, y1, q)
                c.drawCircle(x, y, r, rad(x - r * 0.3, y - r * 0.3, r * 1.2, [(0, shade(color, 0.6)), (1, color)], a))
                break
            acc += L
        d += spacing


# ---------------------------------------------------------------- scenes
def _title(ctx, c, P: skia.Rect, title: str, sub: str, p: float, a: float) -> float:
    u = ctx.u
    if not title:
        return P.top()
    f = D.font(ctx.heading, 52 * u)
    e = ease_out_cubic(p)
    D.draw_text(c, title.upper(), P.left() + (1 - e) * -30 * u, P.top() + 50 * u, f, D.color("#FFFFFF", a * e))
    D.rrect(c, P.left(), P.top() + 66 * u, 120 * u * e, 8 * u, 4 * u, D.fill(ctx.col("accent", a)))
    y = P.top() + 80 * u
    if sub:
        fs = D.font(ctx.body, 30 * u)
        D.draw_text(c, sub, P.left(), y + 34 * u, fs, D.color("#FFFFFF", 0.8 * a * e))
        y += 44 * u
    return y + 10 * u


def scene_pump_set(ctx, c, P: skia.Rect, t: float, dur: float, prm: dict, a: float):
    u = ctx.u
    top = _title(ctx, c, P, prm.get("title", "Electric water motor"), prm.get("sub", ""), progress(t, 0, 0.6), a)
    cx, area_h = P.centerX(), P.bottom() - top
    cy = top + area_h * 0.52
    explode = ease_in_out(progress(t, prm.get("explode_at", 1e9), 0.8))
    highlight = prm.get("highlight")                       # "motor" | "pump" | None
    pin = progress(t, 0, 0.9)
    r = area_h * 0.20
    mot_len = P.width() * 0.44
    mx = P.left() + P.width() * 0.10 - (1 - ease_out_cubic(pin)) * P.width() * 0.4 - explode * P.width() * 0.05
    px = P.left() + P.width() * 0.74 + (1 - ease_out_cubic(pin)) * P.width() * 0.4 + explode * P.width() * 0.07
    dim_m = 0.35 if highlight == "pump" else 1.0
    dim_p = 0.35 if highlight == "motor" else 1.0
    # base plate
    soft_shadow(c, cx, cy + r * 1.55, P.width() * 0.42, r * 0.22, 0.5 * a)
    iso_box(c, P.left() + P.width() * 0.06, cy + r * 1.05, P.width() * 0.80, r * 0.28, r * 0.55, "#3a4654", a)
    # motor: feet, body with cooling fins, fan cover, terminal box
    motor_col = prm.get("motor_color", "#2f6f9a")
    for fx in (mx + mot_len * 0.15, mx + mot_len * 0.75):
        iso_box(c, fx, cy + r * 0.75, mot_len * 0.12, r * 0.32, r * 0.3, "#27313c", a * dim_m)
    hcyl(c, mx, cy, mot_len, r, motor_col, a * dim_m, cap_right=True, fins=9)
    e = r * 0.34
    fan_spin = t * (8 if t > 0.6 else 0)
    c.save()
    c.clipRect(skia.Rect.MakeLTRB(mx - e - 2, cy - r - 2, mx, cy + r + 2))
    c.drawOval(skia.Rect.MakeLTRB(mx - e, cy - r, mx + e, cy + r), D.fill(C(shade(motor_col, -0.15), a * dim_m)))
    for k in range(5):
        c.drawOval(skia.Rect.MakeLTRB(mx - e * (1 - k * 0.18), cy - r * (1 - k * 0.18), mx + e * (1 - k * 0.18), cy + r * (1 - k * 0.18)), D.stroke(C(shade(motor_col, -0.55), 0.7 * a * dim_m), 2.2 * u))
    c.restore()
    iso_box(c, mx + mot_len * 0.38, cy - r * 1.33, mot_len * 0.22, r * 0.36, r * 0.4, ctx.hexc("accent"), a * dim_m)
    # shaft (visible gap when exploded)
    sx0, sx1 = mx + mot_len + e, px - r * 0.35
    if sx1 > sx0:
        hcyl(c, sx0, cy, sx1 - sx0, r * 0.12, "#9aa7b4", a, cap_right=False)
        gl = (t * 2.2) % 1.0
        c.drawLine(lerp(sx0, sx1, gl), cy - r * 0.08, lerp(sx0, sx1, gl) + 12 * u, cy - r * 0.08, D.stroke(D.color("#FFFFFF", 0.7 * a), 3 * u))
    # pump: volute disc with thickness, inlet eye, delivery pipe going up
    pump_col = prm.get("pump_color", ctx.hexc("alert"))
    pr = r * 1.2
    deliv_x = px + pr * 0.55
    vcyl(c, deliv_x, cy - pr * 1.9, pr * 1.3, pr * 0.22, "#8d99a6", a * dim_p, open_top=True)
    for k in range(10, 0, -1):
        c.drawCircle(px - k * 1.6 * u, cy + k * 0.6 * u, pr, D.fill(C(shade(pump_col, -0.55), a * dim_p)))
    c.drawCircle(px, cy, pr, rad(px - pr * 0.35, cy - pr * 0.4, pr * 1.5, [(0, shade(pump_col, 0.45)), (0.6, pump_col), (1, shade(pump_col, -0.35))], a * dim_p))
    c.drawCircle(px, cy, pr * 0.92, D.stroke(C(shade(pump_col, -0.3), 0.7 * a * dim_p), 3 * u))
    for k in range(6):
        th = k * math.pi / 3
        c.drawCircle(px + pr * 0.8 * math.cos(th), cy + pr * 0.8 * math.sin(th), 7 * u, D.fill(C("#c9d2da", a * dim_p)))
    c.drawCircle(px, cy, pr * 0.38, D.fill(C("#1b2631", a * dim_p)))
    c.drawCircle(px, cy, pr * 0.38, D.stroke(C("#c9d2da", a * dim_p), 6 * u))
    c.drawCircle(px - pr * 0.12, cy - pr * 0.12, pr * 0.1, D.fill(C("#3da5ff", 0.8 * a * dim_p)))
    # labels
    lt = prm.get("label_times", {})
    if "motor" in lt:
        callout(ctx, c, prm.get("motor_label", "1 · Motor"), prm.get("motor_sub", "the driver"), mx + mot_len * 0.5, cy - r * 0.2, P.left() + P.width() * 0.04, top + 50 * u, progress(t, lt["motor"], 0.6), "primary")
    if "pump" in lt:
        callout(ctx, c, prm.get("pump_label", "2 · Pump"), prm.get("pump_sub", "the delivery system"), px, cy - pr * 0.6, P.right(), top + 50 * u, progress(t, lt["pump"], 0.6), "accent", align="right")


def scene_energy_flow(ctx, c, P: skia.Rect, t: float, dur: float, prm: dict, a: float):
    u = ctx.u
    switch = prm.get("switch_at", dur * 0.45)
    pa = 1 - ease_in_out(progress(t, switch - 0.3, 0.4))
    pb = ease_in_out(progress(t, switch - 0.1, 0.5))
    if pa > 0:
        top = _title(ctx, c, P, prm.get("title_a", "Energy conversion"), "", progress(t, 0, 0.6), a * pa)
        cy = top + (P.bottom() - top) * 0.48
        r = (P.bottom() - top) * 0.25
        x1, x2 = P.left() + P.width() * 0.2, P.left() + P.width() * 0.8
        p1, p2, p3 = progress(t, 0.1, 0.6), progress(t, prm.get("mech_at", 1.2), 0.7), progress(t, prm.get("mech_at", 1.2) - 0.4, 0.6)
        pulse = 0.5 + 0.5 * math.sin(t * 6)
        # electrical
        s = spring(p1)
        c.drawCircle(x1, cy, r * 1.25, rad(x1, cy, r * 1.25, [(0, ctx.hexc("accent")), (1, ctx.hexc("darker"))], 0.35 * a * pa * (0.6 + 0.4 * pulse)))
        D.circle(c, x1, cy, r * s, D.shadow_paint(rad(x1 - r * 0.3, cy - r * 0.3, r * 1.4, [(0, shade(ctx.hexc("accent"), 0.4)), (1, shade(ctx.hexc("accent"), -0.3))], a * pa), 18 * u, 10 * u, 0.5 * a * pa))
        D.draw_icon(c, "zap", x1, cy, r * 1.1 * s, "#FFFFFF", 2.4)
        # arrow with travelling sparks
        ax0, ax1 = x1 + r * 1.25, x2 - r * 1.25
        ap = ease_out_cubic(p3)
        if ap > 0:
            arrow(c, ax0, cy, lerp(ax0, ax1, ap), cy, D.color("#FFFFFF", 0.85 * a * pa), 7 * u, 26 * u)
            water_dots(c, [(ax0, cy), (lerp(ax0, ax1, ap) - 30 * u, cy)], t, 260 * u, 70 * u, 8 * u, ctx.hexc("accent"), a * pa)
        # mechanical
        if p2 > 0:
            gear3d(c, x2, cy, r * spring(p2), 10, t * 1.8, "#9aa7b4", a * pa)
            gear3d(c, x2 + r * 0.95, cy + r * 0.75, r * 0.5 * spring(p2), 7, -t * 1.8 * 10 / 7 + 0.2, ctx.hexc("primary"), a * pa)
        fl = D.font(ctx.heading, 34 * u)
        _label(c, "ELECTRICAL", x1, cy + r * 1.62, fl, D.color("#FFFFFF", a * pa * ease_out_cubic(p1)), align="center")
        _label(c, "MECHANICAL", x2, cy + r * 1.62, fl, D.color("#FFFFFF", a * pa * ease_out_cubic(p2)), align="center")
        fs = D.font(ctx.body, 26 * u)
        _label(c, "energy", x1, cy + r * 1.62 + 36 * u, fs, D.color("#FFFFFF", 0.75 * a * pa * ease_out_cubic(p1)), align="center")
        _label(c, "energy", x2, cy + r * 1.62 + 36 * u, fs, D.color("#FFFFFF", 0.75 * a * pa * ease_out_cubic(p2)), align="center")
    if pb > 0:
        tb = t - switch
        top = _title(ctx, c, P, prm.get("title_b", "Low to high"), prm.get("sub_b", "from the sump to the tank"), progress(tb, 0, 0.6), a * pb)
        H = P.bottom() - top
        ground = top + H * 0.70
        # ground with soil section
        c.drawRect(skia.Rect.MakeLTRB(P.left(), ground, P.right(), P.bottom()), lin((0, ground), (0, P.bottom()), [(0, "#6b4f3a"), (1, "#3b2a1f")], a * pb))
        c.drawRect(skia.Rect.MakeLTRB(P.left(), ground - 6 * u, P.right(), ground), D.fill(C("#5d8a3a", a * pb)))
        # sump / borewell under ground
        sx = P.left() + P.width() * 0.17
        vcyl(c, sx, ground - 4 * u, H * 0.2, P.width() * 0.09, "#7c8a97", a * pb, open_top=True, fill_level=0.7)
        # motor next to the sump
        mx = P.left() + P.width() * 0.32
        hcyl(c, mx, ground - H * 0.06, P.width() * 0.12, H * 0.05, "#2f6f9a", a * pb, fins=4)
        c.drawCircle(mx + P.width() * 0.16, ground - H * 0.06, H * 0.058, D.fill(C(ctx.hexc("alert"), a * pb)))
        # overhead tank on a stand
        tx = P.left() + P.width() * 0.80
        stand_top = top + H * 0.30
        for lx in (-1, 1):
            c.drawLine(tx + lx * P.width() * 0.07, stand_top + H * 0.12, tx + lx * P.width() * 0.10, ground, D.stroke(C("#5b6b7b", a * pb), 8 * u))
        c.drawLine(tx - P.width() * 0.085, stand_top + H * 0.32, tx + P.width() * 0.085, stand_top + H * 0.32, D.stroke(C("#5b6b7b", a * pb), 6 * u))
        level = 0.15 + 0.7 * ease_in_out(progress(tb, 1.0, max(1.0, dur - switch - 1.5)))
        vcyl(c, tx, stand_top - H * 0.04, H * 0.17, P.width() * 0.11, "#dfe6ec", a * pb, fill_level=level)
        # pipe: sump -> motor -> up the stand -> tank
        pipe = [(sx, ground - H * 0.02), (sx, ground - H * 0.06), (mx, ground - H * 0.06), (mx + P.width() * 0.16, ground - H * 0.06), (mx + P.width() * 0.22, ground - H * 0.06),
                (mx + P.width() * 0.22, stand_top - H * 0.08), (tx - P.width() * 0.04, stand_top - H * 0.08)]
        pp = skia.Path()
        pp.moveTo(*pipe[0])
        for q in pipe[1:]:
            pp.lineTo(*q)
        c.drawPath(pp, D.stroke(C("#9aa7b4", a * pb), 16 * u, skia.Paint.kButt_Cap))
        c.drawPath(pp, D.stroke(C("#c9d2da", 0.6 * a * pb), 5 * u, skia.Paint.kButt_Cap))
        flow = [pipe[0], pipe[1], pipe[3], pipe[4], pipe[5], pipe[6]]
        water_dots(c, flow, tb, 320 * u, 46 * u, 6.5 * u, "#3da5ff", a * pb * ease_out_cubic(progress(tb, 0.4, 0.6)))
        # height arrow
        hp = ease_out_cubic(progress(tb, 0.8, 1.0))
        hx = P.left() + P.width() * 0.62
        arrow(c, hx, ground - 10 * u, hx, lerp(ground - 10 * u, stand_top - H * 0.02, hp), ctx.col("accent", a * pb), 6 * u, 24 * u)
        fl = D.font(ctx.heading, 34 * u)
        _label(c, "HIGH", hx + 22 * u, stand_top + 18 * u, fl, D.color("#FFFFFF", a * pb * hp))
        _label(c, "LOW", hx + 22 * u, ground - 22 * u, fl, D.color("#FFFFFF", a * pb * hp))
        fs = D.font(ctx.heading, 30 * u)
        _label(c, "SUMP", sx, ground + H * 0.20 + 30 * u, fs, D.color("#FFFFFF", 0.85 * a * pb), align="center")
        _label(c, "TANK", tx, stand_top - H * 0.10, fs, D.color("#FFFFFF", 0.85 * a * pb), align="center")


def scene_stator_rotor(ctx, c, P: skia.Rect, t: float, dur: float, prm: dict, a: float):
    u = ctx.u
    top = _title(ctx, c, P, prm.get("title", "Inside the motor"), prm.get("sub", ""), progress(t, 0, 0.6), a)
    H = P.bottom() - top
    cx, cy = P.left() + P.width() * 0.40, top + H * 0.52
    R = H * 0.42
    pin = spring(progress(t, 0, 0.9))
    R *= pin
    if R <= 2:
        return
    en_at = prm.get("energize_at", 1e9)
    en = ease_out_cubic(progress(t, en_at, 0.6))
    copper = "#c8742b"
    # depth (stator is a short thick cylinder seen almost face-on)
    depth = R * 0.18
    for k in range(int(depth), 0, -3):
        c.drawCircle(cx + k * 0.75, cy + k * 0.45, R, D.fill(C(shade("#6c7a88", -0.55), a)))
    c.drawCircle(cx, cy, R, rad(cx - R * 0.4, cy - R * 0.4, R * 1.6, [(0, "#d7dee5"), (0.55, "#8a97a4"), (1, "#4a5662")], a))
    c.drawCircle(cx, cy, R * 0.97, D.stroke(C("#ffffff", 0.25 * a), 2 * u))
    # inner bore
    rb = R * 0.62
    c.drawCircle(cx, cy, rb, D.fill(C("#18212b", a)))
    # copper windings (stator coils)
    n = 8
    for k in range(n):
        th = k * 2 * math.pi / n + math.pi / 8
        c.save()
        c.translate(cx + math.cos(th) * R * 0.75, cy + math.sin(th) * R * 0.75)
        c.rotate(math.degrees(th) + 90)
        w, h = R * 0.34, R * 0.2
        D.rrect(c, -w / 2, -h / 2, w, h, h * 0.3, lin((0, -h / 2), (0, h / 2), [(0, shade(copper, 0.45)), (0.45, copper), (1, shade(copper, -0.45))], a))
        for s_ in range(6):
            xx = -w / 2 + w * (s_ + 0.5) / 6
            c.drawLine(xx, -h / 2 + 2, xx, h / 2 - 2, D.stroke(C(shade(copper, -0.4), 0.7 * a), 2 * u))
        if en > 0:
            gp = D.fill(C("#ffb347", 0.55 * en * (0.7 + 0.3 * math.sin(t * 9 + k))))
            gp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, h * 0.6))
            D.rrect(c, -w / 2, -h / 2, w, h, h * 0.3, gp)
        c.restore()
    # rotating magnetic field
    spin_speed = 0.6 + 5.5 * en
    ang = prm.get("_angle_offset", 0.0) + t * 0.6 + max(0.0, t - en_at) * 5.0 * en
    if en > 0:
        for k in range(2):
            th = ang + k * math.pi
            path = skia.Path()
            path.addArc(skia.Rect.MakeLTRB(cx - rb * 1.05, cy - rb * 1.05, cx + rb * 1.05, cy + rb * 1.05), math.degrees(th) - 50, 100)
            c.drawPath(path, D.stroke(C(ctx.hexc("primary"), 0.85 * en * a), 9 * u))
            fl = D.font(ctx.heading, 30 * u)
            D.draw_text(c, "N" if k == 0 else "S", cx + math.cos(th) * rb * 0.78, cy + math.sin(th) * rb * 0.78 + 11 * u, fl, D.color("#FFFFFF", en * a), align="center")
    # rotor (steel) with bars
    rr = rb * 0.82
    c.drawCircle(cx + 6 * u, cy + 4 * u, rr, D.fill(C("#20282f", a)))
    c.drawCircle(cx, cy, rr, rad(cx - rr * 0.35, cy - rr * 0.35, rr * 1.5, [(0, "#eef2f5"), (0.5, "#a5b1bc"), (1, "#5d6974")], a))
    for k in range(12):
        th = ang + k * math.pi / 6
        c.drawLine(cx + math.cos(th) * rr * 0.45, cy + math.sin(th) * rr * 0.45, cx + math.cos(th) * rr * 0.92, cy + math.sin(th) * rr * 0.92,
                   D.stroke(C("#5d6974", 0.8 * a), 5 * u))
    c.drawCircle(cx, cy, rr * 0.22, rad(cx - rr * 0.05, cy - rr * 0.05, rr * 0.3, [(0, "#ffffff"), (1, "#7d8995")], a))
    hl = skia.Path()
    hl.addArc(skia.Rect.MakeLTRB(cx - rr * 0.9, cy - rr * 0.9, cx + rr * 0.9, cy + rr * 0.9), 200, 60)
    c.drawPath(hl, D.stroke(D.color("#FFFFFF", 0.55 * a), 4 * u))
    # labels
    lt = prm.get("label_times", {})
    lx = P.right()
    if "stator" in lt:
        th = math.pi / 8 - 2 * math.pi / 8
        callout(ctx, c, "Stator", "copper winding", cx + math.cos(th) * R * 0.75, cy + math.sin(th) * R * 0.75, lx, top + H * 0.18, progress(t, lt["stator"], 0.6), "accent", align="right")
    if "rotor" in lt:
        callout(ctx, c, "Rotor", "steel", cx + rr * 0.3, cy + rr * 0.35, lx, top + H * 0.50, progress(t, lt["rotor"], 0.6), "primary", align="right")
    if "field" in lt:
        callout(ctx, c, "Magnetic field", "spins the rotor", cx + math.cos(ang) * rb * 1.05, cy + math.sin(ang) * rb * 1.05, lx, top + H * 0.82, progress(t, lt["field"], 0.6), "primary", align="right")


def scene_impeller(ctx, c, P: skia.Rect, t: float, dur: float, prm: dict, a: float):
    u = ctx.u
    top = _title(ctx, c, P, prm.get("title", "Inside the pump"), prm.get("sub", ""), progress(t, 0, 0.6), a)
    H = P.bottom() - top
    cx, cy = P.left() + P.width() * 0.42, top + H * 0.55
    R = H * 0.40 * spring(progress(t, 0, 0.9))
    if R <= 2:
        return
    lt = prm.get("label_times", {})
    spin = t * 6.5
    water = "#3da5ff"
    # delivery pipe (top right, tangential outlet) and suction pipe (bottom left into the eye)
    dx = cx + R * 0.72
    c.drawRect(skia.Rect.MakeLTRB(dx - R * 0.20, top + 6 * u, dx + R * 0.20, cy - R * 0.5), lin((dx - R * 0.2, 0), (dx + R * 0.2, 0), [(0, "#5d6974"), (0.4, "#c9d2da"), (1, "#4a5662")], a))
    sp = [(P.left() + 10 * u, cy + R * 1.05), (cx - R * 0.95, cy + R * 1.05), (cx - R * 0.35, cy + R * 0.25)]
    pp = skia.Path()
    pp.moveTo(*sp[0])
    for q in sp[1:]:
        pp.lineTo(*q)
    c.drawPath(pp, D.stroke(C("#8d99a6", a), R * 0.34, skia.Paint.kButt_Cap))
    c.drawPath(pp, D.stroke(C("#c9d2da", 0.45 * a), R * 0.08, skia.Paint.kButt_Cap))
    # volute casing (cut-away spiral) with thickness
    for k in range(10, 0, -1):
        c.drawCircle(cx + k * 1.4 * u, cy + k * 0.9 * u, R * 1.02, D.fill(C("#2b3440", a)))
    vol = skia.Path()
    for k in range(0, 361, 6):
        th = math.radians(k) - math.pi / 2
        rr = R * (0.80 + 0.22 * k / 360)
        x, y = cx + rr * math.cos(th), cy + rr * math.sin(th)
        vol.moveTo(x, y) if k == 0 else vol.lineTo(x, y)
    c.drawCircle(cx, cy, R * 1.02, rad(cx - R * 0.3, cy - R * 0.3, R * 1.5, [(0, "#dfe6ec"), (0.6, "#9aa7b4"), (1, "#5d6974")], a))
    c.drawCircle(cx, cy, R * 0.86, D.fill(C("#16202a", a)))
    c.drawPath(vol, D.stroke(C("#ffffff", 0.35 * a), 3 * u))
    # water spiralling outwards (centrifugal) then up the delivery pipe
    wp = ease_out_cubic(progress(t, lt.get("water", 0.6), 0.6))
    if wp > 0:
        for k in range(26):
            ph = (t * 0.9 + k / 26) % 1.0
            th = spin * 0.35 + k * 2.4
            rr = R * (0.2 + 0.62 * ph)
            x, y = cx + rr * math.cos(th), cy + rr * math.sin(th)
            c.drawCircle(x, y, (4 + 5 * ph) * u, D.fill(C(water, (0.35 + 0.6 * ph) * wp * a)))
        water_dots(c, [(dx, cy - R * 0.5), (dx, top + 6 * u)], t, 340 * u, 44 * u, 8 * u, water, wp * a)
        water_dots(c, sp, t, 300 * u, 50 * u, 8 * u, water, wp * a)
    # impeller: hub + curved vanes, rotating
    ri = R * 0.70
    c.drawCircle(cx + 5 * u, cy + 4 * u, ri, D.fill(C("#0d141b", 0.7 * a)))
    for k in range(6):
        th = spin + k * math.pi / 3
        vane = skia.Path()
        vane.moveTo(cx + math.cos(th) * ri * 0.25, cy + math.sin(th) * ri * 0.25)
        ctrl_th = th + 0.55
        vane.quadTo(cx + math.cos(ctrl_th) * ri * 0.65, cy + math.sin(ctrl_th) * ri * 0.65, cx + math.cos(th + 1.0) * ri, cy + math.sin(th + 1.0) * ri)
        c.drawPath(vane, D.stroke(C(shade(ctx.hexc("accent"), -0.35), a), 18 * u))
        c.drawPath(vane, D.stroke(C(ctx.hexc("accent"), a), 11 * u))
        c.drawPath(vane, D.stroke(C(shade(ctx.hexc("accent"), 0.5), 0.7 * a), 3 * u))
    c.drawCircle(cx, cy, ri * 0.28, rad(cx - ri * 0.08, cy - ri * 0.08, ri * 0.35, [(0, "#ffffff"), (1, "#8d99a6")], a))
    c.drawCircle(cx, cy, ri * 0.10, D.fill(C("#4a5662", a)))
    # centrifugal force arrows
    cp = ease_out_cubic(progress(t, lt.get("centrifugal", 1e9), 0.5))
    if cp > 0:
        for k in range(8):
            th = k * math.pi / 4 + 0.2
            pulse = (t * 1.6 + k * 0.12) % 1.0
            r0, r1 = R * (0.9 + 0.05 * pulse), R * (1.08 + 0.14 * pulse * cp)
            arrow(c, cx + math.cos(th) * r0, cy + math.sin(th) * r0, cx + math.cos(th) * r1, cy + math.sin(th) * r1, D.color("#FFFFFF", 0.75 * cp * a), 5 * u, 16 * u)
    lx = P.right()
    if "impeller" in lt:
        callout(ctx, c, "Impeller", "spins with the shaft", cx + ri * 0.55, cy - ri * 0.35, lx, top + H * 0.10, progress(t, lt["impeller"], 0.6), "accent", align="right")
    if "centrifugal" in lt:
        callout(ctx, c, "Centrifugal force", "throws water outwards", cx + R * 1.0, cy + R * 0.15, lx, top + H * 0.38, progress(t, lt["centrifugal"], 0.6), "primary", align="right")
    if "suction" in lt:
        callout(ctx, c, "Suction pipe", "water drawn in", sp[1][0], sp[1][1], lx, top + H * 0.66, progress(t, lt["suction"], 0.6), "primary", align="right")
    if "delivery" in lt:
        callout(ctx, c, "Delivery pipe", "water pushed out", dx, top + H * 0.08, lx, top + H * 0.92, progress(t, lt["delivery"], 0.6), "accent", align="right")


def scene_specs(ctx, c, P: skia.Rect, t: float, dur: float, prm: dict, a: float):
    u = ctx.u
    top = _title(ctx, c, P, prm.get("title", "Typical home motor"), prm.get("sub", ""), progress(t, 0, 0.6), a)
    H = P.bottom() - top
    W2 = P.width() / 2
    # card 1: horsepower
    p1 = spring(progress(t, prm.get("hp_at", 0.3), 0.8))
    x1 = P.left()
    cw, ch = W2 - 20 * u, H * 0.92
    c.save()
    c.translate(x1 + cw / 2, top + ch / 2)
    c.scale(p1, p1)
    D.rrect(c, -cw / 2, -ch / 2, cw, ch, 30 * u, D.shadow_paint(lin((0, -ch / 2), (0, ch / 2), [(0, shade(ctx.hexc("darker"), 0.12)), (1, ctx.hexc("darker"))], 0.95 * a), 20 * u, 10 * u, 0.45 * a))
    hcyl(c, -cw * 0.30, -ch * 0.18, cw * 0.42, ch * 0.13, "#2f6f9a", a, fins=5)
    c.drawCircle(cw * 0.22, -ch * 0.18, ch * 0.15, rad(cw * 0.2, -ch * 0.22, ch * 0.2, [(0, shade(ctx.hexc("alert"), 0.4)), (1, ctx.hexc("alert"))], a))
    cnt = ease_out_cubic(progress(t, prm.get("hp_at", 0.3) + 0.2, 1.0))
    fnum = D.font(ctx.heading, 96 * u)
    D.draw_text(c, f"{0.5 * cnt:.1f}–{1.5 * cnt:.1f}", 0, ch * 0.20, fnum, ctx.col("accent", a), align="center")
    fl = D.font(ctx.heading, 34 * u)
    D.draw_text(c, "HORSEPOWER", 0, ch * 0.20 + 54 * u, fl, D.color("#FFFFFF", a), align="center")
    c.restore()
    # card 2: lift height
    p2 = spring(progress(t, prm.get("lift_at", 2.0), 0.8))
    x2 = P.left() + W2 + 20 * u
    c.save()
    c.translate(x2 + cw / 2, top + ch / 2)
    c.scale(p2, p2)
    D.rrect(c, -cw / 2, -ch / 2, cw, ch, 30 * u, D.shadow_paint(lin((0, -ch / 2), (0, ch / 2), [(0, shade(ctx.hexc("darker"), 0.12)), (1, ctx.hexc("darker"))], 0.95 * a), 20 * u, 10 * u, 0.45 * a))
    ground = ch * 0.05
    c.drawRect(skia.Rect.MakeLTRB(-cw / 2 + 20 * u, ground, cw / 2 - 20 * u, ground + 8 * u), D.fill(C("#5d8a3a", a)))
    hp_ = ease_out_cubic(progress(t, prm.get("lift_at", 2.0) + 0.3, 1.2))
    pipe_x = -cw * 0.12
    tank_y = lerp(ground - 10 * u, -ch * 0.36, hp_)
    c.drawLine(pipe_x, ground, pipe_x, tank_y, D.stroke(C("#9aa7b4", a), 12 * u))
    water_dots(c, [(pipe_x, ground), (pipe_x, tank_y)], t, 260 * u, 34 * u, 5 * u, "#3da5ff", a * hp_)
    vcyl(c, pipe_x, tank_y - ch * 0.08, ch * 0.09, cw * 0.14, "#dfe6ec", a, fill_level=0.3 + 0.5 * hp_)
    ax = cw * 0.18
    arrow(c, ax, ground - 4 * u, ax, tank_y + 6 * u, ctx.col("accent", a), 5 * u, 18 * u)
    arrow(c, ax, tank_y + 6 * u, ax, ground - 4 * u, ctx.col("accent", a), 5 * u, 18 * u)
    D.draw_text(c, f"{int(round(20 * hp_))} m", ax + 16 * u, (ground + tank_y) / 2 + 14 * u, D.font(ctx.heading, 44 * u), D.color("#FFFFFF", a))
    D.draw_text(c, "UP TO 20 m", 0, ch * 0.20 + 30 * u, D.font(ctx.heading, 60 * u), ctx.col("accent", a), align="center")
    D.draw_text(c, "LIFT", 0, ch * 0.20 + 84 * u, fl, D.color("#FFFFFF", a), align="center")
    c.restore()


SCENES = {"pump_set": scene_pump_set, "energy_flow": scene_energy_flow, "stator_rotor": scene_stator_rotor, "impeller": scene_impeller, "specs": scene_specs}


def draw_illustration(ctx, canvas: skia.Canvas, g, t: float):
    """Graphic type 'illustration': params {scene, ...scene params}. Times inside params are relative to the graphic start."""
    from .graphics import panel_rect
    fn = SCENES.get(g.params.get("scene", ""))
    if not fn:
        return
    P = panel_rect(ctx)
    if ctx.vertical:
        P = skia.Rect.MakeXYWH(ctx.W * 0.06, ctx.H * 0.07, ctx.W * 0.86, ctx.H * 0.375)
    tl = t - g.start
    dur = g.end - g.start
    a = ease_out_cubic(progress(tl, 0, 0.35)) * (1 - ease_in_out(progress(tl, dur - 0.3, 0.3)))
    if a <= 0:
        return
    canvas.save()
    canvas.clipRect(skia.Rect.MakeLTRB(0, 0, ctx.W, ctx.H * (0.512 if ctx.vertical else 1.0)))
    fn(ctx, canvas, P, tl, dur, g.params, a)
    canvas.restore()
