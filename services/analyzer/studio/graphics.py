"""Motion-graphics components. Each draw_* function renders one Graphic at output time t."""
from __future__ import annotations

import math
import random

import skia

from . import draw as D
from .logo import draw_logo
from .motion import clamp, ease_in_cubic, ease_in_out, ease_out_back, ease_out_cubic, lerp, progress, spring


class Ctx:
    def __init__(self, plan, W: int, H: int):
        self.plan = plan
        self.W, self.H = W, H
        self.vertical = H > W
        self.u = (W if self.vertical else H) / 1080.0
        self.c = plan.brand.colors
        self.brand = plan.brand
        self.heading = plan.brand.heading_font
        self.body = plan.brand.body_font
        self.speech_end = plan.speech_duration
        self.total = plan.total_duration
        rnd = random.Random(7)
        self.nodes = [(rnd.random(), rnd.random(), rnd.uniform(2.5, 5.5), rnd.uniform(0, 6.28), rnd.uniform(0.15, 0.35)) for _ in range(26)]

    def col(self, role: str, alpha: float = 1.0) -> int:
        return D.color(self.c.get(role, role if role.startswith("#") else "#ffffff"), alpha)

    def hexc(self, role: str) -> str:
        return self.c.get(role, role if role.startswith("#") else "#ffffff")


def _io(t: float, g, tin: float = 0.35, tout: float = 0.25) -> tuple[float, float]:
    """in-progress (0..1) and out-progress (0..1)."""
    return progress(t, g.start, tin), progress(t, g.end - tout, tout)


# ---------- shared backgrounds ----------
_BG_CACHE: dict = {}


def _bg_static(ctx: Ctx, rect: skia.Rect) -> skia.Image:
    key = (ctx.hexc("dark"), ctx.hexc("darker"), ctx.hexc("primary"), ctx.hexc("accent"), int(rect.width()), int(rect.height()))
    img = _BG_CACHE.get(key)
    if img is None:
        w, h = int(rect.width()), int(rect.height())
        surf = skia.Surface(w, h)
        c = surf.getCanvas()
        r = skia.Rect.MakeWH(w, h)
        c.drawRect(r, D.vgradient(0, 0, w, h, ctx.hexc("dark"), ctx.hexc("darker"), 1.0))
        c.drawCircle(w * 0.15, h * 0.25, w * 0.55, D.radial(w * 0.15, h * 0.25, w * 0.55, ctx.hexc("primary"), 0.22))
        c.drawCircle(w * 0.9, h * 0.8, w * 0.5, D.radial(w * 0.9, h * 0.8, w * 0.5, ctx.hexc("accent"), 0.16))
        img = surf.makeImageSnapshot()
        _BG_CACHE[key] = img
    return img


def draw_network_bg(ctx: Ctx, canvas: skia.Canvas, t: float, rect: skia.Rect, alpha: float = 1.0, dense: float = 1.0) -> None:
    """Brand background: dark gradient, soft colour glows and a slowly drifting node network (logo motif)."""
    canvas.save()
    canvas.clipRect(rect, True)
    canvas.drawImageRect(_bg_static(ctx, rect), rect, skia.SamplingOptions(), skia.Paint(Alphaf=alpha))
    pts = []
    n = int(len(ctx.nodes) * dense)
    for (x, y, r, ph, sp) in ctx.nodes[:n]:
        px = rect.left() + (x + 0.03 * math.sin(t * sp + ph)) * rect.width()
        py = rect.top() + (y + 0.03 * math.cos(t * sp * 0.8 + ph)) * rect.height()
        pts.append((px, py, r))
    link = ctx.u * 260
    lp = D.stroke(ctx.col("light", 0.07 * alpha), max(1.0, ctx.u * 1.6))
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            dx, dy = pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]
            d = math.hypot(dx, dy)
            if d < link:
                lp.setAlphaf(0.10 * alpha * (1 - d / link))
                canvas.drawLine(pts[i][0], pts[i][1], pts[j][0], pts[j][1], lp)
    for k, (px, py, r) in enumerate(pts):
        role = ("primary", "accent", "alert", "light")[k % 4]
        canvas.drawCircle(px, py, r * ctx.u, D.fill(ctx.col(role, (0.55 if role != "light" else 0.25) * alpha)))
    canvas.restore()


