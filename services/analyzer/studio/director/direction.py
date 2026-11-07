"""Claude's edit direction: what it writes, how it is checked, and how it becomes a renderable plan.

Claude never writes the low-level plan. It writes a Direction: which words to cut, and a list of beats anchored on
word ids from the transcript ("from w41 to w58 cut to a full-screen 3D explainer of the transformer, explode it at
w47, label the core at w50"). The compiler turns word ids into exact times, the beats into engine graphics in the
chosen style, and runs the style's own finishing (cutting rhythm, captions, grade, sound).
"""
from __future__ import annotations

import copy
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .. import kit
from ..schema import Clip, Graphic, Plan, Word

BUILTIN_STAGES = {"energy", "lift", "motor_inside", "pump_inside", "pump_flow", "head"}       # full-screen explainers that exist already
BUILTIN_MODELS = {"pump_set", "stator_rotor", "impeller", "energy", "lift", "brand"}          # objects that exist already
CAMERAS = ("orbit", "push_in", "pull_back", "rise", "top_down", "detail")
BeatKind = Literal["explainer", "object", "machine", "text_behind", "number", "statement", "list", "chapter", "diagram"]


class WordRef(BaseModel):
    """A word in the transcript Claude was shown."""
    id: int
    text: str
    take_id: str
    src_start: float
    src_end: float
    line: Optional[int]
    out_start: float
    out_end: float


# ---------------------------------------------------------------- what Claude writes
class BeatAction(BaseModel):
    do: Literal["spin", "explode", "move", "appear", "fade_out", "glow", "pulse", "highlight", "flow", "label"]
    at_word: Optional[int] = None
    until_word: Optional[int] = None
    at: Optional[float] = None            # seconds from the start of the beat (when no word fits)
    target: str = "*"
    axis: Literal["x", "y", "z"] = "y"
    rpm: float = 60.0
    by: Optional[list[float]] = None
    distance: float = 1.0
    color: Optional[str] = None
    flow: Optional[str] = None
    speed: float = 0.5
    title: str = ""
    sub: str = ""


class ListItem(BaseModel):
    label: str
    at_word: Optional[int] = None


class DiagramNode(BaseModel):
    id: str
    label: str
    sub: str = ""
    icon: Optional[str] = None
    at_word: Optional[int] = None
    color: Optional[str] = None


class DiagramLink(BaseModel):
    from_: str = Field(alias="from")
    to: str
    label: str = ""
    kind: Literal["current", "water", "data", "air", "heat", "money", "signal"] = "current"
    at_word: Optional[int] = None

    model_config = {"populate_by_name": True}


class Beat(BaseModel):
    kind: BeatKind
    start_word: int
    end_word: int
    reason: str = ""
    # explainer / object / machine
    asset: Optional[str] = None           # id of an asset in "assets", "builtin:<name>", "library:<id>" or "machine"
    camera: str = "orbit"
    focus: Optional[str] = None
    actions: list[BeatAction] = Field(default_factory=list)
    enter: Literal["rise", "far", "still"] = "rise"
    side: Literal["left", "right"] = "right"
    # full-screen beats: how they come in and go back to the speaker (cut | whip | fade | zoom); None = the style's default
    transition_in: Optional[Literal["cut", "whip", "fade", "zoom"]] = None
    transition_out: Optional[Literal["cut", "whip", "fade", "zoom"]] = None
    # the sound effect of this beat: auto = the style decides, none = silent, accent = the one moment that should be felt
    sound: Literal["auto", "none", "accent"] = "auto"
    stage_params: dict[str, Any] = Field(default_factory=dict)   # extra params for built-in stages (label_times ...)
    # text
    lines: list[str] = Field(default_factory=list)
    highlight: list[str] = Field(default_factory=list)
    value: Optional[float] = None
    value_to: Optional[float] = None
    prefix: str = ""
    suffix: str = ""
    label: str = ""
    title: str = ""
    number: str = ""
    items: list[ListItem] = Field(default_factory=list)
    nodes: list[DiagramNode] = Field(default_factory=list)
    links: list[DiagramLink] = Field(default_factory=list)
    layout: Literal["row", "column", "cycle", "grid"] = "column"
    look: Literal["dark", "light"] = "dark"

    @field_validator("camera")
    @classmethod
    def _cam(cls, v):
        base = v.split(":", 1)[0]
        if base not in CAMERAS:
            raise ValueError(f"camera must be one of {CAMERAS} (detail can be 'detail:<part id>')")
        return v


