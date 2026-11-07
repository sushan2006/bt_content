"""Editing styles.

A style turns the same selected takes into a different kind of video. Built-in styles:

  explainer3d  "3D Explainer"        cuts between the speaker and full-screen 3D explainers, real 3D objects rise
                                      from behind him, kinetic captions, light sound design   (= the editorial cut)
  hype         "Bold & Fast"         jump cuts every ~2 s, punch-ins and zoom pulses on key words, big word-by-word
                                      captions with a coloured box, bold statement cards, louder beat
  cinematic    "Cinematic Story"     letterbox, teal-orange grade, film grain, slow push-ins, chapter title cards
                                      that dip to black, subtle sentence captions, ambient music
  minimal      "Clean & Minimal"     calm cuts on sentences only, soft-box captions, clean white number cards and a
                                      name card, almost no sound effects

A style learned from a reference video is a "profile": a base style plus measured numbers (cut rhythm, how much of
the video is full-screen graphics, light or dark graphics, grade, caption position and colour, sound-effect density,
music level). `apply_profile` applies those numbers on top of the base style.
"""
from __future__ import annotations

import math
import re

import numpy as np
import skia

from . import draw as D
from .motion import clamp, ease_in_out, ease_out_back, ease_out_cubic, lerp, progress

STYLES = {
    "explainer3d": {"name": "3D Explainer", "variant": "editorial",
                    "about": "Cuts between you and full-screen 3D explainers; 3D objects rise from behind you; kinetic captions; light sound design."},
    "hype": {"name": "Bold & Fast", "variant": "hype",
             "about": "Jump cuts every ~2 s, punch-ins and zoom pulses on key words, big boxed captions, bold statement cards, louder beat."},
    "cinematic": {"name": "Cinematic Story", "variant": "cinematic",
                  "about": "Letterbox, teal-orange film look with grain, slow push-ins, chapter cards that dip to black, subtle captions."},
    "minimal": {"name": "Clean & Minimal", "variant": "minimal",
                "about": "Calm cuts on sentences only, soft-box captions, clean white number cards and a name card, almost no effects."},
}


def C(h, a=1.0):
    return D.color(h, a)


# ================================================================ captions
_STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "this", "that", "for", "with", "as", "at", "by", "from", "so", "i", "i'm", "we", "you"}


def _key(w):
    return re.sub(r"[^\w.]", "", w.lower())


