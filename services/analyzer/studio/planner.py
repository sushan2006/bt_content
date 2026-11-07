"""Edit planner: chosen takes + brief + brand + rules + suggestions -> one validated Plan per version.

Priority when instructions conflict: suggestions/change requests > brief > engine rules > house style.
"""
from __future__ import annotations

import copy
import re

from . import takes as T
from .schema import Brand, CaptionStyle, Clip, Format, Graphic, Music, Plan, RuleUse

STOP = set("""a an the and or but so to of in on at by for with from as is are was were be been being it its it's this that these those
we our us you your they their them i me my he she his her him do does did done have has had will would can could should may might
just very really also then than there here what which who whom how when where why all any some more most much many each every
not no yes if into out up down over under about again further once only own same too s t don't can't won't let's get got""".split())

ICON_WORDS = {
    "sensor": "radio", "sensors": "radio", "wireless": "wifi", "wifi": "wifi", "data": "database", "database": "database", "cloud": "cloud",
    "secure": "shield", "security": "shield", "safe": "shield", "safety": "shield", "chip": "cpu", "device": "cpu", "devices": "cpu", "hardware": "cpu",
    "save": "piggy-bank", "saving": "piggy-bank", "savings": "piggy-bank", "cost": "indian-rupee", "costs": "indian-rupee", "money": "indian-rupee", "price": "indian-rupee",
    "time": "clock", "second": "clock", "seconds": "clock", "minutes": "clock", "hours": "clock", "downtime": "clock", "fast": "zap", "faster": "zap", "instant": "zap", "energy": "zap", "power": "zap", "electricity": "zap",
    "growth": "trending-up", "grow": "trending-up", "increase": "trending-up", "ai": "sparkles", "smart": "brain", "intelligent": "brain", "learn": "brain",
    "team": "users", "teams": "users", "people": "users", "customers": "users", "customer": "handshake", "client": "handshake", "clients": "handshake",
    "app": "smartphone", "phone": "smartphone", "mobile": "smartphone", "factory": "factory", "factories": "factory", "plant": "factory", "machine": "settings", "machines": "settings",
    "water": "droplets", "chart": "chart-column", "report": "chart-column", "reports": "chart-column", "dashboard": "gauge", "monitor": "activity", "monitoring": "activity",
    "track": "map-pin", "tracking": "map-pin", "location": "map-pin", "idea": "lightbulb", "ideas": "lightbulb", "alert": "bell", "alerts": "bell", "warn": "bell", "warns": "bell", "notify": "bell",
    "battery": "battery-charging", "temperature": "thermometer", "heat": "flame", "green": "leaf", "eco": "leaf", "sustainable": "leaf", "recycle": "recycle",
    "network": "network", "connected": "link", "connect": "link", "server": "server", "delivery": "truck", "logistics": "truck", "package": "package", "products": "package",
    "goal": "target", "target": "target", "launch": "rocket", "fix": "wrench", "repair": "wrench", "maintenance": "wrench", "search": "search", "see": "eye", "watch": "eye", "action": "play",
    "lock": "lock", "award": "award", "best": "award", "quality": "award", "global": "globe", "world": "globe", "calendar": "calendar", "schedule": "calendar", "message": "message-circle", "chat": "message-circle",
    "solar": "sun", "sun": "sun", "check": "circle-check", "problems": "x", "problem": "x", "breaks": "wrench", "late": "clock",
}
STEP_MARKERS = re.compile(r"^(first(ly)?|second(ly)?|third(ly)?|then|next|after that|finally|lastly|step\s+\w+)\b[,:]?\s*", re.I)
NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twenty": 20, "thirty": 30,
             "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100}
CTA_TEXT = {"follow": "Follow for more", "comment": "Comment your questions", "save": "Save this for later", "share": "Share with your team",
            "subscribe": "Subscribe for more", "dm": "Send us a message", "contact": "Get in touch with us"}


def _w(s: str) -> str:
    return re.sub(r"[^\w%₹$']", "", s.lower())


def _content_words(text: str) -> list[str]:
    return [w for w in re.findall(r"[\w%₹$'-]+", text) if _w(w) not in STOP and len(_w(w)) > 1]