class Direction(BaseModel):
    style: str = ""
    drop_words: list[int] = Field(default_factory=list)     # word ids to cut (false starts, filler, repeated sentences)
    corrections: dict[str, str] = Field(default_factory=dict)   # misheard words in the captions: {"Beastings": "BridgeThings"}
    headline: Optional[str] = None
    emphasis: list[str] = Field(default_factory=list)       # words the captions make big
    beats: list[Beat] = Field(default_factory=list)
    assets: list[dict] = Field(default_factory=list)        # kit specs (new 3D objects)
    pace: Optional[float] = None                            # seconds between framing changes, overrides the style
    sound_level: Literal["minimal", "normal"] = "minimal"   # minimal: one soft sound per moment, nothing on small moves
    notes: list[str] = Field(default_factory=list)          # Claude's explanation of the edit, for the reviewers
    metadata: dict[str, Any] = Field(default_factory=dict)  # title, caption, hashtags


# ---------------------------------------------------------------- transcript Claude sees
def word_refs(plan: Plan) -> list[WordRef]:
    out, off, k = [], 0.0, 0
    for c in plan.clips:
        for w in c.words:
            a, b = max(w.start, c.t_in), min(w.end, c.t_out)
            if b <= a:
                continue
            out.append(WordRef(id=k, text=w.text, take_id=c.take_id, src_start=w.start, src_end=w.end, line=c.line,
                               out_start=round(off + a - c.t_in, 3), out_end=round(off + b - c.t_in, 3)))
            k += 1
        off += c.duration
    return out


def transcript_text(refs: list[WordRef]) -> str:
    """Sentences with word ids and output times: 'L3 [12.40] w41:The w42:transformer ...'."""
    lines, cur, cur_line = [], [], None
    for r in refs:
        if cur and (r.line != cur_line or re.search(r"[.!?]$", cur[-1].text.strip())):
            lines.append(cur)
            cur = []
        cur.append(r)
        cur_line = r.line
    if cur:
        lines.append(cur)
    return "\n".join(f"[{ws[0].out_start:6.2f}-{ws[-1].out_end:6.2f}] " + " ".join(f"w{x.id}:{x.text}" for x in ws) for ws in lines)


# ---------------------------------------------------------------- compiling
class CompileError(Exception):
    pass


def _cut(plan: Plan, refs: list[WordRef], drop: set[int]) -> Plan:
    """Removes the dropped words: clips are split around them and the cut lands in the gap between words."""
    if not drop:
        return plan
    by_key = {(r.take_id, round(r.src_start, 3)): r.id for r in refs}
    clips = []
    for c in plan.clips:
        ws = [w for w in c.words if max(w.start, c.t_in) < min(w.end, c.t_out)]
        runs, cur = [], []
        for w in ws:
            wid = by_key.get((c.take_id, round(w.start, 3)))
            if wid in drop:
                if cur:
                    runs.append(cur)
                    cur = []
            else:
                cur.append(w)
        if cur:
            runs.append(cur)
        if len(runs) == 1 and len(runs[0]) == len(ws):
            clips.append(c)
            continue
        for i, run in enumerate(runs):
            a = c.t_in if (run[0] is ws[0]) else max(c.t_in, run[0].start - 0.06)
            b = c.t_out if (run[-1] is ws[-1]) else min(c.t_out, run[-1].end + 0.08)
            if b - a < 0.12:
                continue
            nc = c.model_copy(deep=True)
            nc.t_in, nc.t_out = round(a, 3), round(b, 3)
            nc.words = [Word(start=w.start, end=w.end, text=w.text) for w in run]
            clips.append(nc)
    if not clips:
        raise CompileError("every word was cut")
    plan.clips = clips
    return plan