class BoxCaptions:
    """Hype captions: 1-3 words, uppercase, the spoken word sits on a coloured box and pops."""

    def __init__(self, style, W, H, colors):
        self.s, self.W, self.H, self.u = style, W, H, W / 1080.0
        self.box = colors.get("accent", "#F39C1A") if style.highlight.upper() == "#FFD60A" else style.highlight
        self.chunks = []

    def set_words(self, words, emphasis):
        from .captions import FILLERS
        ws = [w for w in words if _key(w["text"]) not in FILLERS and w["text"].strip()]
        out, cur = [], []
        for w in ws:
            if cur and (len(cur) >= 3 or w["start"] - cur[-1]["end"] > 0.3 or re.search(r"[.!?,]$", cur[-1]["text"])):
                out.append(cur)
                cur = []
            cur.append(w)
        if cur:
            out.append(cur)
        self.chunks = []
        for i, c in enumerate(out):
            nxt = out[i + 1][0]["start"] if i + 1 < len(out) else None
            end = c[-1]["end"] + 0.25
            if nxt is not None:
                end = min(end, nxt) if nxt - end > 0.25 else nxt
            self.chunks.append({"words": c, "start": c[0]["start"], "end": end})

    def draw(self, canvas, t, cy_frac, on_light=False):
        u = self.u
        ch = next((c for c in self.chunks if c["start"] - 0.02 <= t < c["end"]), None)
        if ch is None:
            return
        f = D.font("Montserrat-Black", self.W * 0.08)
        words = [re.sub(r"[,;:.!?]$", "", w["text"].strip()).upper() for w in ch["words"]]
        wd = [D.text_width(w, f) for w in words]
        sp = D.text_width(" ", f)
        total = sum(wd) + sp * (len(words) - 1)
        if total > self.W * 0.80:   # room for the stroke, the box and the pop
            f = D.font("Montserrat-Black", self.W * 0.08 * self.W * 0.80 / total)
            wd = [D.text_width(w, f) for w in words]
            sp = D.text_width(" ", f)
            total = sum(wd) + sp * (len(words) - 1)
        y = self.H * cy_frac
        x = self.W / 2 - total / 2
        active = max([k for k, w in enumerate(ch["words"]) if w["start"] - 0.03 <= t] or [0])
        m = f.getMetrics()
        cap = -m.fAscent * 0.74
        # the box goes behind everything, so it never covers the neighbouring words
        xs, xx = [], x
        for w in wd:
            xs.append(xx)
            xx += w + sp
        pa = progress(t, ch["words"][active]["start"] - 0.04, 0.1)
        if pa > 0:
            pad = 10 * u
            bw = wd[active] + 2 * pad
            k = lerp(0.85, 1.0, ease_out_back(pa, 2.0))
            cxb = xs[active] + wd[active] / 2
            D.rrect(canvas, cxb - bw * k / 2, y - cap - pad, bw * k, cap + 2 * pad, 12 * u, D.fill(C(self.box)))
        for k, (txt, w) in enumerate(zip(words, wd)):
            p = progress(t, ch["words"][k]["start"] - 0.04, 0.1)
            if p <= 0:
                x += w + sp
                continue
            sc = lerp(0.6, 1.0, ease_out_back(p, 2.2))
            cx = x + w / 2
            canvas.save()
            canvas.translate(cx, y - cap / 2)
            canvas.scale(sc, sc)
            canvas.translate(-cx, -(y - cap / 2))
            blob = skia.TextBlob.MakeFromString(txt, f)
            canvas.drawTextBlob(blob, x, y, D.stroke(C("#000000", 0.95), f.getSize() * 0.16))
            D.draw_text(canvas, txt, x, y, f, C("#FFFFFF"), shadow=6 * u)
            canvas.restore()
            x += w + sp


class SubtleCaptions:
    """Cinematic / minimal captions: one short sentence-case line, fades, optional soft box."""

    def __init__(self, style, W, H, boxed=False):
        self.s, self.W, self.H, self.u, self.boxed = style, W, H, W / 1080.0, boxed
        self.chunks = []

    def set_words(self, words, emphasis):
        from .captions import FILLERS
        ws = [w for w in words if _key(w["text"]) not in FILLERS and w["text"].strip()]
        out, cur = [], []
        f = D.font("Inter-SemiBold", self.W * 0.046)
        for w in ws:
            line = " ".join(x["text"] for x in cur + [w])
            if cur and (D.text_width(line, f) > self.W * 0.78 or w["start"] - cur[-1]["end"] > 0.45 or re.search(r"[.!?]$", cur[-1]["text"])):
                out.append(cur)
                cur = []
            cur.append(w)
        if cur:
            out.append(cur)
        self.chunks = []
        for i, c in enumerate(out):
            nxt = out[i + 1][0]["start"] if i + 1 < len(out) else None
            end = c[-1]["end"] + 0.4
            if nxt is not None:
                end = min(end, nxt) if nxt - end > 0.3 else nxt
            self.chunks.append({"words": c, "start": c[0]["start"], "end": end})

    def draw(self, canvas, t, cy_frac, on_light=False):
        u = self.u
        ch = next((c for c in self.chunks if c["start"] - 0.05 <= t < c["end"]), None)
        if ch is None:
            return
        f = D.font("Inter-SemiBold", self.W * 0.046)
        txt = " ".join(w["text"].strip() for w in ch["words"])
        txt = txt[0].upper() + txt[1:] if txt else txt
        a = clamp((t - ch["start"] + 0.05) / 0.18) * clamp((ch["end"] - t) / 0.15)
        tw = D.text_width(txt, f)
        y = self.H * cy_frac
        if self.boxed:
            pad = 22 * u
            D.rrect(canvas, self.W / 2 - tw / 2 - pad, y - 46 * u, tw + 2 * pad, 66 * u, 18 * u, D.fill(C("#0B0F14", 0.55 * a)))
        else:
            sp = D.fill(C("#000000", 0.6 * a))
            sp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 10 * u))
            canvas.drawTextBlob(skia.TextBlob.MakeFromString(txt, f), self.W / 2 - tw / 2, y + 2 * u, sp)
        # the word being spoken is fully white, the rest slightly dimmer
        x = self.W / 2 - tw / 2
        spw = D.text_width(" ", f)
        for k, w in enumerate(ch["words"]):
            s = w["text"].strip()
            if k == 0:
                s = s[0].upper() + s[1:]
            said = w["start"] - 0.03 <= t
            D.draw_text(canvas, s, x, y, f, C("#FFFFFF" if said else "#D9DEE5", a * (1.0 if said else 0.72)))
            x += D.text_width(s, f) + spw