# ---------------------------------------------------------------- inputs -> clips
def build_clips(takes: list[dict], selection: dict, variant: str, overrides: list[dict], rules: dict, fps: int = 30) -> tuple[list[Clip], list[dict]]:
    by_id = {t["take_id"]: t for t in takes}
    lines = [dict(l) for l in selection["lines"]]
    # change requests that act on lines
    for o in overrides:
        if o["op"] == "use_take":
            idx = o["line"] - 1 if o["line"] > 0 else len(lines) - 1
            if 0 <= idx < len(lines):
                cand = next((c for c in lines[idx]["candidates"] if c["take_id"].lower() == str(o["take"]).lower()), None)
                if cand:
                    lines[idx].update(take_id=cand["take_id"], sent=cand["sent"], reason=f"take {cand['take_id']} requested")
    removed = set()
    for o in overrides:
        if o["op"] == "remove_line":
            idx = o["index"] - 1 if o["index"] > 0 else len(lines) - 1
            removed.add(idx)
        if o["op"] == "remove_line_text":
            target = [_w(x) for x in str(o["text"]).split() if _w(x)]
            best, bi = 0.0, None
            for i, l in enumerate(lines):
                words = [_w(x) for x in l["text"].split()]
                hit = sum(1 for x in target if x in words) / max(1, len(target))
                if "".join(target) and "".join(target) in "".join(words):
                    hit = 1.0
                if hit > best:
                    best, bi = hit, i
            if bi is not None and best >= 0.6:
                removed.add(bi)
    lines = [l for i, l in enumerate(lines) if i not in removed]
    # target length: drop the weakest middle lines until it fits
    target = next((o["seconds"] for o in reversed(overrides) if o["op"] == "target_length"), rules.get("target_seconds"))
    max_pause = 0.30 if "cut_silences" in rules or any(o["op"] == "pace" and o["value"] == "faster" for o in overrides) else 0.45
    clips_by_line = []
    for l in lines:
        tk = by_id[l["take_id"]]
        cl = T.tighten(tk, l["sent"], max_pause=max_pause)
        for c in cl:
            c["line"] = l["index"]
            c["reason"] = f"Line {l['index'] + 1} from take {l['take_id']}: {l['reason']}"
            c["focus"] = tk.get("focus", {"x": 0.5, "y": 0.42})
        clips_by_line.append((l, cl))
    total = sum(c["t_out"] - c["t_in"] for _, cl in clips_by_line for c in cl)
    if target is not None:
        tgt = total * abs(target) if target < 0 else float(target) - (2.6 if variant != "clean" else 0)
        order = sorted(range(1, max(1, len(clips_by_line) - 1)), key=lambda i: clips_by_line[i][0].get("score", 0))
        drop = set()
        for i in order:
            if total <= tgt:
                break
            drop.add(i)
            total -= sum(c["t_out"] - c["t_in"] for c in clips_by_line[i][1])
        clips_by_line = [x for i, x in enumerate(clips_by_line) if i not in drop]
    # zoom: alternate a punch-in at every jump cut; motion adds a slow push-in
    pace = next((o["value"] for o in reversed(overrides) if o["op"] == "pace"), "faster" if "fast_pace" in rules else None)
    punch = {"clean": 1.12, "branded": 1.12, "motion": 1.15, "overlay": 1.12, "editorial": 1.0}[variant]
    if pace == "slower" or "fewer_cuts" in rules:
        punch = 1.0
    out: list[Clip] = []
    zoom = 1.0
    prev = None
    flat = [c for _, cl in clips_by_line for c in cl]
    # optional pattern interrupt: split long clips so the shot changes at least every ~4 s
    if pace == "faster":
        split = []
        for c in flat:
            ws = c["words"]
            if c["t_out"] - c["t_in"] > 4.2 and len(ws) >= 6:
                mid = len(ws) // 2
                cut = (ws[mid - 1]["end"] + ws[mid]["start"]) / 2
                a = dict(c, t_out=round(cut, 3), words=ws[:mid])
                b = dict(c, t_in=round(cut, 3), words=ws[mid:])
                b["_forced_cut"] = True
                split += [a, b]
            else:
                split.append(c)
        flat = split
    for c in flat:
        jump = prev is not None and (c["take_id"] != prev["take_id"] or abs(c["t_in"] - prev["t_out"]) > 0.05 or c.get("_forced_cut"))
        if jump and punch > 1.0:
            zoom = punch if zoom == 1.0 else 1.0
        z_end = zoom
        if variant in ("motion", "overlay", "editorial") and pace != "slower":
            z_end = min(1.6, zoom + 0.012 * (c["t_out"] - c["t_in"]))
        out.append(Clip(take_id=c["take_id"], src=c["src"], t_in=c["t_in"], t_out=c["t_out"], zoom_start=zoom, zoom_end=z_end,
                        focus_x=c["focus"]["x"], focus_y=c["focus"]["y"], words=c["words"], line=c["line"], reason=c["reason"]))
        prev = c
    return out, [l for l, _ in clips_by_line]


# ---------------------------------------------------------------- text helpers
def _sentences_out(plan: Plan) -> list[dict]:
    """Spoken sentences in output time (one per selected line)."""
    by_line: dict[int, dict] = {}
    for w in plan.output_words():
        d = by_line.setdefault(w["line"], {"line": w["line"], "start": w["start"], "end": w["end"], "words": []})
        d["end"] = w["end"]
        d["words"].append(w)
    out = sorted(by_line.values(), key=lambda d: d["start"])
    for d in out:
        d["text"] = " ".join(x["text"] for x in d["words"])
    return out