# ---------- components ----------
def draw_hook_title(ctx: Ctx, canvas, g, t):
    text = str(g.params.get("text", "")).strip()
    if not text:
        return
    hl = {w.lower().strip(".,!?") for w in g.params.get("highlight", [])}
    pin, pout = _io(t, g, 0.45, 0.3)
    u = ctx.u
    size = (60 if ctx.vertical else 56) * u
    max_w = (ctx.W * 0.82) if ctx.vertical else ctx.W * 0.55
    f, lines = D.fit_font(text.upper(), ctx.heading, size, max_w - 70 * u, 3, size * 0.7)
    line_h = f.getSize() * 1.14
    box_w = max(D.text_width(l, f) for l in lines) + 76 * u
    box_h = line_h * len(lines) + 46 * u
    cx = ctx.W * (0.47 if ctx.vertical else 0.5)
    top = ctx.H * (0.152 if ctx.vertical else 0.08)
    a = ease_out_cubic(pin) * (1 - ease_in_cubic(pout))
    dy = (1 - ease_out_cubic(pin)) * -40 * u - ease_in_cubic(pout) * 30 * u
    x = cx - box_w / 2
    canvas.save()
    canvas.translate(0, dy)
    reveal = ease_out_cubic(clamp(pin * 1.3))
    canvas.clipRect(skia.Rect.MakeXYWH(x - 30 * u, top - 30 * u, (box_w + 60 * u) * reveal, box_h + 80 * u))
    D.rrect(canvas, x, top, box_w, box_h, 26 * u, D.shadow_paint(D.fill(ctx.col("darker", 0.93 * a)), 18 * u, 10 * u, 0.4 * a))
    D.rrect(canvas, x, top, 12 * u, box_h, 6 * u, D.fill(ctx.col("accent", a)))
    y = top + 23 * u + line_h * 0.80
    for i, line in enumerate(lines):
        lp = ease_out_cubic(clamp((pin - 0.15 - 0.12 * i) / 0.5))
        xx = x + 44 * u
        for word in line.split():
            colr = ctx.col("accent", a * lp) if word.lower().strip(".,!?") in hl else D.color("#FFFFFF", a * lp)
            D.draw_text(canvas, word, xx, y + (1 - lp) * 18 * u, f, colr)
            xx += D.text_width(word + " ", f)
        y += line_h
    canvas.restore()


def draw_logo_bug(ctx: Ctx, canvas, g, t):
    u = ctx.u
    p = progress(t, g.start, 1.2)
    pout = progress(t, g.end - 0.3, 0.3)
    if p <= 0:
        return
    r = (62 if ctx.vertical else 58) * u * float(g.params.get("scale", 1.0))
    cx = ctx.W - (0.16 if ctx.vertical else 0.07) * ctx.W
    cy = ctx.H * (0.088 if ctx.vertical else 0.11)
    sc = spring(clamp(p * 2.2)) * (1 - ease_in_cubic(pout))
    if sc <= 0.01:
        return
    canvas.save()
    canvas.translate(cx, cy)
    canvas.scale(sc, sc)
    D.circle(canvas, 0, 0, r, D.shadow_paint(D.fill(D.color("#FFFFFF", 0.96)), 14 * u, 6 * u, 0.35))
    draw_logo(canvas, ctx.brand, 0, 0, r * 1.62, p=clamp(p * 1.1), on_dark=False)
    canvas.restore()