def make_captions(style, W, H, colors):
    if style.mode == "box":
        return BoxCaptions(style, W, H, colors)
    if style.mode in ("subtle", "soft"):
        return SubtleCaptions(style, W, H, boxed=style.mode == "soft")
    return None


# ================================================================ full-screen cards
def content_statement(ctx, canvas, prm, tl, dur):
    """Hype statement card: black, huge white words, one in the brand colour, slams in."""
    W, H, u = ctx.W, ctx.H, ctx.u
    canvas.drawRect(skia.Rect.MakeWH(W, H), D.fill(C("#07090C")))
    lines = prm.get("lines") or [prm.get("text", "")]
    hl = [h.lower() for h in prm.get("highlight", [])]
    sizes = [300 if i == 0 and len(ln) <= 8 else 130 for i, ln in enumerate(lines)]
    y = H * 0.40 - (len(lines) - 1) * 90 * u
    for i, ln in enumerate(lines):
        f = D.font("Montserrat-Black", sizes[i] * u)
        p = progress(tl, 0.06 * i, 0.22)
        if p <= 0:
            continue
        ff = f
        w = D.text_width(ln.upper(), ff)
        if w > W * 0.88:
            ff = D.font("Montserrat-Black", sizes[i] * u * W * 0.88 / w)
            w = D.text_width(ln.upper(), ff)
        sc = lerp(1.6, 1.0, ease_out_cubic(p))
        canvas.save()
        canvas.translate(W / 2, y)
        canvas.scale(sc, sc)
        col = ctx.hexc("accent") if ln.lower() in hl else "#FFFFFF"
        D.draw_text(canvas, ln.upper(), 0, 0, ff, C(col, clamp(p * 2)), align="center")
        canvas.restore()
        y += (sizes[i] * 0.55 + 90) * u


def content_chapter(ctx, canvas, prm, tl, dur):
    """Cinematic chapter card: dip to black, letter-spaced small title, thin rule, fades out."""
    W, H, u = ctx.W, ctx.H, ctx.u
    a = clamp(tl / 0.35) * clamp((dur - tl) / 0.35)
    canvas.drawRect(skia.Rect.MakeWH(W, H), D.fill(C("#000000", a)))
    num = prm.get("number", "")
    title = prm.get("title", "")
    fk = D.font("Inter-Medium", 30 * u)
    ft = D.font("Montserrat-Bold", 74 * u)
    k = clamp((tl - 0.25) / 0.6)
    if num:
        D.draw_text(canvas, " ".join(num.upper()), W / 2, H * 0.43, fk, C(ctx.hexc("accent"), a * k), align="center")
    rule = 160 * u * ease_out_cubic(k)
    canvas.drawRect(skia.Rect.MakeXYWH(W / 2 - rule / 2, H * 0.455, rule, 2.5 * u), D.fill(C("#FFFFFF", 0.6 * a)))
    D.draw_text(canvas, title, W / 2, H * 0.52 + (1 - k) * 18 * u, ft, C("#FFFFFF", a * k), align="center")


# ================================================================ picture effects
_GRAIN: dict = {}


