"""Full-screen 2D explainer diagrams that Claude describes as nodes and links.

params: {"kind": "diagram", "title": "...", "layout": "row" | "column" | "cycle" | "grid",
         "nodes": [{"id": "grid", "label": "Power grid", "sub": "230 V AC", "icon": "zap", "at": 0.2, "color": "primary"}],
         "links": [{"from": "grid", "to": "meter", "label": "", "kind": "current" | "water" | "data" | "air" | "heat", "at": 0.6}],
         "look": "dark" | "light"}
Nodes pop in at their time, links draw themselves and then carry moving dots (current, water, data ...).
"""
from __future__ import annotations

import math

import skia

from . import draw as D
from .motion import clamp, ease_out_back, ease_out_cubic, progress

LINK_COLORS = {"current": "#FFC83D", "water": "#3FA9F5", "data": "#7CFF8A", "air": "#CFE8FF", "heat": "#FF7A2F", "money": "#2DBE6C", "signal": "#7CFF8A"}


def _positions(n: int, layout: str, W: float, H: float):
    top, bottom = H * 0.21, H * 0.66
    if layout == "row" and n <= 3:
        return [(W * (0.5 if n == 1 else 0.18 + 0.64 * k / (n - 1)), H * 0.40) for k in range(n)]
    if layout == "cycle":
        cx, cy, r = W * 0.5, H * 0.40, min(W * 0.32, H * 0.17)
        return [(cx + r * math.sin(2 * math.pi * k / n), cy - r * math.cos(2 * math.pi * k / n)) for k in range(n)]
    if layout == "grid":
        cols = 2
        rows = math.ceil(n / cols)
        return [(W * (0.29 + 0.42 * (k % cols)), top + (bottom - top) * ((k // cols) + 0.5) / rows) for k in range(n)]
    # column (default for 9:16), zig-zag slightly so arrows read as a path
    return [(W * (0.5 + (0.08 if k % 2 else -0.08) * (n > 2)), top + (bottom - top) * (k + 0.5) / n) for k in range(n)]


def content_diagram(ctx, canvas, prm: dict, tl: float, dur: float) -> None:
    W, H, u = ctx.W, ctx.H, ctx.u
    dark = prm.get("look", "dark") != "light"
    ink = "#FFFFFF" if dark else "#1B2430"
    nodes = prm.get("nodes") or []
    links = prm.get("links") or []
    n = max(1, len(nodes))
    pos = _positions(n, prm.get("layout", "column"), W, H)
    where = {nd.get("id", str(k)): (pos[k], nd) for k, nd in enumerate(nodes)}
    # title
    if prm.get("title"):
        p = ease_out_cubic(progress(tl, 0.0, 0.45))
        f = D.font("Montserrat-ExtraBold", 62 * u)
        lines = D.wrap(prm["title"].upper(), f, W * 0.72, 2)
        for j, ln in enumerate(lines):
            D.draw_text(canvas, ln, W / 2, H * 0.135 + j * 72 * u + (1 - p) * 30 * u, f, D.color(ink, p), align="center")
    card_w = W * (0.62 if prm.get("layout", "column") in ("column",) else 0.40)
    card_h = (170 if n <= 4 else 140) * u
    # links under the cards
    for k, lk in enumerate(links):
        a, b = where.get(lk.get("from")), where.get(lk.get("to"))
        if not a or not b:
            continue
        (x0, y0), (x1, y1) = a[0], b[0]
        at = float(lk.get("at", max(float(a[1].get("at", 0)), float(b[1].get("at", 0))) + 0.25))
        p = ease_out_cubic(progress(tl, at, 0.5))
        if p <= 0:
            continue
        col = LINK_COLORS.get(lk.get("kind", "current"), "#FFC83D")
        # shorten to the card edges
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        pad = min(card_h * 0.62 / max(abs(uy), 1e-3), card_w * 0.55 / max(abs(ux), 1e-3)) if prm.get("layout") != "cycle" else card_h * 0.55
        sx, sy = x0 + ux * pad, y0 + uy * pad
        ex, ey = x1 - ux * pad, y1 - uy * pad
        cx_, cy_ = sx + (ex - sx) * p, sy + (ey - sy) * p
        canvas.drawLine(sx, sy, cx_, cy_, D.stroke(D.color(col, 0.35), 14 * u))
        canvas.drawLine(sx, sy, cx_, cy_, D.stroke(D.color(col, 0.95), 5 * u))
        if p >= 1:
            # arrow head
            hx, hy = ex, ey
            s = 22 * u
            path = skia.Path()
            path.moveTo(hx, hy)
            path.lineTo(hx - ux * s - uy * s * 0.7, hy - uy * s + ux * s * 0.7)
            path.lineTo(hx - ux * s + uy * s * 0.7, hy - uy * s - ux * s * 0.7)
            path.close()
            canvas.drawPath(path, D.fill(D.color(col)))
            # moving dots
            seg = math.hypot(ex - sx, ey - sy)
            for j in range(max(2, int(seg / (70 * u)))):
                s_ = ((tl - at) * 0.9 + j / max(2, int(seg / (70 * u)))) % 1.0
                D.circle(canvas, sx + (ex - sx) * s_, sy + (ey - sy) * s_, 7 * u, D.fill(D.color("#FFFFFF" if lk.get("kind") == "current" else col, 0.95)))
        if lk.get("label"):
            fl = D.font("Inter-Bold", 34 * u)
            mx, my = (sx + ex) / 2, (sy + ey) / 2
            D.draw_text(canvas, lk["label"], mx + (-uy) * 40 * u, my + ux * 40 * u + 12 * u, fl, D.color(ink, clamp(p * 1.5)), align="center", shadow=3 * u)
    # cards
    for k, nd in enumerate(nodes):
        (x, y) = pos[k]
        at = float(nd.get("at", k * 0.45))
        p = ease_out_back(progress(tl, at, 0.45))
        if p <= 0:
            continue
        a = clamp(progress(tl, at, 0.15))
        canvas.save()
        canvas.translate(x, y + math.sin(tl * 1.3 + k) * 4 * u)
        canvas.scale(p, p)
        base = ctx.hexc(nd.get("color", "primary")) if nd.get("color", "primary") in ("primary", "accent", "alert", "dark") else nd.get("color", "#18A689")
        paint = D.fill(D.color("#FFFFFF" if not dark else "#1E2E40", 0.96 * a))
        D.rrect(canvas, -card_w / 2, -card_h / 2, card_w, card_h, 28 * u, D.shadow_paint(paint, 24 * u, 10 * u, 0.35) if hasattr(D, "shadow_paint") else paint)
        canvas.drawRect(skia.Rect.MakeXYWH(-card_w / 2, -card_h / 2 + 22 * u, 10 * u, card_h - 44 * u), D.fill(D.color(base, a)))
        ix = -card_w / 2 + 70 * u
        if nd.get("icon"):
            D.circle(canvas, ix, 0, 44 * u, D.fill(D.color(base, 0.18 * a)))
            try:
                D.draw_icon(canvas, nd["icon"], ix, 0, 52 * u, base, 2.4)
            except Exception:  # noqa: BLE001
                pass
            tx = ix + 66 * u
        else:
            tx = -card_w / 2 + 40 * u
        fl = D.font("Montserrat-ExtraBold", 48 * u)
        maxw = card_w / 2 - tx - 20 * u + card_w / 2
        lab = D.wrap(nd.get("label", ""), fl, maxw, 2)
        y0 = -8 * u if nd.get("sub") else 14 * u
        if len(lab) > 1:
            y0 -= 22 * u
        for j, ln in enumerate(lab):
            D.draw_text(canvas, ln, tx, y0 + j * 48 * u, fl, D.color(ink if dark else "#1B2430", a))
        if nd.get("sub"):
            fs = D.font("Inter-SemiBold", 32 * u)
            D.draw_text(canvas, nd["sub"], tx, y0 + len(lab) * 48 * u - 4 * u, fs, D.color("#AFC0D3" if dark else "#5B6B7B", a))
        canvas.restore()