def _find_number(text: str):
    r = re.search(r"(\d+(?:\.\d+)?)\s?(?:to|-|–)\s?(\d+(?:\.\d+)?)", text)
    if r:
        return {"value": float(r.group(1)), "to": float(r.group(2)), "prefix": "", "suffix": "", "unit": "", "span": r.span()}
    m = re.search(r"(₹|\$)?\s?(\d+(?:[.,]\d+)?)\s?(%|percent|x|times|lakh|crore|k|hours|minutes|days|seconds)?", text, re.I)
    if m and m.group(2):
        val = float(m.group(2).replace(",", ""))
        unit = (m.group(3) or "").lower()
        suffix = {"%": "%", "percent": "%", "x": "x", "times": "x", "k": "K", "lakh": " L", "crore": " Cr"}.get(unit, "")
        label_unit = unit if unit in ("hours", "minutes", "days", "seconds") else ""
        if val in (1, 2, 3) and not suffix and not label_unit:
            return None  # "three steps" is not a statistic
        return {"value": val, "prefix": m.group(1) or "", "suffix": suffix, "unit": label_unit, "span": m.span()}
    words = [_w(x) for x in text.split()]
    for i, w in enumerate(words):
        if w in NUM_WORDS and i + 1 < len(words) and words[i + 1] in ("percent", "%"):
            return {"value": NUM_WORDS[w], "prefix": "", "suffix": "%", "unit": "", "span": None}
    return None


def _label_from(text: str, max_words: int = 5) -> str:
    t = STEP_MARKERS.sub("", text.strip())
    t = re.sub(r"^(we|you|they|it|our \w+|your \w+)\s+", "", t, flags=re.I)
    words = [w for w in re.findall(r"[\w%'-]+", t)]
    keep = []
    for w in words:
        if len(keep) >= max_words:
            break
        if not keep and _w(w) in STOP:
            continue
        keep.append(w)
    while keep and _w(keep[-1]) in STOP:
        keep.pop()
    s = " ".join(keep)
    return s[:1].upper() + s[1:] if s else ""


def _icon_for(text: str) -> str | None:
    for w in re.findall(r"[\w'-]+", text.lower()):
        if w in ICON_WORDS:
            return ICON_WORDS[w]
    return None


def _punch_phrase(text: str) -> str:
    """Short emphasis phrase for a keyword pop: usually the sentence's closing content words."""
    words = re.findall(r"[\w%₹$'-]+", text)
    if not words:
        return ""
    tail = []
    for w in reversed(words):
        tail.insert(0, w)
        cw = [x for x in tail if _w(x) not in STOP]
        if len(cw) >= 2 or len(tail) >= 3:
            break
    while tail and _w(tail[0]) in STOP and _w(tail[0]) not in ("too", "every", "by", "in", "no"):
        tail.pop(0)
    phrase = " ".join(tail)
    return phrase if 2 <= len(phrase) <= 22 else ""