def post(ctx, canvas, t, edit):
    """Effects drawn over the finished frame: film grain and letterbox."""
    W, H = ctx.W, ctx.H
    g = float(edit.get("grain", 0) or 0)
    if g > 0:
        key = (W // 2, H // 2)
        if key not in _GRAIN:
            rng = np.random.default_rng(5)
            tiles = []
            for _ in range(6):
                n = rng.normal(128, 40, (H // 2, W // 2)).clip(0, 255).astype(np.uint8)
                rgba = np.dstack([n, n, n, np.full_like(n, 255)])
                tiles.append(skia.Image.fromarray(np.ascontiguousarray(rgba), colorType=skia.kRGBA_8888_ColorType))
            _GRAIN[key] = tiles
        img = _GRAIN[key][int(t * 24) % 6]
        canvas.drawImageRect(img, skia.Rect.MakeWH(W, H), skia.SamplingOptions(), skia.Paint(BlendMode=skia.BlendMode.kOverlay, Alphaf=g))
    lb = float(edit.get("letterbox", 0) or 0)
    if lb > 0 and t < edit.get("letterbox_until", 1e9):
        bar = H * lb
        canvas.drawRect(skia.Rect.MakeWH(W, bar), D.fill(C("#000000")))
        canvas.drawRect(skia.Rect.MakeXYWH(0, H - bar, W, bar), D.fill(C("#000000")))


def motion_extra(edit, t):
    """Zoom pulses (hype), slow push (cinematic) and camera shake. Returns (zoom factor, dx px, dy px)."""
    z, dx, dy = 1.0, 0.0, 0.0
    push = float(edit.get("push", 0) or 0)
    if push:
        t0 = 0.0
        for p in edit.get("punches") or []:
            if p["t"] <= t:
                t0 = p["t"]
        z *= 1 + push * min(t - t0, 8.0)
    for p in edit.get("pulses") or []:
        d = t - p["t"]
        if 0 <= d < 0.45:
            z *= 1 + p.get("amp", 0.07) * math.sin(math.pi * min(1.0, d / 0.45)) ** 0.7
    for s in edit.get("shakes") or []:
        d = t - s["t"]
        if 0 <= d < s.get("dur", 0.25):
            k = (1 - d / s.get("dur", 0.25)) * s.get("amp", 14)
            dx += k * math.sin(d * 91)
            dy += k * math.cos(d * 73)
    return z, dx, dy


# ================================================================ planning
def _out_words(plan):
    return plan.output_words()


def _at(words, word, n=1):
    k = 0
    for w in words:
        if word.lower() == _key(w["text"]).strip("."):
            k += 1
            if k == n:
                return w["start"]
    return None


def _sentence_starts(plan):
    offs = plan.clip_offsets()
    out = [0.0]
    for i in range(1, len(plan.clips)):
        prev = plan.clips[i - 1]
        last = (prev.words[-1].text if prev.words else "").strip()
        if last.endswith((".", "?", "!")) or prev.line != plan.clips[i].line:
            out.append(round(offs[i], 3))
    return out


def _numbers(plan):
    """Spoken numbers: [(t, text)], e.g. (46.6, '0.5–1.5'), (50.2, '20')."""
    W = _out_words(plan)
    out = []
    for i, w in enumerate(W):
        if re.fullmatch(r"\d+(\.\d+)?", _key(w["text"]).strip(".")) and float(_key(w["text"]).strip(".")) not in (1, 2, 3):
            txt = _key(w["text"]).strip(".")
            if i + 2 < len(W) and _key(W[i + 1]["text"]) == "to" and re.fullmatch(r"\d+(\.\d+)?", _key(W[i + 2]["text"]).strip(".")):
                txt = f"{txt}–{_key(W[i + 2]['text']).strip('.')}"
            unit = ""
            for k in range(i + 1, min(len(W), i + 5)):
                u_ = _key(W[k]["text"]).strip(".")
                if u_ in ("horsepower", "hp", "meters", "metres", "percent", "kw", "volts", "litres", "liters", "minutes", "hours", "days", "times"):
                    unit = u_
                    break
            if out and w["start"] - out[-1][0] < 1.5:
                continue
            out.append((w["start"], txt, unit))
    return out


def _keywords(plan, brief, n=12):
    words = _out_words(plan)
    freq = {}
    for w in words:
        k = _key(w["text"]).strip(".")
        if len(k) > 5 and k not in _STOP and not k.isdigit():
            freq[k] = freq.get(k, 0) + 1
    picked = [k for k in (brief.get("keywords") or []) if k]
    picked += [k for k, _ in sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0])))]
    return list(dict.fromkeys(picked))[:n]