def draw_lower_third(ctx: Ctx, canvas, g, t):
    name = str(g.params.get("name", "")).strip()
    role = str(g.params.get("role", "")).strip()
    if not name:
        return
    u = ctx.u
    pin, pout = _io(t, g, 0.5, 0.35)
    x = ctx.W * 0.06
    y = ctx.H * (0.585 if ctx.vertical else 0.70)
    fn = D.font(ctx.heading, 46 * u)
    fr = D.font(ctx.body, 31 * u)
    wn = D.text_width(name.upper(), fn) + 60 * u
    wr = D.text_width(role, fr) + 48 * u if role else 0
    hn, hr = 78 * u, 54 * u
    grow = ease_out_cubic(clamp(pin * 1.4)) * (1 - ease_in_out(pout))
    canvas.save()
    D.rrect(canvas, x, y, 14 * u, hn + (hr if role else 0), 4 * u, D.fill(ctx.col("accent", clamp(grow * 2))))
    canvas.clipRect(skia.Rect.MakeXYWH(x + 14 * u, y - 10 * u, max(wn, wr) * grow + 10 * u, hn + hr + 30 * u))
    D.rrect(canvas, x + 14 * u, y, wn, hn, 6 * u, D.shadow_paint(D.fill(ctx.col("primary")), 14 * u, 6 * u, 0.35))
    D.draw_text(canvas, name.upper(), x + 44 * u, y + hn * 0.66, fn, D.color("#FFFFFF"))
    if role:
        D.rrect(canvas, x + 14 * u, y + hn, wr, hr, 6 * u, D.fill(D.color("#FFFFFF", 0.97)))
        D.draw_text(canvas, role, x + 38 * u, y + hn + hr * 0.68, fr, ctx.col("dark"))
    canvas.restore()


def _pill(ctx, canvas, text, cx, cy, size, bg_role, icon=None, a=1.0, text_role="#FFFFFF"):
    u = ctx.u
    f, lines = D.fit_font(text, ctx.heading, size, ctx.W * (0.74 if ctx.vertical else 0.5), 1, size * 0.55)
    tw = D.text_width(lines[0], f)
    ih = f.getSize() * 0.95 if icon else 0
    pad_x, pad_y = 44 * u, 28 * u
    w = tw + pad_x * 2 + (ih + 20 * u if icon else 0)
    h = f.getSize() * 1.05 + pad_y * 2
    x, y = cx - w / 2, cy - h / 2
    D.rrect(canvas, x, y, w, h, h / 2, D.shadow_paint(D.fill(ctx.col(bg_role, a)), 22 * u, 12 * u, 0.4 * a))
    tx = x + pad_x
    if icon:
        D.draw_icon(canvas, icon, tx + ih / 2, cy, ih, "#FFFFFF", 2.4)
        tx += ih + 20 * u
    D.draw_text(canvas, lines[0], tx, cy + D.cap_height(f) / 2, f, D.color(text_role, a))
    return w, h


def draw_keyword_pop(ctx: Ctx, canvas, g, t):
    text = str(g.params.get("text", "")).strip().upper()
    if not text:
        return
    u = ctx.u
    pin = progress(t, g.start, 0.5)
    pout = progress(t, g.end - 0.2, 0.2)
    sc = spring(pin, damping=5.5, freq=2.2) * (1 - 0.25 * ease_in_cubic(pout))
    a = clamp(pin * 4) * (1 - ease_in_cubic(pout))
    if a <= 0:
        return
    cx = ctx.W * (0.47 if ctx.vertical else 0.5)
    cy = ctx.H * (0.255 if ctx.vertical else 0.24)
    rot = lerp(-7, -2.5, ease_out_cubic(pin))
    float_y = math.sin((t - g.start) * 2.4) * 4 * u
    canvas.save()
    canvas.translate(cx, cy + float_y)
    canvas.rotate(rot)
    canvas.scale(sc, sc)
    _pill(ctx, canvas, text, 0, 0, (80 if ctx.vertical else 72) * u, g.params.get("color", "accent"), g.params.get("icon"), a)
    sub = str(g.params.get("sub", "")).strip()
    if sub:
        fs = D.font(ctx.body, 36 * u)
        D.draw_text(canvas, sub, 0, 92 * u, fs, D.color("#FFFFFF", a), stroke_c=D.color("#000000", a * 0.8), stroke_w=6 * u, align="center")
    canvas.restore()