# ---------------------------------------------------------------- graphics
def content_graphics(plan: Plan, brief: dict, assets: list[dict], density: float, avoid: list[tuple[float, float]]) -> tuple[list[Graphic], list[str]]:
    sents = _sentences_out(plan)
    gfx: list[Graphic] = []
    notes: list[str] = []
    used = list(avoid)

    def free(a: float, b: float, gap: float = 0.6) -> bool:
        return all(b + gap <= x or a >= y + gap for x, y in used)

    def fit(a: float, b: float, gap: float, min_len: float = 1.0):
        """Shortens a graphic so it ends before the next occupied slot; None when it cannot fit."""
        for x, y in sorted(used):
            if a < y + gap and b + gap > x:
                if x > a:
                    b = min(b, x - gap)
                else:
                    return None
        return (a, b) if b - a >= min_len else None

    # 1. steps -> process flow
    steps = [s for s in sents if STEP_MARKERS.match(s["text"].strip())]
    if len(steps) >= 2:
        first_i = sents.index(steps[0])
        intro = sents[first_i - 1] if first_i > 0 and re.search(r"\b(steps?|ways?|how)\b", sents[first_i - 1]["text"], re.I) else None
        a = (intro["start"] + 0.2) if intro else steps[0]["start"] - 0.25
        b = steps[-1]["end"] + 0.1
        flow_steps = [{"label": _label_from(s["text"], 4), "icon": _icon_for(s["text"]) or "circle-check"} for s in steps[:4]]
        g = Graphic(type="process_flow", start=max(0.0, a), end=b,
                    params={"title": brief.get("flow_title") or "How it works", "steps": flow_steps, "item_times": [max(a + 0.35, s["start"] - 0.1) for s in steps[:4]]},
                    reason="the speaker walks through steps, shown as a numbered flow")
        gfx.append(g)
        used.append((g.start, g.end))
    # 2. numbers -> stat counter
    for s in sents:
        num = _find_number(s["text"])
        if not num:
            continue
        slot = fit(s["start"] + 0.2, min(s["end"] + 1.0, s["start"] + 3.4), 0.25, 1.6)
        if not slot:
            continue
        a, b = slot
        label_words = re.sub(r"(₹|\$)?\s?\d+(?:[.,]\d+)?\s?(%|percent|x|times|lakh|crore|k)?", " ", s["text"], flags=re.I)
        label_words = re.sub(r"\s+(to|-|–)\s+(?=\s|$)", " ", label_words)
        label_words = re.sub(r"\b(by|of|up to|around|about)\s*[.!?]?$", "", label_words.strip(" .!?"), flags=re.I).strip()
        label = _label_from(label_words, 6)
        g = Graphic(type="stat_counter", start=a, end=b, params={"value": num["value"], **({"to": num["to"]} if "to" in num else {}), "prefix": num["prefix"], "suffix": num["suffix"],
                                                             "label": (label + (" " + num["unit"] if num["unit"] else "")).strip()},
                    reason="a number is said, shown as a counting statistic")
        gfx.append(g)
        used.append((a, b))
    # 3. images that match what is being said
    for asset in assets or []:
        tags = [t.lower() for t in asset.get("tags", []) if t]
        if not tags:
            continue
        for s in sents:
            if any(t in s["text"].lower() for t in tags):
                a, b = s["start"] - 0.1, s["start"] + 3.0
                if free(a, b):
                    gfx.append(Graphic(type="image_card", start=a, end=b, params={"path": asset["path"], "title": asset.get("title", ""), "caption": asset.get("caption", "")},
                                       reason=f"picture of '{tags[0]}' while it is mentioned"))
                    used.append((a, b))
                break
    # 4. keyword pops and icon callouts on the remaining sentences
    keywords = [k.lower() for k in (brief.get("keywords") or []) + (brief.get("glossary") or []) if k]
    last = -10.0
    step_every = 1 if density >= 1.4 else 2 if density >= 0.8 else 3
    k = 0
    for s in sents:
        if re.search(r"\b(follow|subscribe|comment|share|save this|link in bio)\b", s["text"], re.I):
            continue
        k += 1
        if k % step_every and not any(kw in s["text"].lower() for kw in keywords):
            continue
        hit = next((kw for kw in keywords if kw in s["text"].lower()), None)
        if hit:
            w = next((x for x in s["words"] if hit.split()[0] in x["text"].lower()), s["words"][0])
            text, start = hit, w["start"] - 0.05
            icon = _icon_for(hit)
            kind = "keyword_pop"
        else:
            phrase = _punch_phrase(s["text"])
            icon_word = next((x for x in s["words"] if _w(x["text"]) in ICON_WORDS and _w(x["text"]) not in STOP), None)
            if icon_word is not None and (not phrase or k % 2 == 0):
                text, start, icon, kind = re.sub(r"[^\w%'-]", "", icon_word["text"]), icon_word["start"] - 0.05, ICON_WORDS[_w(icon_word["text"])], "icon_callout"
            elif phrase:
                first = phrase.split()[0].lower()
                w = next((x for x in s["words"] if _w(x["text"]) == _w(first)), s["words"][-1])
                text, start, icon, kind = phrase, w["start"] - 0.05, None, "keyword_pop"
            else:
                continue
        dur = 1.9 if kind == "keyword_pop" else 2.2
        if start - last < 1.4:
            continue
        slot = fit(max(0.0, start), min(start + dur, s["end"] + 0.6), 0.3, 1.0)
        if not slot:
            continue
        a, b = slot
        params = {"text": text}
        if icon:
            params["icon"] = icon
        gfx.append(Graphic(type=kind, start=a, end=b, params=params, reason="emphasis on a key phrase as it is said"))
        used.append((a, b))
        last = a
    return gfx, notes


# ---------------------------------------------------------------- metadata
def make_metadata(plan: Plan, brief: dict, headline: str) -> dict:
    sents = _sentences_out(plan)
    first = sents[0]["text"] if sents else ""
    title = (brief.get("title") or headline or first).strip()
    if len(title) > 70:
        title = title[:67].rsplit(" ", 1)[0] + "..."
    tags = [t.strip("# ").replace(" ", "") for t in (brief.get("hashtags") or []) if t.strip()]
    if not tags:
        tags = [re.sub(r"\W", "", k.title()) for k in (brief.get("keywords") or [])[:4]]
    hashtags = " ".join("#" + t for t in tags[:5] if t)
    summary = " ".join(s["text"] for s in sents[1:3])
    cta = brief.get("cta") or "Follow for more"
    ig = f"{headline or first}\n\n{summary}\n\n{cta}" + (f"\n\n{hashtags}" if hashtags else "")
    yt_desc = " ".join(s["text"] for s in sents) + (f"\n\n{hashtags}" if hashtags else "")
    vertical = plan.format.aspect == "9:16"
    return {
        "instagram": {"caption": ig[:2200]},
        "facebook": {"description": f"{headline or first}\n\n{summary}\n\n{cta}"[:5000]},
        "youtube": {"title": (title + (" #Shorts" if vertical and len(title) < 62 else ""))[:100], "description": yt_desc[:5000],
                    "tags": [t for t in (brief.get("keywords") or [])][:15]},
    }