def _objects(plan, brief=None):
    """3D objects over the speaker: kept from the plan, or made from its illustrations (rising from behind him)."""
    from .schema import Graphic
    out, d = [], 1
    for g in plan.graphics:
        if g.type == "model3d":
            out.append(g)
        elif g.type == "illustration":
            m = {"pump_set": "pump_set", "stator_rotor": "stator_rotor", "impeller": "impeller", "energy_flow": "energy"}.get(g.params.get("scene", ""))
            if m:
                d = -d
                out.append(Graphic(type="model3d", start=g.start - 0.3, end=g.end, params={**g.params, "model": m, "dir": d, "enter": "rise"}, reason="3D object rises from behind the speaker"))
    if not out:
        from .editorial import auto_scenes
        for g in auto_scenes(plan, (brief.get("_machines") or brief.get("_machine")) if isinstance(brief, dict) else None):
            if g.type == "model3d":
                out.append(g)
            elif g.params.get("stage") in ("motor_inside", "pump_inside", "pump_flow", "energy"):
                d = -d
                m = {"motor_inside": "stator_rotor", "pump_inside": "impeller", "pump_flow": "impeller", "energy": "energy"}[g.params["stage"]]
                out.append(Graphic(type="model3d", start=g.start - 0.3, end=min(g.end, g.start + 4.5), params={**g.params, "kind": None, "model": m, "dir": d, "enter": "rise"},
                                   reason="3D object rises from behind the speaker"))
    return out


def build_hype(plan, brief):
    from .schema import Graphic
    speech = plan.speech_duration
    G = [g for g in plan.graphics if g.type in ("logo_bug", "text_behind")] + _objects(plan, brief)
    G.append(Graphic(type="progress_bar", start=0.0, end=speech, reason="shows viewers how much is left"))
    # statement cards on the strongest lines (numbers)
    objs = _objects(plan, brief)
    for (t0, txt, unit) in _numbers(plan)[:3]:
        if any(g.start - 0.2 <= t0 < g.end for g in objs):
            continue
        lines = [txt] + ([unit] if unit else [])
        G.append(Graphic(type="fullscreen", start=max(0.0, t0 - 0.1), end=min(speech, t0 + 1.6), params={"kind": "statement", "lines": lines, "highlight": [txt], "enter": "cut", "cap_y": 0.74}, reason="bold statement card"))
    hook = brief.get("headline") or ""
    if hook:
        hw = [w for w in re.findall(r"[\w'-]+", hook)]
        half = (len(hw) + 1) // 2
        G.append(Graphic(type="fullscreen", start=0.0, end=min(1.2, speech), params={"kind": "statement", "lines": [" ".join(hw[:half]), " ".join(hw[half:])] if len(hw) > 3 else [hook],
                                                                                     "highlight": [], "enter": "cut", "cap_y": 0.74}, reason="hook card"))
    G += [g for g in plan.graphics if g.type == "end_card"]
    plan.graphics = sorted(G, key=lambda g: g.start)
    hype_finish(plan, brief)