def _out_times(plan: Plan) -> dict[tuple[str, float], tuple[float, float]]:
    m, off = {}, 0.0
    for c in plan.clips:
        for w in c.words:
            a, b = max(w.start, c.t_in), min(w.end, c.t_out)
            if b > a:
                m[(c.take_id, round(w.start, 3))] = (round(off + a - c.t_in, 3), round(off + b - c.t_in, 3))
        off += c.duration
    return m


class Timeline:
    """Word id -> output time after the cuts (a cut word maps to the nearest kept word)."""

    def __init__(self, refs: list[WordRef], plan: Plan):
        self.refs = refs
        ot = _out_times(plan)
        self.t: dict[int, tuple[float, float]] = {}
        for r in refs:
            v = ot.get((r.take_id, round(r.src_start, 3)))
            if v:
                self.t[r.id] = v
        self.kept = sorted(self.t)
        self.total = plan.speech_duration

    def start(self, wid: Optional[int]) -> Optional[float]:
        if wid is None:
            return None
        if wid in self.t:
            return self.t[wid][0]
        nxt = [k for k in self.kept if k > wid]
        return self.t[nxt[0]][0] if nxt else self.total

    def end(self, wid: Optional[int]) -> Optional[float]:
        if wid is None:
            return None
        if wid in self.t:
            return self.t[wid][1]
        prv = [k for k in self.kept if k < wid]
        return self.t[prv[-1]][1] if prv else 0.0

    def valid(self, wid: int) -> bool:
        return 0 <= wid < len(self.refs)


FULL_KINDS = {"explainer", "statement", "list", "chapter", "diagram"}
MIN_LEN = {"explainer": 2.0, "object": 2.0, "machine": 2.4, "text_behind": 0.9, "number": 1.4, "statement": 0.9, "list": 2.4, "chapter": 0.8, "diagram": 2.8}
MAX_LEN = {"explainer": 9.0, "object": 6.5, "machine": 6.0, "text_behind": 3.0, "number": 4.0, "statement": 2.6, "list": 10.0, "chapter": 1.6, "diagram": 12.0}


def _asset_for(beat: Beat, assets: dict[str, dict], library: dict[str, dict], machine: Optional[dict], machines: Optional[list] = None):
    a = beat.asset or ""
    if a.startswith("builtin:"):
        return ("builtin", a.split(":", 1)[1])
    if a.startswith("machine:"):   # one of several machines: "machine:2" or "machine:<name>"
        key = a.split(":", 1)[1].strip().lower()
        ms = list(machines or ([machine] if machine else []))
        m = ms[int(key) - 1] if key.isdigit() and 0 < int(key) <= len(ms) else next((x for x in ms if (x.get("name") or "").strip().lower() == key), None)
        return ("machine", m) if m else (None, f"'{a}' is not one of this video's machines (use machine:1 … machine:{len(ms)})")
    if a == "machine" or beat.kind == "machine":
        return ("machine", machine) if machine else (None, "no machine was chosen for this video")
    if a.startswith("library:"):
        spec = library.get(a.split(":", 1)[1])
        return ("kit", spec) if spec else (None, f"library asset '{a}' not found")
    if a in assets:
        return ("kit", assets[a])
    if a in library:
        return ("kit", library[a])
    return (None, f"asset '{a}' is not defined in 'assets' (and is not builtin:/library:)")