# ---------------------------------------------------------------- plan
def apply_plan_ops(plan: Plan, ops: list[dict]) -> list[str]:
    """Applies change requests that act on the finished plan. Returns a plain description of what changed."""
    done = []
    for o in ops:
        op = o["op"]
        if op == "music":
            if o.get("action") == "remove" and plan.music:
                plan.music = None
                done.append("music removed")
            elif o.get("action") == "volume" and plan.music:
                plan.music.volume_db = max(-35, min(-6, plan.music.volume_db + float(o.get("delta_db", 0))))
                done.append(f"music {'louder' if o.get('delta_db', 0) > 0 else 'softer'}")
        elif op == "captions":
            c = plan.captions
            if "enabled" in o:
                c.enabled = bool(o["enabled"])
                done.append("captions " + ("on" if c.enabled else "removed"))
            if o.get("scale"):
                c.size = max(0.04, min(0.1, c.size * float(o["scale"])))
                done.append("captions " + ("bigger" if o["scale"] > 1 else "smaller"))
            if o.get("position_delta"):
                c.position = max(0.55, min(0.78, c.position + float(o["position_delta"])))
                done.append("captions moved " + ("up" if o["position_delta"] < 0 else "down"))
            if o.get("highlight"):
                c.highlight = o["highlight"]
                done.append("caption highlight colour changed")
            if o.get("color"):
                c.color = o["color"]
            if "uppercase" in o:
                c.uppercase = bool(o["uppercase"])
                done.append("captions in " + ("capitals" if c.uppercase else "normal case"))
        elif op == "logo":
            if o.get("action") == "remove":
                plan.graphics = [g for g in plan.graphics if g.type != "logo_bug"]
                done.append("corner logo removed")
            elif o.get("action") == "scale":
                for g in plan.graphics:
                    if g.type == "logo_bug":
                        g.params["scale"] = float(o.get("scale", 1.0))
                done.append("corner logo " + ("bigger" if o.get("scale", 1) > 1 else "smaller"))
        elif op == "end_card" and o.get("action") == "remove":
            plan.graphics = [g for g in plan.graphics if g.type != "end_card"]
            plan.end_card_seconds = 0.0
            done.append("end card removed")
        elif op == "cta":
            for g in plan.graphics:
                if g.type in ("end_card", "cta_banner"):
                    g.params["cta" if g.type == "end_card" else "text"] = o["text"]
            done.append(f"call to action set to \"{o['text']}\"")
        elif op == "headline":
            if o.get("action") == "remove":
                plan.graphics = [g for g in plan.graphics if g.type != "hook_title"]
                done.append("headline removed")
            else:
                hs = [g for g in plan.graphics if g.type == "hook_title"]
                if hs:
                    hs[0].params["text"] = o["text"]
                else:
                    plan.graphics.append(Graphic(type="hook_title", start=0.0, end=min(2.8, plan.speech_duration), params={"text": o["text"]}, reason="requested headline"))
                done.append(f"headline set to \"{o['text']}\"")
        elif op == "trim":
            sec = float(o.get("seconds", 0))
            if o.get("where") == "start":
                while sec > 0.05 and plan.clips:
                    c = plan.clips[0]
                    if c.duration <= sec + 0.1:
                        sec -= c.duration
                        plan.clips.pop(0)
                    else:
                        c.t_in += sec
                        c.words = [w for w in c.words if w.end > c.t_in]
                        sec = 0
                for g in plan.graphics:
                    if g.type not in ("end_card",):
                        g.start = max(0.0, g.start - float(o["seconds"]))
                        g.end = max(0.0, g.end - float(o["seconds"]))
                done.append(f"first {o['seconds']:g} s cut")
            else:
                while sec > 0.05 and plan.clips:
                    c = plan.clips[-1]
                    if c.duration <= sec + 0.1:
                        sec -= c.duration
                        plan.clips.pop()
                    else:
                        c.t_out -= sec
                        c.words = [w for w in c.words if w.start < c.t_out]
                        sec = 0
                done.append(f"last {o['seconds']:g} s cut")
        elif op == "remove_graphic":
            n = len(plan.graphics)
            plan.graphics = [g for g in plan.graphics if not (g.type == o.get("type") and (not o.get("text") or o["text"].lower() in str(g.params).lower()))]
            if len(plan.graphics) < n:
                done.append(f"{o['type'].replace('_', ' ')} removed")
        elif op == "add_keyword":
            target = str(o["text"]).lower()
            hit = next((w for w in plan.output_words() if target.split()[0] in w["text"].lower()), None)
            if hit:
                plan.graphics = [g for g in plan.graphics if not (g.type in ("keyword_pop", "icon_callout") and abs(g.start - hit["start"]) < 2.0)]
                plan.graphics.append(Graphic(type="keyword_pop", start=max(0, hit["start"] - 0.05), end=hit["start"] + 1.9, params={"text": o["text"], **({"icon": _icon_for(o["text"])} if _icon_for(o["text"]) else {})}, reason="requested emphasis"))
                done.append(f"\"{o['text']}\" highlighted")
        elif op == "lower_third":
            plan.graphics = [g for g in plan.graphics if g.type != "lower_third"]
            plan.graphics.append(Graphic(type="lower_third", start=min(3.0, plan.speech_duration * 0.2), end=min(3.0, plan.speech_duration * 0.2) + 3.6, params={"name": o.get("name", ""), "role": o.get("role", "")}, reason="requested name card"))
            done.append("name card updated")
    return done