def draw_icon_callout(ctx: Ctx, canvas, g, t):
    text = str(g.params.get("text", "")).strip()
    icon = g.params.get("icon", "sparkles")
    u = ctx.u
    pin, pout = _io(t, g, 0.45, 0.25)
    e = ease_out_back(pin) if pin < 1 else 1.0
    a = clamp(pin * 3) * (1 - ease_in_cubic(pout))
    if a <= 0:
        return
    f = D.font(ctx.heading, 44 * u)
    tw = D.text_width(text.upper(), f) if text else 0
    r = 52 * u
    chip_w = tw + 70 * u
    total = 2 * r + (chip_w - 20 * u if text else 0)
    right = ctx.W * (0.84 if ctx.vertical else 0.93)
    cy = ctx.H * (0.34 if ctx.vertical else 0.30)
    x0 = right - total + (1 - e) * 120 * u + ease_in_cubic(pout) * 80 * u
    if text:
        D.rrect(canvas, x0 + r, cy - 40 * u, chip_w, 80 * u, 40 * u, D.shadow_paint(D.fill(D.color("#FFFFFF", 0.97 * a)), 16 * u, 8 * u, 0.35 * a))
        D.draw_text(canvas, text.upper(), x0 + 2 * r + 14 * u, cy + D.cap_height(f) / 2, f, ctx.col("dark", a))
    D.circle(canvas, x0 + r, cy, r, D.shadow_paint(D.fill(ctx.col(g.params.get("color", "primary"), a)), 16 * u, 8 * u, 0.4 * a))
    D.draw_icon(canvas, icon, x0 + r, cy, r * 1.05, "#FFFFFF", 2.3)


def draw_stat_counter(ctx: Ctx, canvas, g, t):
    u = ctx.u
    try:
        value = float(g.params.get("value", 0))
    except (TypeError, ValueError):
        value = 0.0
    dec = int(g.params.get("decimals", 0 if float(value).is_integer() else 1))
    prefix, suffix = str(g.params.get("prefix", "")), str(g.params.get("suffix", ""))
    label = str(g.params.get("label", "")).strip()
    pin, pout = _io(t, g, 0.45, 0.25)
    cp = ease_out_cubic(progress(t, g.start + 0.15, 0.9))
    sc = spring(pin) * (1 - 0.15 * ease_in_cubic(pout))
    a = clamp(pin * 3) * (1 - ease_in_cubic(pout))
    if a <= 0:
        return
    cx = ctx.W * (0.47 if ctx.vertical else 0.5)
    cy = ctx.H * (0.25 if ctx.vertical else 0.30)
    fnum = D.font(ctx.heading, 150 * u)
    flab = D.font(ctx.body, 40 * u)
    num = f"{prefix}{value * cp:,.{dec}f}{suffix}"
    final = f"{prefix}{value:,.{dec}f}{suffix}"
    w = max(D.text_width(final, fnum) + 120 * u, 560 * u)
    lab_lines = D.wrap(label, flab, w - 80 * u, 2) if label else []
    h = 210 * u + len(lab_lines) * 52 * u + 30 * u
    canvas.save()
    canvas.translate(cx, cy)
    canvas.scale(sc, sc)
    D.rrect(canvas, -w / 2, -h / 2, w, h, 36 * u, D.shadow_paint(D.fill(ctx.col("darker", 0.94 * a)), 24 * u, 12 * u, 0.45 * a))
    D.draw_text(canvas, num, 0, -h / 2 + 170 * u, fnum, ctx.col("accent", a), align="center")
    ul = (w - 160 * u) * ease_out_cubic(progress(t, g.start + 0.3, 0.6))
    D.rrect(canvas, -ul / 2, -h / 2 + 196 * u, ul, 8 * u, 4 * u, D.fill(ctx.col("primary", a)))
    y = -h / 2 + 196 * u + 60 * u
    for ln in lab_lines:
        D.draw_text(canvas, ln, 0, y, flab, D.color("#FFFFFF", a), align="center")
        y += 52 * u
    canvas.restore()