def hype_finish(plan, brief):
    """Bold & Fast cutting, pulses, shakes, sound and captions for a plan whose graphics are set."""
    speech = plan.speech_duration
    words = _out_words(plan)
    keys = set(_keywords(plan, brief, 14)) | {k.lower() for k in (plan.captions.emphasis or [])}
    fulls = [(g.start, g.end) for g in plan.graphics if g.type == "fullscreen"]
    # jump cuts: framing changes every ~2 s on word boundaries
    punches, t, k = [], 0.0, 0
    zooms = [1.0, 1.22, 1.1, 1.3]
    starts = [w["start"] for w in words]
    while t < speech - 0.8:
        if not any(a - 1e-3 <= t < b - 1e-3 for a, b in fulls) or t == 0.0:
            punches.append({"t": round(t, 3), "zoom": zooms[k % 4], "cap_y": 0.70})
            k += 1
        nxt = [s for s in starts if s >= t + 1.8]
        if not nxt:
            break
        t = nxt[0]
    pulses, shakes = [], []
    for w in words:
        kk = _key(w["text"]).strip(".")
        if kk in keys and (not pulses or w["start"] - pulses[-1]["t"] > 1.6) and not any(a <= w["start"] < b for a, b in fulls):
            pulses.append({"t": w["start"], "amp": 0.08})
            shakes.append({"t": w["start"], "dur": 0.22, "amp": 10})
    sfx = []
    for p in punches[1:]:
        sfx.append({"t": p["t"], "kind": "swish", "gain_db": -10})
    for p in pulses:
        sfx.append({"t": p["t"], "kind": "pop", "gain_db": -9})
    for g in plan.graphics:
        if g.type == "fullscreen":
            sfx.append({"t": g.start, "kind": "thump", "gain_db": -6})
        elif g.type in ("model3d", "pop3d"):
            sfx.append({"t": g.start, "kind": "air", "gain_db": -4})
    plan.captions.mode = "box"
    plan.captions.position = 0.70
    plan.edit = {"style": "hype", "grade": "punchy", "punches": punches, "pulses": pulses, "shakes": shakes, "sfx": sorted(sfx, key=lambda e: e["t"]), "sfx_db": -12.0,
                 "music_bed": {"bpm": 118, "volume_db": -19.0, "duck_db": 7.0}}
    if plan.music is not None:
        plan.music.volume_db = -16.0
    for c in plan.clips:
        c.zoom_start = c.zoom_end = 1.0


def build_cinematic(plan, brief):
    from .schema import Graphic
    from .editorial import convert
    speech = plan.speech_duration
    # keep the 3D explainers but slow everything down; add chapter cards at the big topic changes
    convert(plan, brief)
    G = [g for g in plan.graphics if g.type not in ("text_behind",)]
    for g in G:
        if g.type == "fullscreen" and g.params.get("kind") == "stage":
            g.params["cap_y"] = 0.84
    starts = _sentence_starts(plan)
    chapters = []
    titles = brief.get("chapters") or []
    # a chapter card before roughly every third of the video, on a sentence start, never over a 3D screen
    for i, frac in enumerate((0.0, 0.36, 0.68)):
        target = speech * frac
        cand = [s for s in starts if s >= target and not any(g.start - 0.2 <= s < g.end for g in G if g.type in ("fullscreen", "model3d"))]
        if not cand:
            continue
        s = cand[0] if frac else 0.0
        if any(abs(c.start - s) < 3.0 for c in chapters):
            continue
        title = titles[i] if i < len(titles) else ["The machine", "How it works", "The numbers"][i]
        chapters.append(Graphic(type="fullscreen", start=s, end=min(speech, s + 1.1), params={"kind": "chapter", "number": f"Part {i + 1}", "title": title, "enter": "cut", "cap_y": 0.86}, reason="chapter card"))
    plan.graphics = sorted(G + chapters, key=lambda g: g.start)
    cinematic_finish(plan, brief)


def cinematic_finish(plan, brief):
    """Cinematic Story look, cutting and sound for a plan whose graphics are set."""
    from .editorial import finish
    chapters = [g for g in plan.graphics if g.type == "fullscreen" and g.params.get("kind") == "chapter"]
    finish(plan, grade="teal_orange")
    plan.captions.mode = "subtle"
    plan.captions.position = 0.84
    e = plan.edit
    e.update({"style": "cinematic", "letterbox": 0.075, "grain": 0.10, "push": 0.010, "sfx_db": -18.0})
    e["punches"] = [dict(p, zoom=1.0 if p["zoom"] == 1.0 else 1.12, cap_y=0.84) for p in e["punches"]]
    e["sfx"] = [s for s in e["sfx"] if s["kind"] in ("air", "thump")] + [{"t": c.start, "kind": "thump", "gain_db": -6} for c in chapters]
    e["sfx"].sort(key=lambda x: x["t"])
    if plan.music is None:
        e["music_bed"] = {"bpm": 72, "volume_db": -20.0, "duck_db": 9.0}