def compile_direction(base: dict, direction: dict, refs: list[WordRef], style: str, brief: dict, machine: Optional[dict] = None,
                      library: Optional[dict[str, dict]] = None, photos: Optional[list[str]] = None, profile: Optional[dict] = None,
                      brand: Optional[dict] = None) -> tuple[dict, list[str], list[str]]:
    """Returns (plan dict, problems Claude should fix, notes on automatic adjustments)."""
    from .. import styles as ST
    d = Direction.model_validate(direction)
    plan = Plan.model_validate(copy.deepcopy(base))
    problems: list[str] = []
    adjust: list[str] = []
    library = library or {}
    # 1. caption spelling fixes, then cuts
    if d.corrections:
        fix = {k.lower().strip(".,!?"): v for k, v in d.corrections.items() if k and v and len(v) < 40}
        for c in plan.clips:
            for w in c.words:
                core = w.text.strip(".,!?;:")
                rep = fix.get(core.lower())
                if rep:
                    w.text = w.text.replace(core, rep)
    drop = {w for w in d.drop_words if 0 <= w < len(refs)}
    if len(drop) > len(refs) * 0.6:
        problems.append(f"drop_words removes {len(drop)} of {len(refs)} words; keep the message, cut only false starts, filler and repeats")
        drop = set()
    old_speech = plan.speech_duration
    plan = _cut(plan, refs, drop)
    tl = Timeline(refs, plan)
    speech = plan.speech_duration
    shift = speech - old_speech
    for g in plan.graphics:          # end card and full-length graphics follow the new length
        if g.start >= old_speech - 0.05:
            g.start, g.end = g.start + shift, g.end + shift
        elif g.end >= old_speech - 0.05:
            g.end = speech
    # 2. assets
    assets: dict[str, dict] = {}
    for spec in d.assets:
        spec = dict(spec)
        if photos and any(p.get("photo") is not None for p in spec.get("parts", [])):
            spec["photos"] = list(photos)
        a, err = kit.validate(spec)
        if err:
            problems.append(f"asset '{spec.get('id', '?')}': {err}")
            continue
        assets[a.id] = spec
    # 3. beats -> graphics
    fixed = [g for g in plan.graphics if g.type in ("logo_bug", "end_card", "lower_third", "progress_bar")]
    if style == "hype" and not any(g.type == "progress_bar" for g in fixed):
        fixed.append(Graphic(type="progress_bar", start=0.0, end=speech, reason="shows viewers how much is left"))
    if style in ("editorial", "cinematic", "profile"):
        fixed = [g for g in fixed if g.type != "progress_bar"]
    cta_card = next((g for g in plan.graphics if g.type == "fullscreen" and g.params.get("kind") == "cta"), None)
    out: list[Graphic] = []
    busy: list[tuple[float, float, str]] = []
    dirn = 1
    for i, b in enumerate(d.beats):
        tag = f"beat {i + 1} ({b.kind})"
        if not (tl.valid(b.start_word) and tl.valid(b.end_word)) or b.end_word < b.start_word:
            problems.append(f"{tag}: start_word/end_word must be word ids from the transcript, start before end")
            continue
        t0 = tl.start(b.start_word)
        t1 = tl.end(b.end_word)
        lead = 0.12 if b.kind in FULL_KINDS else (0.35 if b.kind in ("object", "machine") else 0.05)
        start = max(0.0, t0 - lead)
        end = min(speech, max(t1 + 0.15, start + MIN_LEN[b.kind]))
        if end - start > MAX_LEN[b.kind] + 0.5:
            adjust.append(f"{tag} shortened from {end - start:.1f} s to {MAX_LEN[b.kind]:.1f} s")
            end = start + MAX_LEN[b.kind]
        if end - start < MIN_LEN[b.kind] - 0.05:
            problems.append(f"{tag}: only {end - start:.1f} s long (needs {MIN_LEN[b.kind]} s); anchor it on more words")
            continue
        layer = "full" if b.kind in FULL_KINDS else ("behind" if b.kind == "text_behind" else "over")
        clash = next((x for x in busy if not (end <= x[0] + 0.05 or start >= x[1] - 0.05) and (layer == "full" or x[2] == "full" or x[2] == layer)), None)
        if clash and clash[1] - start <= 0.6 and start > clash[0]:
            # a small overlap with the beat before: hand over on this beat's first word
            prev = next(g_ for g_ in out if abs(g_.start - clash[0]) < 1e-6 and abs(g_.end - clash[1]) < 1e-6)
            if start - prev.start >= 0.8:
                prev.end = start
                busy[busy.index(clash)] = (clash[0], start, clash[2])
                clash = None
        if clash:
            problems.append(f"{tag} at {start:.1f}-{end:.1f} s overlaps another beat at {clash[0]:.1f}-{clash[1]:.1f} s; move it or drop one")
            continue

        def local(wid, at=None):
            if wid is not None and tl.valid(wid):
                return round(max(0.0, (tl.start(wid) or 0) - start), 3)
            return round(max(0.0, at or 0.0), 3)

        acts = []
        for a in b.actions:
            x = a.model_dump(exclude={"at_word", "until_word"})
            x["at"] = local(a.at_word, a.at)
            if a.until_word is not None:
                x["until"] = local(a.until_word)
            acts.append(x)
        g: Optional[Graphic] = None
        if b.kind in ("explainer", "object", "machine"):
            kind, ref = _asset_for(b, assets, library, machine, (brief or {}).get("_machines"))
            if kind is None:
                problems.append(f"{tag}: {ref}")
                continue
            if b.kind == "explainer":
                if kind == "builtin":
                    if ref not in BUILTIN_STAGES:
                        problems.append(f"{tag}: builtin stage '{ref}' does not exist (stages: {sorted(BUILTIN_STAGES)})")
                        continue
                    prm = {"kind": "stage", "stage": ref, "enter": "cut", "cap_y": 0.80, **b.stage_params}
                elif kind == "machine":
                    prm = {"kind": "stage", "stage": "machine", "machine": ref, "name": ref.get("name", ""), "sub": ref.get("tagline", ""), "enter": "cut", "cap_y": 0.80}
                    if ref.get("kit"):
                        prm = {"kind": "stage", "stage": "kit", "asset": ref["kit"], "actions": acts, "camera": b.camera, "focus": b.focus, "enter": "cut", "cap_y": 0.80}
                else:
                    if b.camera.startswith("detail") and b.camera != "detail" and not kit.built(ref).targets(b.camera.split(":", 1)[1]):
                        problems.append(f"{tag}: camera '{b.camera}' points at a part that is not in asset '{b.asset}'")
                        continue
                    prm = {"kind": "stage", "stage": "kit", "asset": ref, "actions": acts, "camera": b.camera if b.camera != "detail" else "orbit",
                           "focus": b.focus, "enter": "cut", "cap_y": 0.80}
                g = Graphic(type="fullscreen", start=start, end=end, params=prm, reason=b.reason or "full-screen 3D explainer")
            else:
                dirn = 1 if b.side == "right" else -1
                if kind == "builtin":
                    if ref not in BUILTIN_MODELS:
                        problems.append(f"{tag}: builtin object '{ref}' does not exist (objects: {sorted(BUILTIN_MODELS)})")
                        continue
                    prm = {"model": ref, "dir": dirn, "enter": "still" if ref == "brand" else b.enter, **b.stage_params}
                elif kind == "machine":
                    prm = {"model": "machine", "machine": ref, "name": ref.get("name", ""), "sub": ref.get("tagline", ""), "enter": b.enter, "dir": dirn, "label_at": 1.0}
                    if ref.get("kit"):
                        prm = {"model": "kit", "asset": ref["kit"], "actions": acts, "enter": b.enter, "dir": dirn}
                else:
                    prm = {"model": "kit", "asset": ref, "actions": acts, "enter": b.enter, "dir": dirn}
                g = Graphic(type="model3d", start=start - 0.3 if b.enter != "still" else start, end=end, params=prm, reason=b.reason or "3D object over the shot")
        elif b.kind == "text_behind":
            lines = [x.upper() for x in (b.lines or [])][:2]
            if not lines:
                problems.append(f"{tag}: needs 1-2 short lines")
                continue
            if any(len(x) > 14 for x in lines):
                problems.append(f"{tag}: lines must be short (max ~12 letters each), got {lines}")
                continue
            g = Graphic(type="text_behind", start=start + 0.05, end=end, params={"lines": lines, "y": 0.335, "size": 340, "colors": ["#FFFFFF", "accent"]},
                        reason=b.reason or "title behind the speaker")
        elif b.kind == "number":
            if b.value is None:
                problems.append(f"{tag}: needs 'value' (a number that is spoken)")
                continue
            fmt = lambda x: f"{x:g}"
            txt = f"{b.prefix}{fmt(b.value)}" + (f"–{fmt(b.value_to)}" if b.value_to is not None else "") + b.suffix
            if style == "hype":
                g = Graphic(type="fullscreen", start=start, end=min(end, start + 2.0), params={"kind": "statement", "lines": [txt] + ([b.label] if b.label else []), "highlight": [txt], "enter": "cut", "cap_y": 0.74},
                            reason=b.reason or "bold number card")
            elif style == "minimal":
                g = Graphic(type="fullscreen", start=start, end=end, params={"kind": "big_text", "text": txt, "sub": b.label, "size": 300, "width": 0.7, "y": 0.38, "look": "light",
                                                                            "enter": "cut", "cap_y": 0.72, "color": "dark"}, reason=b.reason or "clean number card")
            else:
                prm = {"model": "text", "enter": "rise", "kind": "big_text", "sub": b.label, "arrows": True, "y": 0.36, "dir": dirn}
                if b.value_to is not None:
                    prm.update(text=txt, size3d=1.7, size=300, width=0.72)
                else:
                    prm.update(count_to=b.value, decimals=0 if float(b.value).is_integer() else 1, prefix=b.prefix, suffix=b.suffix, size3d=2.0, size=400)
                g = Graphic(type="model3d", start=start - 0.3, end=end, params=prm, reason=b.reason or "3D number")
                dirn = -dirn
        elif b.kind == "statement":
            if not b.lines:
                problems.append(f"{tag}: needs 'lines'")
                continue
            g = Graphic(type="fullscreen", start=start, end=end, params={"kind": "statement", "lines": b.lines[:3], "highlight": b.highlight, "enter": "cut", "cap_y": 0.74},
                        reason=b.reason or "statement card")
        elif b.kind == "chapter":
            g = Graphic(type="fullscreen", start=start, end=end, params={"kind": "chapter", "number": b.number or "", "title": b.title or (b.lines[0] if b.lines else ""), "enter": "cut", "cap_y": 0.86},
                        reason=b.reason or "chapter card")
        elif b.kind == "list":
            if not 2 <= len(b.items) <= 3:
                problems.append(f"{tag}: a list needs 2-3 items")
                continue
            its = [{"label": it.label, "at": local(it.at_word, k * 0.4)} for k, it in enumerate(b.items)]
            g = Graphic(type="fullscreen", start=start, end=end, params={"kind": "shapes", "items": its, "cap_y": 0.66, "dir": dirn}, reason=b.reason or "list")
        elif b.kind == "diagram":
            if not 2 <= len(b.nodes) <= 6:
                problems.append(f"{tag}: a diagram needs 2-6 nodes")
                continue
            ids = {n.id for n in b.nodes}
            bad = [f"{l.from_}->{l.to}" for l in b.links if l.from_ not in ids or l.to not in ids]
            if bad:
                problems.append(f"{tag}: links point at unknown nodes {bad}")
                continue
            from ..draw import icon_names
            icons = set(icon_names())
            nodes = [{"id": n.id, "label": n.label, "sub": n.sub, "icon": n.icon if n.icon in icons else None, "color": n.color or "primary", "at": local(n.at_word, 0.3 + k * 0.5)}
                     for k, n in enumerate(b.nodes)]
            links = [{"from": l.from_, "to": l.to, "label": l.label, "kind": l.kind, **({"at": local(l.at_word)} if l.at_word is not None else {})} for l in b.links]
            g = Graphic(type="fullscreen", start=start, end=end, params={"kind": "diagram", "title": b.title, "nodes": nodes, "links": links, "layout": b.layout,
                                                                        "look": b.look, "enter": "cut", "cap_y": 0.80}, reason=b.reason or "explainer diagram")
        if g is None:
            continue
        if g.type == "fullscreen":
            if b.transition_in:
                g.params["enter"] = b.transition_in
            if b.transition_out:
                g.params["exit"] = b.transition_out
            if b.transition_in or b.transition_out:
                g.params["transition_by"] = "director"     # the style's defaults leave it alone
        if b.sound != "auto":
            g.params["sound"] = b.sound
        out.append(g)
        busy.append((g.start, g.end, layer))
    # 4. assemble, then the style's own finishing
    plan.graphics = sorted(fixed + out + ([cta_card] if cta_card else []), key=lambda g: g.start)
    for g in plan.graphics:     # brand colours for the kit objects
        if g.params.get("asset") is not None:
            g.params["brand"] = brand or {}
    plan.captions.emphasis = list(dict.fromkeys([e for e in d.emphasis if e] + list(brief.get("keywords") or [])))[:24]
    ST.finish_for(style, plan, brief, profile)
    apply_sound(plan, d.sound_level)
    if d.pace:
        pace = max(1.2, min(8.0, float(d.pace)))
        kept, last = [], -10.0
        for x in plan.edit.get("punches", []):
            if x["t"] == 0 or x["t"] - last >= pace * 0.8:
                kept.append(x)
                last = x["t"]
        plan.edit["punches"] = kept
    if d.headline:
        plan.metadata = dict(plan.metadata or {}, headline=d.headline)
    if d.metadata:
        plan.metadata = dict(plan.metadata or {}, **{k: v for k, v in d.metadata.items() if k in ("title", "caption", "hashtags", "description")})
    plan.notes = [f"Edit planned by Claude: {len(out)} beats" + (f", {len(drop)} words cut" if drop else "")] + d.notes[:8]
    plan.clamp_graphics()
    Plan.model_validate(plan.model_dump())
    return plan.model_dump(), problems, adjust