def panel_rect(ctx: Ctx) -> skia.Rect:
    if ctx.vertical:
        return skia.Rect.MakeXYWH(ctx.W * 0.07, ctx.H * 0.085, ctx.W * 0.80, ctx.H * 0.40)
    return skia.Rect.MakeXYWH(ctx.W * 0.05, ctx.H * 0.12, ctx.W * 0.42, ctx.H * 0.72)


def _panel_title(ctx, canvas, title, rect, p, a):
    if not title:
        return rect.top()
    u = ctx.u
    f, lines = D.fit_font(title.upper(), ctx.heading, 64 * u, rect.width(), 2, 40 * u)
    y = rect.top() + f.getSize()
    e = ease_out_cubic(p)
    for ln in lines:
        D.draw_text(canvas, ln, rect.left() + (1 - e) * -40 * u, y, f, D.color("#FFFFFF", a * e))
        y += f.getSize() * 1.12
    ul = 140 * u * ease_out_cubic(clamp(p * 1.3 - 0.2))
    D.rrect(canvas, rect.left(), y - f.getSize() * 0.6, ul, 9 * u, 4.5 * u, D.fill(ctx.col("accent", a)))
    return y + 10 * u


def _item_times(g, n):
    times = g.params.get("item_times")
    if isinstance(times, list) and len(times) >= n:
        return [float(x) for x in times[:n]]
    span = max(0.6, (g.end - g.start - 0.8))
    return [g.start + 0.45 + span * i / max(1, n) for i in range(n)]


def draw_bullet_list(ctx: Ctx, canvas, g, t):
    items = [str(x) for x in g.params.get("items", []) if str(x).strip()][:4]
    u = ctx.u
    rect = panel_rect(ctx)
    pin, pout = _io(t, g, 0.5, 0.3)
    a = 1 - ease_in_cubic(pout)
    y = _panel_title(ctx, canvas, g.params.get("title", ""), rect, pin, a) + 30 * u
    f = D.font(ctx.body, 44 * u)
    times = _item_times(g, len(items))
    for it, t0 in zip(items, times):
        p = progress(t, t0, 0.4)
        if p <= 0:
            continue
        e = ease_out_back(p) if p < 1 else 1.0
        r = 30 * u
        x = rect.left() + (1 - e) * -60 * u
        lines = D.wrap(it, f, rect.width() - 2 * r - 30 * u, 2)
        row_h = max(2 * r, len(lines) * 54 * u)
        canvas.drawCircle(x + r, y + r, r * min(1.0, e), D.fill(ctx.col("primary", a)))
        D.draw_icon(canvas, "check", x + r, y + r, r * 1.1, "#FFFFFF", 3.0)
        ly = y + r + D.cap_height(f) / 2 - (len(lines) - 1) * 27 * u
        for ln in lines:
            D.draw_text(canvas, ln, x + 2 * r + 26 * u, ly, f, D.color("#FFFFFF", a * clamp(p * 2)))
            ly += 54 * u
        y += row_h + 34 * u