def fix_words(takes: list[dict], corrections: dict | None) -> list[dict]:
    """Spelling fixes for captions (brand and product names the speech recogniser gets wrong) and number joins ("0" ".5" -> "0.5")."""
    corr = {k.lower(): v for k, v in (corrections or {}).items()}
    out = []
    for tk in takes:
        tk = dict(tk)
        ws = []
        for w in tk["words"]:
            txt = w["text"]
            core = re.sub(r"^[^\w]+|[^\w]+$", "", txt)
            if core.lower() in corr:
                txt = txt.replace(core, corr[core.lower()])
            if ws and re.fullmatch(r"\.\d+[.,!?]?", txt) and re.fullmatch(r"\d+", ws[-1]["text"]):
                ws[-1] = dict(ws[-1], text=ws[-1]["text"] + txt, end=w["end"])
                ws.append(dict(w, text="", _merged=True))
                continue
            ws.append(dict(w, text=txt))
        tk["words"] = ws
        sents = []
        for s in tk.get("sentences", []):
            s = dict(s)
            s["words"] = [dict(x, text=ws[x["i"]]["text"]) if "i" in x and x["i"] < len(ws) else x for x in s["words"]]
            s["text"] = " ".join(x["text"] for x in s["words"] if x["text"])
            sents.append(s)
        tk["sentences"] = sents
        out.append(tk)
    return out