def build_minimal(plan, brief):
    from .schema import Graphic
    speech = plan.speech_duration
    G = _objects(plan, brief)
    sp = (brief.get("speaker_name") or "").strip()
    if sp:
        G.append(Graphic(type="lower_third", start=0.6, end=min(speech, 3.8), params={"name": sp, "role": brief.get("speaker_role", "")}, reason="who is speaking"))
    for (t0, txt, unit) in _numbers(plan)[:3]:
        if any(g.start - 0.2 <= t0 < g.end for g in G if g.type == "model3d"):
            continue
        G.append(Graphic(type="fullscreen", start=max(0.0, t0 - 0.15), end=min(speech, t0 + 2.2),
                         params={"kind": "big_text", "text": txt, "sub": unit, "size": 300, "width": 0.7, "y": 0.38, "look": "light", "enter": "cut", "cap_y": 0.72, "color": "dark"},
                         reason="clean number card"))
    G += [g for g in plan.graphics if g.type == "end_card"]
    plan.graphics = sorted(G, key=lambda g: g.start)
    minimal_finish(plan, brief)


def minimal_finish(plan, brief):
    """Clean & Minimal cutting and sound for a plan whose graphics are set."""
    speech = plan.speech_duration
    starts = _sentence_starts(plan)
    fulls = [(g.start, g.end) for g in plan.graphics if g.type == "fullscreen"]
    punches, last = [], -10.0
    for s_ in starts:
        if s_ - last < 3.0 or (s_ > 0 and any(a - 1e-3 <= s_ < b - 1e-3 for a, b in fulls)):
            continue
        punches.append({"t": s_, "zoom": 1.0 if len(punches) % 2 else 1.1, "cap_y": 0.82})
        last = s_
    G = plan.graphics
    plan.captions.mode = "soft"
    plan.captions.position = 0.82
    plan.edit = {"style": "minimal", "grade": "clean", "punches": punches, "sfx": [{"t": g.start, "kind": "tap", "gain_db": -10} for g in G if g.type == "fullscreen"],
                 "sfx_db": -16.0, "music_bed": {"bpm": 84, "volume_db": -25.0, "duck_db": 8.0}}
    for c in plan.clips:
        c.zoom_start = c.zoom_end = 1.0


BUILDERS = {"hype": build_hype, "cinematic": build_cinematic, "minimal": build_minimal}


def apply_profile(plan, profile: dict, brief: dict):
    """Style learned from a reference video: base style + the measured numbers."""
    base = profile.get("base", "explainer3d")
    if base == "explainer3d":
        from .editorial import convert
        convert(plan, brief)
    else:
        BUILDERS[base](plan, brief)
    apply_profile_params(plan, profile)


FINISHERS = {"hype": hype_finish, "cinematic": cinematic_finish, "minimal": minimal_finish}


def finish_for(style: str, plan, brief, profile: dict | None = None):
    """Style finishing (cutting rhythm, captions, grade, sound) for a plan whose graphics were planned elsewhere."""
    base = (profile or {}).get("base", "explainer3d") if style == "profile" else style
    if style == "profile" and profile:
        apply_profile_transitions(plan, profile)
    if base in ("editorial", "explainer3d"):
        from .editorial import finish
        finish(plan)
    else:
        FINISHERS[base](plan, brief)
    if style == "profile" and profile:
        apply_profile_params(plan, profile)
        plan.variant = "profile"
    elif base in FINISHERS:
        plan.variant = base


def apply_profile_transitions(plan, profile: dict):
    """The reference video's way into and out of full-screen graphics (cut / whip / fade / zoom) becomes the default
    for every full-screen moment whose transition Claude did not choose itself."""
    from .editorial import TRANSITIONS
    p = profile.get("params", {})
    t_in, t_out = p.get("transition_in"), p.get("transition_out")
    for g in plan.graphics:
        if g.type != "fullscreen" or g.params.get("transition_by") == "director" or g.params.get("kind") in ("cta", "end_card"):
            continue
        if t_in in TRANSITIONS:
            g.params["enter"] = t_in
        if t_out in TRANSITIONS:
            g.params["exit"] = t_out