def draw_process_flow(ctx: Ctx, canvas, g, t):
    steps = [s if isinstance(s, dict) else {"label": str(s)} for s in g.params.get("steps", [])][:4]
    if not steps:
        return
    u = ctx.u
    rect = panel_rect(ctx)
    pin, pout = _io(t, g, 0.5, 0.3)
    a = 1 - ease_in_cubic(pout)
    top = _panel_title(ctx, canvas, g.params.get("title", ""), rect, pin, a)
    n = len(steps)
    r = (96 if n <= 3 else 78) * u
    cy = top + (rect.bottom() - top) * 0.40
    xs = [rect.left() + rect.width() * (i + 0.5) / n for i in range(n)]
    times = _item_times(g, n)
    f = D.font(ctx.heading.replace("ExtraBold", "Bold"), (38 if n <= 3 else 33) * u)
    # connectors
    for i in range(n - 1):
        p = ease_in_out(progress(t, times[i + 1] - 0.35, 0.45))
        if p <= 0:
            continue
        x0, x1 = xs[i] + r + 6 * u, xs[i + 1] - r - 6 * u
        xe = lerp(x0, x1, p)
        canvas.drawLine(x0, cy, xe, cy, D.stroke(ctx.col("accent", a), 7 * u))
        if p < 1:
            canvas.drawCircle(xe, cy, 10 * u, D.fill(ctx.col("accent", a)))
        else:
            head = skia.Path()
            head.moveTo(x1, cy)
            head.lineTo(x1 - 20 * u, cy - 13 * u)
            head.lineTo(x1 - 20 * u, cy + 13 * u)
            head.close()
            canvas.drawPath(head, D.fill(ctx.col("accent", a)))
    for i, (s, x) in enumerate(zip(steps, xs)):
        p = progress(t, times[i], 0.55)
        if p <= 0:
            continue
        e = spring(p)
        active = i == max([k for k, tt in enumerate(times) if tt <= t] or [0])
        D.circle(canvas, x, cy, r * e, D.shadow_paint(D.fill(ctx.col("darker", 0.95 * a)), 18 * u, 8 * u, 0.4 * a))
        canvas.drawCircle(x, cy, r * e, D.stroke(ctx.col("primary" if not active else "accent", a), 7 * u))
        if e > 0.3:
            D.draw_icon(canvas, s.get("icon", "sparkles"), x, cy, r * 0.95 * e, "#FFFFFF", 2.2)
        num_f = D.font(ctx.heading, 26 * u)
        canvas.drawCircle(x + r * 0.72, cy - r * 0.72, 22 * u * e, D.fill(ctx.col("accent", a)))
        D.draw_text(canvas, str(i + 1), x + r * 0.72, cy - r * 0.72 + 9 * u, num_f, D.color("#FFFFFF", a), align="center")
        lines = D.wrap(str(s.get("label", "")), f, rect.width() / n - 16 * u, 3)
        ly = cy + r + 56 * u
        for ln in lines:
            D.draw_text(canvas, ln, x, ly, f, D.color("#FFFFFF", a * clamp(p * 1.8)), align="center")
            ly += f.getSize() * 1.2


def draw_image_card(ctx: Ctx, canvas, g, t):
    img = D.load_image(g.params.get("path", ""))
    if img is None:
        return
    u = ctx.u
    rect = panel_rect(ctx)
    pin, pout = _io(t, g, 0.5, 0.3)
    a = ease_out_cubic(pin) * (1 - ease_in_cubic(pout))
    top = _panel_title(ctx, canvas, g.params.get("title", ""), rect, pin, a) + 16 * u
    avail = skia.Rect.MakeLTRB(rect.left(), top, rect.right(), rect.bottom() - (60 * u if g.params.get("caption") else 0))
    ar = img.width() / img.height()
    w = min(avail.width(), avail.height() * ar)
    h = w / ar
    dst = skia.Rect.MakeXYWH(avail.centerX() - w / 2, avail.top() + (avail.height() - h) / 2, w, h)
    sc = lerp(0.92, 1.0, ease_out_back(pin))
    canvas.save()
    canvas.translate(dst.centerX(), dst.centerY())
    canvas.scale(sc, sc)
    canvas.translate(-dst.centerX(), -dst.centerY())
    D.rrect(canvas, dst.left(), dst.top(), dst.width(), dst.height(), 30 * u, D.shadow_paint(D.fill(D.color("#000000", 0.5 * a)), 26 * u, 14 * u, 0.5 * a))
    zoom = lerp(1.0, 1.08, progress(t, g.start, g.end - g.start))
    D.draw_image_cover(canvas, img, dst, 0.5, 0.5, zoom, 30 * u, a)
    canvas.restore()
    cap = str(g.params.get("caption", "")).strip()
    if cap:
        fc = D.font(ctx.body, 36 * u)
        D.draw_text(canvas, cap, dst.centerX(), dst.bottom() + 52 * u, fc, D.color("#FFFFFF", a), align="center")