def build_plan(inputs: dict, variant: str, aspect: str = "9:16", overrides: list[dict] | None = None) -> dict:
    """inputs: takes, selection, brief, brand, assets, music, rules, suggestion_ops (+ style_profile for variant 'profile')."""
    style = variant
    if variant not in ("clean", "branded", "motion", "overlay", "editorial"):
        variant = "editorial" if variant == "profile" and (inputs.get("style_profile") or {}).get("base") == "explainer3d" else "motion"
        if style == "cinematic":
            variant = "editorial"
    inputs = dict(inputs, takes=fix_words(inputs["takes"], (inputs.get("brief") or {}).get("corrections")))
    machines = [m for m in (inputs.get("machines") or ([inputs["machine"]] if inputs.get("machine") else [])) if m]
    if machines:
        inputs["brief"] = dict(inputs.get("brief") or {}, _machine=machines[0], _machines=machines)
    overrides = list(inputs.get("suggestion_ops") or []) + list(overrides or [])
    brief = inputs.get("brief") or {}
    brand = Brand.model_validate(inputs.get("brand") or {})
    rules_in = inputs.get("rules") or []
    rules = {r["code"]: r for r in rules_in}
    fmt = Format(aspect=aspect, width=1080 if aspect == "9:16" else 1920, height=1920 if aspect == "9:16" else 1080)
    clips, kept_lines = build_clips(inputs["takes"], inputs["selection"], variant, overrides, rules, fmt.fps)
    if not clips:
        raise ValueError("no usable speech found in the takes")
    plan = Plan(variant=variant, title=brief.get("title", ""), format=fmt, clips=clips, brand=brand,
                captions=CaptionStyle(position=0.70 if aspect == "9:16" else 0.86, size=0.066 if aspect == "9:16" else 0.058))
    if "split_long_explanations" in rules:
        plan.captions.max_words = 3
    speech = plan.speech_duration
    density = {"clean": 0.0, "branded": 0.0, "motion": 1.0, "overlay": 1.0, "editorial": 1.2}[variant]
    for o in overrides:
        if o["op"] == "graphics_density":
            density = density * (1.5 if o["value"] == "more" else 0.55) if density else 0.0
    headline = (brief.get("headline") or "").strip()
    gfx: list[Graphic] = []
    used_rules: list[RuleUse] = []
    product_img = next((a for a in inputs.get("assets") or [] if a.get("kind") == "product"), None)
    if variant in ("branded", "motion", "overlay", "editorial"):
        gfx.append(Graphic(type="logo_bug", start=0.35, end=speech, reason="brand recognition from the first second"))
        if product_img and "product_in_opening" in rules:
            gfx.append(Graphic(type="image_card", start=0.25, end=min(speech, 2.8), params={"path": product_img["path"], "title": headline}, reason="engine rule: show the product in the first seconds"))
        elif headline:
            gfx.append(Graphic(type="hook_title", start=0.0, end=min(speech, 2.9), params={"text": headline, "highlight": brief.get("headline_highlight", [])}, reason="headline on screen while the hook is spoken"))
        if brief.get("speaker_name"):
            a = 3.2 if speech > 8 else speech * 0.3
            gfx.append(Graphic(type="lower_third", start=a, end=min(speech - 0.2, a + 3.6), params={"name": brief["speaker_name"], "role": brief.get("speaker_role", "")}, reason="who is speaking"))
        cta_word = brief.get("cta") or CTA_TEXT.get(rules.get("cta_type", {}).get("value", ""), "Follow for more")
        plan.end_card_seconds = 2.8
        gfx.append(Graphic(type="end_card", start=speech, end=speech + 2.8, params={"cta": cta_word, "company": brand.company_name, "handle": brand.handle, "tagline": brief.get("tagline", "")}, reason="brand end card"))
        if "cta_early" in rules and speech > 12:
            a = speech * 0.55
            gfx.append(Graphic(type="cta_banner", start=a, end=a + 2.6, params={"text": cta_word}, reason="engine rule: ask before most viewers have left"))
    if variant in ("motion", "overlay", "editorial"):
        if "intro_wipe" not in [o.get("type") for o in overrides if o["op"] == "remove_graphic"]:
            gfx.append(Graphic(type="intro_wipe", start=0.0, end=0.55, reason="energetic brand opening without delaying the hook"))
        gfx.append(Graphic(type="progress_bar", start=0.0, end=speech, reason="shows viewers how much is left"))
        avoid = [(g.start, g.end) for g in gfx if g.type in ("hook_title", "image_card")]
        tmp = plan.model_copy(deep=True)
        cg, notes = content_graphics(tmp, brief, inputs.get("assets") or [], density, avoid)
        gfx += cg
        plan.notes += notes
    # a name card must not run into a split layout
    splits = sorted(g.start for g in gfx if g.type in ("process_flow", "bullet_list", "image_card") and g.start > 0.5)
    for g in gfx:
        if g.type == "lower_third":
            nxt = next((x for x in splits if x > g.start), None)
            if nxt is not None and g.end > nxt - 0.2:
                g.end = max(g.start + 1.6, nxt - 0.2)
    gfx = [g for g in gfx if not (g.type == "lower_third" and any(x < g.end and x > g.start for x in splits))]
    if variant == "overlay":
        set_overlay(gfx)
    plan.graphics = gfx
    if inputs.get("music") and variant in ("branded", "motion", "overlay", "editorial") or (inputs.get("music") and any(o["op"] == "music" and o.get("action") != "remove" for o in overrides)):
        m = inputs["music"]
        plan.music = Music(path=m["path"], license_path=m.get("license_path"), title=m.get("title", ""), volume_db={"clean": -21, "branded": -19, "motion": -17, "overlay": -17, "editorial": -21}[variant])
    # rules report
    for code, r in rules.items():
        how, applied = "", True
        if code == "product_in_opening":
            applied = bool(product_img) and variant != "clean"
            how = "product picture in the first 3 seconds" if applied else "no product picture uploaded, so the edit could not show the product early"
        elif code == "hook_text":
            applied = any(g.type == "hook_title" for g in plan.graphics)
            how = "headline on screen during the hook" if applied else "add a headline in the brief to apply this"
        elif code == "narration_in_opening":
            how = "speech starts in the first frame; nothing is placed before it"
        elif code == "fast_pace":
            how = "a new shot or punch-in at least every 4 seconds"
        elif code == "cut_silences":
            how = "pauses longer than 0.3 s are cut"
        elif code == "split_long_explanations":
            how = "captions in short 3-word groups so long explanations are easier to follow"
        elif code == "fewer_cuts":
            how = "no punch-in zooms, takes kept together where possible"
        elif code == "cta_early":
            applied = any(g.type == "cta_banner" for g in plan.graphics)
            how = "call to action at the halfway point" if applied else "video too short or clean version"
        elif code == "cta_type":
            how = f"call to action: {CTA_TEXT.get(r.get('value', ''), r.get('value', ''))}"
        elif code == "target_seconds":
            how = f"target length {r.get('value')} s"
        else:
            how = r.get("text", "")
        used_rules.append(RuleUse(code=code, applied=applied, how=how, source=r.get("source", "engine")))
    plan.rules = used_rules
    changes = apply_plan_ops(plan, [o for o in overrides if o["op"] not in ("use_take", "remove_line", "remove_line_text", "target_length", "pace", "graphics_density")])
    if changes:
        plan.notes.append("Changes applied: " + "; ".join(changes))
    plan.metadata = make_metadata(plan, brief, headline)
    if style == "editorial":
        from . import editorial
        editorial.convert(plan, brief)
        plan.notes.append("3D Explainer: cuts to full-screen 3D explainers and back, 3D objects rise from behind the speaker, kinetic captions, light sound design")
    elif style in ("hype", "cinematic", "minimal"):
        from . import styles
        if style == "cinematic":
            plan.graphics = [g for g in plan.graphics if g.type in ("illustration", "stat_counter", "end_card")]
        styles.BUILDERS[style](plan, brief)
        plan.variant = style
        plan.notes.append(f"{styles.STYLES[style]['name']}: {styles.STYLES[style]['about']}")
    elif style == "profile":
        from . import styles
        prof = inputs.get("style_profile") or {}
        styles.apply_profile(plan, prof, brief)
        plan.variant = "profile"
        plan.notes.append(f"Style learned from a reference video: {prof.get('name', 'custom')} ({prof.get('summary', '')})")
    if machines and style in ("editorial", "hype", "cinematic", "minimal", "profile"):
        from . import styles
        for i, m in enumerate(machines):   # the first machine always appears; the others when they are named
            styles.add_machine(plan, m, brief, require_mention=i > 0)
    plan.clamp_graphics()
    from .director.direction import apply_sound
    apply_sound(plan, "minimal")   # house rule: minimal sound, one soft effect per moment
    Plan.model_validate(plan.model_dump())  # final validation
    return {"plan": plan.model_dump(), "summary": summarize(plan, kept_lines)}