def apply_profile_params(plan, profile: dict):
    e = plan.edit
    p = profile.get("params", {})
    if p.get("cut_every"):
        # thin or thicken the framing changes to match the reference rhythm
        target = float(p["cut_every"])
        kept, last = [], -10.0
        for x in e.get("punches", []):
            if x["t"] - last >= target * 0.8 or x["t"] == 0:
                kept.append(x)
                last = x["t"]
        e["punches"] = kept
    if p.get("grade"):
        e["grade"] = p["grade"]
    if p.get("letterbox") is not None:
        e["letterbox"] = p["letterbox"]
    if p.get("grain") is not None:
        e["grain"] = p["grain"]
    if p.get("sfx_db") is not None:
        e["sfx_db"] = p["sfx_db"]
    if p.get("music_db") is not None and "music_bed" in e:
        e["music_bed"]["volume_db"] = p["music_db"]
    cap = p.get("captions", {})
    if cap.get("mode"):
        plan.captions.mode = cap["mode"]
    if cap.get("position"):
        plan.captions.position = cap["position"]
        e["punches"] = [dict(x, cap_y=cap["position"]) for x in e.get("punches", [])]
    if cap.get("highlight"):
        plan.captions.highlight = cap["highlight"]
    e["style"] = f"profile:{profile.get('name', 'custom')}"


def add_machine(plan, machine: dict, brief: dict, require_mention: bool = False):
    """Puts the user's own machine in the video: it rises from behind the speaker when it is first talked about
    (its name or keywords), otherwise a quarter of the way in, wherever nothing else is on screen."""
    from .schema import Graphic
    if not machine or not (machine.get("mesh") or machine.get("kit")):
        return
    speech = plan.speech_duration
    busy = [(g.start - 0.3, g.end + 0.3) for g in plan.graphics if g.type in ("fullscreen", "model3d", "text_behind", "lower_third")]
    free = lambda a, b: all(b <= x or a >= y for x, y in busy)
    words = plan.output_words()
    keys = [k.lower() for k in ([machine.get("name", "")] + list(machine.get("keywords") or [])) if k]
    mentions = []
    for w in words:
        k = _key(w["text"]).strip(".")
        if any(k and (k in kk.split() or kk.startswith(k)) for kk in keys) and len(k) > 2:
            mentions.append(w["start"] - 0.4)
    if any(g.params.get("machine") is machine for g in plan.graphics if g.type in ("model3d", "fullscreen")):
        return   # already on screen (e.g. a full-screen turn-table of it)
    prm = {"model": "machine", "enter": "rise", "dir": 1, "machine": machine, "name": machine.get("name", ""), "sub": machine.get("tagline", ""), "label_at": 1.0}
    reason = f"your machine '{machine.get('name', '')}' in 3D"
    dur = 3.6

    def place(t0):
        plan.graphics.append(Graphic(type="model3d", start=t0, end=t0 + dur, params=dict(prm), reason=reason))
        plan.graphics.sort(key=lambda g: g.start)
        if plan.edit.get("sfx") is not None:
            plan.edit["sfx"] += [{"t": t0, "kind": "air", "gain_db": -4}, {"t": t0 + 0.62, "kind": "tap", "gain_db": -9}]
            plan.edit["sfx"].sort(key=lambda e: e["t"])

    # 1. a free moment when it is named
    for t0 in mentions:
        if t0 > 0.5 and t0 + dur < speech and free(t0, t0 + dur):
            return place(t0)
    # 2. it is named while a generic built-in object is on screen (a stock pump while "our pump" is said): the company's own machine replaces it
    for t0 in mentions:
        for g in plan.graphics:
            if g.type == "model3d" and g.params.get("model") not in ("machine", "text", None) and g.start - 0.8 <= t0 <= g.end:
                g.params = {**prm, "enter": g.params.get("enter", "rise"), "dir": g.params.get("dir", 1)}
                g.reason = reason + " (instead of a generic model)"
                return
    # 3. the main machine still appears once, a quarter of the way in, if it is never named
    if not require_mention:
        for t0 in [s for s in _sentence_starts(plan) if s > speech * 0.2]:
            if t0 > 0.5 and t0 + dur < speech and free(t0, t0 + dur):
                return place(t0)