def draw_broll_full(ctx: Ctx, canvas, g, t):
    img = D.load_image(g.params.get("path", ""))
    if img is None:
        return
    pin, pout = _io(t, g, 0.25, 0.25)
    a = ease_out_cubic(pin) * (1 - ease_in_cubic(pout))
    zoom = lerp(1.0, 1.12, progress(t, g.start, g.end - g.start))
    D.draw_image_cover(canvas, img, skia.Rect.MakeWH(ctx.W, ctx.H), float(g.params.get("focus_x", 0.5)), float(g.params.get("focus_y", 0.5)), zoom, 0, a)
    canvas.drawRect(skia.Rect.MakeXYWH(0, ctx.H * 0.55, ctx.W, ctx.H * 0.45), D.vgradient(0, ctx.H * 0.55, ctx.W, ctx.H * 0.45, "#000000", "#000000", 0.0))
    shade = skia.GradientShader.MakeLinear([skia.Point(0, ctx.H * 0.5), skia.Point(0, ctx.H)], [D.color("#000000", 0.0), D.color("#000000", 0.55 * a)])
    canvas.drawRect(skia.Rect.MakeXYWH(0, ctx.H * 0.5, ctx.W, ctx.H * 0.5), skia.Paint(Shader=shade))


def draw_progress_bar(ctx: Ctx, canvas, g, t):
    u = ctx.u
    p = clamp(t / max(0.1, ctx.speech_end))
    h = 9 * u
    a = 1 - progress(t, g.end - 0.3, 0.3)
    canvas.drawRect(skia.Rect.MakeXYWH(0, 0, ctx.W, h), D.fill(D.color("#FFFFFF", 0.22 * a)))
    shader = skia.GradientShader.MakeLinear([skia.Point(0, 0), skia.Point(ctx.W, 0)], [ctx.col("primary", a), ctx.col("accent", a)])
    canvas.drawRect(skia.Rect.MakeXYWH(0, 0, ctx.W * p, h), skia.Paint(Shader=shader, AntiAlias=True))


def draw_intro_wipe(ctx: Ctx, canvas, g, t):
    """Brand bands cover the first frames and slide away to the right, revealing the video (~0.5 s)."""
    dur = max(0.35, g.end - g.start)
    W, H = ctx.W, ctx.H
    slant = H * 0.30
    for i, role in enumerate(("dark", "primary", "accent")):
        lp = ease_in_out(clamp((t - g.start - i * 0.06) / (dur - 0.12)))
        if lp >= 1:
            continue
        x = lerp(-slant, W + slant, lp)          # left edge of the band moves across the frame
        band = W * (0.20 if i else 1.2)           # the first (dark) band is wide and uncovers the frame
        left = x - (i * W * 0.07)
        path = skia.Path()
        path.moveTo(left + slant, 0)
        path.lineTo(left + slant + band + W * 1.2 * (i == 0), 0)
        path.lineTo(left + band + W * 1.2 * (i == 0), H)
        path.lineTo(left, H)
        path.close()
        canvas.drawPath(path, D.fill(ctx.col(role, 1.0)))


def draw_cta_banner(ctx: Ctx, canvas, g, t):
    text = str(g.params.get("text", "")).strip()
    if not text:
        return
    u = ctx.u
    pin, pout = _io(t, g, 0.45, 0.3)
    a = clamp(pin * 3) * (1 - ease_in_cubic(pout))
    if a <= 0:
        return
    cx = ctx.W * (0.47 if ctx.vertical else 0.5)
    cy = ctx.H * (0.605 if ctx.vertical else 0.66) + (1 - ease_out_back(pin)) * 60 * u
    canvas.save()
    _pill(ctx, canvas, text.upper(), cx, cy, 46 * u, g.params.get("color", "primary"), g.params.get("icon", "bell"), a)
    canvas.restore()