VARIANT_NAMES = {"clean": "Clean cut + captions", "branded": "Branded", "motion": "Full motion graphics", "overlay": "Full video + floating graphics",
                 "editorial": "3D Explainer", "hype": "Bold & Fast", "cinematic": "Cinematic Story", "minimal": "Clean & Minimal", "profile": "Style from reference"}


def set_overlay(graphics) -> None:
    """Overlay version: panel graphics float over the full-frame video instead of splitting the screen."""
    side = "right"
    for g in graphics:
        if g.type in ("illustration", "process_flow", "bullet_list", "image_card"):
            g.params["layout"] = "overlay"
            g.params.setdefault("enter", side)
            side = "left" if side == "right" else "right"
TYPE_WORDS = {"illustration": "3D illustration", "hook_title": "headline at the top", "logo_bug": "logo in the corner", "lower_third": "name card", "keyword_pop": "key phrase pop-up",
              "icon_callout": "icon call-out", "stat_counter": "counting statistic", "bullet_list": "list", "process_flow": "step-by-step flow",
              "image_card": "picture card", "broll_full": "full-screen picture", "progress_bar": "progress bar", "intro_wipe": "brand colour wipe",
              "cta_banner": "call to action", "end_card": "end card with logo",
              "fullscreen": "full-screen cutaway", "text_behind": "big title behind the speaker",
              "pop3d": "3D asset popping out over the shot", "model3d": "3D object flying in over the shot"}


def _clock(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:04.1f}"


def summarize(plan: Plan, lines: list[dict]) -> dict:
    """Plain-language description of the edit for the review screen and the approval email."""
    steps = []
    offs = plan.clip_offsets()
    seen = set()
    for off, c in zip(offs, plan.clips):
        if c.line in seen:
            continue
        seen.add(c.line)
        steps.append({"at": _clock(off), "what": c.reason})
    for g in plan.graphics:
        txt = g.params.get("text") or g.params.get("title") or g.params.get("title_a") or g.params.get("name") or ""
        steps.append({"at": _clock(g.start), "what": f"{TYPE_WORDS.get(g.type, g.type)}" + (f": \"{txt}\"" if txt else "") + (f" ({g.reason})" if g.reason else "")})
    steps.sort(key=lambda s: s["at"])
    return {"variant": plan.variant, "name": VARIANT_NAMES[plan.variant], "length": round(plan.total_duration, 1), "cuts": len(plan.clips) - 1,
            "music": plan.music.title if plan.music else None, "steps": steps, "rules": [r.model_dump() for r in plan.rules], "notes": plan.notes}