def apply_sound(plan: Plan, level: str = "minimal") -> None:
    """Sound effects after the style finishing: a beat marked sound 'none' is silent, 'accent' is lifted 3 dB (the one moment
    that should be felt), and the 'minimal' level keeps one soft sound per moment (no taps or dings on small moves) 2 dB lower."""
    edit = plan.edit or {}
    sfx = list(edit.get("sfx") or [])
    if not sfx:
        return
    moments = [g for g in plan.graphics if g.type in ("fullscreen", "model3d", "text_behind")]
    keep = []
    for e in sfx:
        g = next((x for x in moments if x.start - 0.5 <= e["t"] <= x.start + 1.2), None)
        how = (g.params.get("sound") if g is not None else None) or "auto"
        if how == "none":
            continue
        e = dict(e)
        if how == "accent":
            e["gain_db"] = min(-1.0, float(e.get("gain_db", -6)) + 3)
        elif level == "minimal":
            if e.get("kind") in ("tap", "ding", "tick", "pop") and g is not None and g.params.get("model") != "brand":
                continue
            e["gain_db"] = float(e.get("gain_db", -6)) - 2
        keep.append(e)
    edit["sfx"] = keep
    plan.edit = edit


def summarize_direction(plan: dict, direction: dict) -> list[dict]:
    """The steps list for the review screen: what happens when, and why."""
    from ..planner import TYPE_WORDS, _clock
    steps = []
    for g in plan.get("graphics", []):
        p = g.get("params", {})
        name = p.get("title") or (p.get("asset") or {}).get("name") or p.get("stage") or p.get("model") or " / ".join(p.get("lines") or []) or p.get("text") or ""
        if g["type"] in ("logo_bug", "progress_bar"):
            continue
        what = TYPE_WORDS.get(g["type"], g["type"])
        if g["type"] == "fullscreen":
            what = {"stage": "full-screen 3D explainer", "diagram": "full-screen diagram", "statement": "statement card", "chapter": "chapter card",
                    "shapes": "list", "big_text": "number card", "cta": "end card"}.get(p.get("kind"), what)
        steps.append({"at": _clock(g["start"]), "what": f"{what}" + (f": {name}" if name else "") + (f" — {g.get('reason')}" if g.get("reason") else "")})
    return steps