def draw_end_card(ctx: Ctx, canvas, g, t):
    u = ctx.u
    W, H = ctx.W, ctx.H
    p = progress(t, g.start, 0.55)
    if p <= 0:
        return
    # circular reveal from the centre
    rmax = math.hypot(W, H) * 0.6
    canvas.save()
    path = skia.Path()
    path.addCircle(W / 2, H * 0.45, rmax * ease_in_out(p))
    canvas.clipPath(path, skia.ClipOp.kIntersect, True)
    draw_network_bg(ctx, canvas, t, skia.Rect.MakeWH(W, H), 1.0, 1.0)
    lp = progress(t, g.start + 0.25, 1.3)
    logo_h = (430 if ctx.vertical else 360) * u
    cy_logo = H * (0.38 if ctx.vertical else 0.36)
    draw_logo(canvas, ctx.brand, W / 2, cy_logo, logo_h, p=lp, on_dark=True)
    name = str(g.params.get("company", ctx.brand.company_name or "")).strip()
    y = cy_logo + logo_h / 2 + 100 * u
    tp = ease_out_cubic(progress(t, g.start + 0.9, 0.5))
    if name:
        fn, lines = D.fit_font(name.upper(), ctx.heading, 66 * u, W * 0.84, 2, 40 * u)
        for ln in lines:
            D.draw_text(canvas, ln, W / 2, y + (1 - tp) * 30 * u, fn, D.color("#FFFFFF", tp), align="center")
            y += fn.getSize() * 1.15
    tag = str(g.params.get("tagline", "")).strip()
    if tag:
        ft = D.font(ctx.body, 36 * u)
        D.draw_text(canvas, tag, W / 2, y + 10 * u, ft, D.color("#FFFFFF", 0.8 * tp), align="center")
        y += 60 * u
    cta = str(g.params.get("cta", "Follow for more")).strip()
    cp = progress(t, g.start + 1.15, 0.5)
    if cta and cp > 0:
        canvas.save()
        canvas.translate(W / 2, y + 70 * u)
        s = spring(cp)
        canvas.scale(s, s)
        _pill(ctx, canvas, cta.upper(), 0, 0, 44 * u, "accent", g.params.get("icon", "bell"), clamp(cp * 3))
        canvas.restore()
        y += 150 * u
    handle = str(g.params.get("handle", ctx.brand.handle or "")).strip()
    if handle:
        fh = D.font(ctx.body, 38 * u)
        D.draw_text(canvas, handle, W / 2, y + 30 * u, fh, D.color("#FFFFFF", 0.85 * ease_out_cubic(progress(t, g.start + 1.4, 0.5))), align="center")
    canvas.restore()


DRAWERS = {
    "hook_title": draw_hook_title, "logo_bug": draw_logo_bug, "lower_third": draw_lower_third,
    "keyword_pop": draw_keyword_pop, "icon_callout": draw_icon_callout, "stat_counter": draw_stat_counter,
    "bullet_list": draw_bullet_list, "process_flow": draw_process_flow, "image_card": draw_image_card,
    "broll_full": draw_broll_full, "progress_bar": draw_progress_bar, "intro_wipe": draw_intro_wipe,
    "cta_banner": draw_cta_banner, "end_card": draw_end_card,
}
from .illustrations import draw_illustration  # noqa: E402
DRAWERS["illustration"] = draw_illustration
from .editorial import draw_fullscreen, draw_pop3d, draw_text_behind  # noqa: E402
DRAWERS["pop3d"] = draw_pop3d
from .editorial import draw_model3d  # noqa: E402
DRAWERS["model3d"] = draw_model3d
DRAWERS["fullscreen"] = draw_fullscreen
DRAWERS["text_behind"] = draw_text_behind
# Drawing order (back to front)
LAYER = {"broll_full": 0, "image_card": 1, "illustration": 1, "bullet_list": 1, "process_flow": 1, "progress_bar": 5, "logo_bug": 5,
         "lower_third": 4, "icon_callout": 4, "stat_counter": 4, "keyword_pop": 4, "cta_banner": 4, "hook_title": 4,
         "end_card": 9, "intro_wipe": 10, "fullscreen": 1, "text_behind": 0, "pop3d": 1, "model3d": 1}
