"""Optional Claude layer. Every output is validated; anything invalid is dropped and the deterministic result stands."""
from __future__ import annotations

import base64
import json
import os
import re

import httpx

from . import directives
from .draw import icon_names
from .schema import Graphic, Plan

API = "https://api.anthropic.com/v1/messages"


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _model() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")


def call(system: str, content, max_tokens: int = 3000, timeout: float = 120) -> str:
    r = httpx.post(API, timeout=timeout, headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"},
                   json={"model": _model(), "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": content}]})
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")


def extract_json(text: str):
    m = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.S)
    raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1] if "{" in text else text
    return json.loads(raw)


def _numbers(s: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", s))


# ---------------------------------------------------------------- motion graphics
GRAPHIC_SPEC = """Allowed graphic types and params (times are OUTPUT seconds):
- keyword_pop: {"text": <=3 words, "icon"?: icon name, "color"?: "accent"|"primary"|"alert"}  top of frame, 1.4-2.4 s
- icon_callout: {"icon": icon name, "text": 1-2 words}  right side, 1.6-2.6 s
- stat_counter: {"value": number, "prefix"?: "₹"|"$", "suffix"?: "%"|"x"|" L"|" Cr"|"K", "label": <=6 words}  only for numbers actually said, 2.2-3.4 s
- bullet_list: {"title": <=4 words, "items": 2-4 short items (<=5 words), "item_times": [output time each item appears]}  switches to split layout, 3-10 s
- process_flow: {"title": <=4 words, "steps": [{"label": <=4 words, "icon": icon name}] 2-4 steps, "item_times": [...]}  split layout, 4-12 s
- cta_banner: {"text": <=5 words, "icon"?: icon name}  mid-lower, 2-3 s
Rules: never two top-of-frame graphics at once; nothing in the top area while the headline is visible; leave at least 0.3 s between graphics;
graphics start on the word they illustrate; only use numbers that are spoken; keep text short, concrete and in the speaker's words;
a split-layout graphic needs a sentence or more of explanation to sit on; do not cover the first 0.6 s except the headline."""


def enrich_motion(plan_dict: dict, brief: dict, rules: list[dict], suggestions: list[str]) -> tuple[dict, list[str]]:
    """Claude replaces the content graphics of a motion plan. Returns (plan, notes)."""
    plan = Plan.model_validate(plan_dict)
    words = plan.output_words()
    lines: dict[int, list] = {}
    for w in words:
        lines.setdefault(w["line"], []).append(w)
    transcript = "\n".join(f"[{ws[0]['start']:.2f}-{ws[-1]['end']:.2f}] " + " ".join(f"{x['text']}@{x['start']:.2f}" for x in ws) for ws in sorted(lines.values(), key=lambda v: v[0]["start"]))
    keep_types = {"hook_title", "logo_bug", "lower_third", "end_card", "progress_bar", "intro_wipe", "image_card"}
    fixed = [g for g in plan.graphics if g.type in keep_types]
    system = ("You are a senior motion designer for short business videos (Instagram Reels, YouTube Shorts). "
              "You plan on-screen graphics that help viewers understand and remember the message. Reply with JSON only.")
    user = f"""Video length (speech): {plan.speech_duration:.2f} s. Format {plan.format.aspect}.
Brief: {json.dumps({k: brief.get(k) for k in ('title', 'headline', 'keywords', 'glossary', 'cta', 'notes') if brief.get(k)})}
Fixed graphics already placed (do not repeat): {json.dumps([{'type': g.type, 'start': round(g.start, 2), 'end': round(g.end, 2)} for g in fixed])}
Data rules from past performance: {json.dumps([{'rule': r.get('code'), 'text': r.get('text', '')} for r in rules])}
Team suggestions (follow them first): {json.dumps(suggestions)}
Icons available: {', '.join(icon_names())}

{GRAPHIC_SPEC}

Transcript (word@start time):
{transcript}

Return {{"graphics": [{{"type": ..., "start": ..., "end": ..., "params": {{...}}, "reason": "<=12 words"}}], "headline": <better headline or null>, "notes": [..]}}"""
    data = extract_json(call(system, user, 3000))
    spoken = " ".join(w["text"] for w in words)
    allowed_nums = _numbers(spoken) | {str(int(float(n))) for n in _numbers(spoken)}
    icons = set(icon_names())
    out = []
    for g in data.get("graphics", []):
        try:
            gg = Graphic.model_validate(g)
        except Exception:  # noqa: BLE001
            continue
        if gg.type not in {"keyword_pop", "icon_callout", "stat_counter", "bullet_list", "process_flow", "cta_banner"}:
            continue
        if gg.end > plan.speech_duration + 0.01 or gg.start < 0.5:
            continue
        txt = json.dumps(gg.params)
        if gg.type == "stat_counter":
            v = str(gg.params.get("value", ""))
            if v not in allowed_nums and v.rstrip("0").rstrip(".") not in allowed_nums:
                continue  # never invent a number
        if _numbers(re.sub(r'"(value|item_times|start|end)":\s*[^,}\]]+|\[[0-9.,\s]+\]', "", txt)) - allowed_nums:
            continue
        for key in ("icon",):
            if key in gg.params and gg.params[key] not in icons:
                gg.params[key] = "sparkles"
        for st in gg.params.get("steps", []) if isinstance(gg.params.get("steps"), list) else []:
            if isinstance(st, dict) and st.get("icon") not in icons:
                st["icon"] = "circle-check"
        out.append(gg)
    # remove overlaps (keep the earlier graphic)
    out.sort(key=lambda g: g.start)
    clean: list[Graphic] = []
    for g in out:
        if clean and g.start < clean[-1].end + 0.3:
            continue
        hook = next((h for h in fixed if h.type == "hook_title"), None)
        if hook and g.type in ("keyword_pop", "stat_counter") and g.start < hook.end:
            continue
        clean.append(g)
    if not clean:
        return plan_dict, ["Claude's graphics did not pass validation; the automatic graphics were kept"]
    plan.graphics = fixed + clean
    if data.get("headline") and not brief.get("headline"):
        for g in plan.graphics:
            if g.type == "hook_title":
                g.params["text"] = str(data["headline"])[:90]
    plan.clamp_graphics()
    notes = [str(n) for n in data.get("notes", [])][:5]
    return plan.model_dump(), notes


# ---------------------------------------------------------------- change requests
OPS_DOC = """Operations (JSON objects):
{"op":"music","action":"remove"} | {"op":"music","action":"volume","delta_db":+4 or -4}
{"op":"captions","enabled":false} | {"op":"captions","scale":1.15} | {"op":"captions","position_delta":-0.04} | {"op":"captions","highlight":"#RRGGBB"} | {"op":"captions","uppercase":false}
{"op":"logo","action":"remove"} | {"op":"logo","action":"scale","scale":1.25}
{"op":"end_card","action":"remove"} | {"op":"cta","text":"..."}
{"op":"headline","action":"set","text":"..."} | {"op":"headline","action":"remove"}
{"op":"trim","where":"start"|"end","seconds":2}
{"op":"remove_line","index":3}  (1-based line number from the list; -1 = last) | {"op":"remove_line_text","text":"words from that line"}
{"op":"use_take","line":2,"take":"T1"}
{"op":"target_length","seconds":30}
{"op":"pace","value":"faster"|"slower"}
{"op":"graphics_density","value":"more"|"less"}
{"op":"remove_graphic","type":"keyword_pop"|"icon_callout"|"stat_counter"|"process_flow"|"progress_bar"|"intro_wipe"|"lower_third","text"?:"..."}
{"op":"add_keyword","text":"phrase that is spoken"}
{"op":"lower_third","name":"...","role":"..."}
{"op":"note","text":"anything that cannot be expressed above"}"""


def parse_request(text: str, context: dict) -> tuple[list[dict], list[str]]:
    """Turns a suggestion or an approver's change request into operations. Rule-based first; Claude for the rest."""
    ops, unhandled = directives.parse(text)
    if not unhandled or not available():
        return ops, unhandled
    system = "You convert video edit requests into a fixed list of operations. Reply with JSON only."
    user = f"""Video lines: {json.dumps(context.get('lines', []))}
Takes available: {json.dumps(context.get('takes', []))}
Already understood: {json.dumps(ops)}
{OPS_DOC}
Request text: {json.dumps(' '.join(unhandled))}
Return {{"ops": [...], "unhandled": ["parts you cannot express"]}}"""
    try:
        data = extract_json(call(system, user, 1200))
        extra = directives.validate_ops(data.get("ops", []))
        return ops + [o for o in extra if o["op"] != "note"], [str(x) for x in data.get("unhandled", [])] + [o["text"] for o in extra if o["op"] == "note" and o.get("text")]
    except Exception:  # noqa: BLE001
        return ops, unhandled


# ---------------------------------------------------------------- approval replies
_APPROVE = re.compile(r"\b(approved?|approve it|yes,? (go|publish|post)|looks (good|great)|good to go|go ahead|publish( it)?|ship it|lgtm|perfect|all good|ok(ay)? to (post|publish))\b", re.I)
_REJECT = re.compile(r"\b(not approved?|don'?t (publish|post)|do not (publish|post)|reject(ed)?|cancel|scrap (it|this)|no,? (don'?t|do not)|disapprove)\b", re.I)
_VERSION = re.compile(r"\b(?:version|option|video|approve|approved|go with|use|publish|post)\s+([a-h1-8])\b|\bv([1-8])\b|\b([a-h])\b(?=\s*(?:is|please|version|$))|\b(clean|branded|motion|overlay|floating|editorial|hype|cinematic|minimal)\b", re.I)


def strip_quoted(body: str) -> str:
    lines = []
    for ln in body.replace("\r\n", "\n").split("\n"):
        if re.match(r"^\s*>", ln) or re.match(r"^\s*On .+wrote:\s*$", ln) or re.match(r"^-{2,}\s*Original Message", ln, re.I) or re.match(r"^\s*From:\s", ln):
            break
        lines.append(ln)
    return "\n".join(lines).strip()


def classify_reply(body: str) -> dict:
    text = strip_quoted(body)
    t = text.lower()
    version = None
    style_word = None
    m = _VERSION.search(t)
    if m:
        v = (m.group(1) or m.group(2) or m.group(3) or m.group(4) or "").lower()
        version = ({str(i + 1): L for i, L in enumerate("ABCDEFGH")} | {L.lower(): L for L in "ABCDEFGH"}).get(v)
        style_word = {"floating": "overlay", "3d": "editorial", "explainer": "editorial"}.get(v, v) if not version and v else None
    rej = bool(_REJECT.search(t))
    app = bool(_APPROVE.search(t)) and not rej and not re.search(r"\bnot\s+approv", t)
    ops, unhandled = directives.parse(text)
    change_words = bool(ops) or bool(re.search(r"\b(change|make|remove|cut|add|replace|instead|bigger|smaller|shorter|louder|softer|move|fix)\b", t))
    if rej:
        decision = "reject"
    elif change_words and not (app and not ops):
        decision = "changes"
    elif app:
        decision = "approve"
    else:
        decision = "unclear"
    result = {"decision": decision, "version": version, "style": style_word, "text": text, "ops": ops, "unhandled": unhandled, "by": "rules"}
    if decision == "unclear" and available():
        try:
            data = extract_json(call("You read replies to a video approval email. Reply with JSON only.",
                                     f"""Reply: {json.dumps(text)}
The email offered several versions labelled with letters (A, B, C, ...).
Return {{"decision": "approve"|"reject"|"changes"|"unclear", "version": "A"|"B"|"C"|"D"|"E"|"F"|null, "changes": "the requested changes in plain words or empty"}}""", 400))
            if data.get("decision") in ("approve", "reject", "changes", "unclear"):
                result.update(decision=data["decision"], version=data.get("version") or version, by="claude")
                if data.get("changes"):
                    result["text"] = data["changes"]
        except Exception:  # noqa: BLE001
            pass
    return result


# ---------------------------------------------------------------- on-camera scoring
def score_takes_on_camera(frames: dict[str, list[str]]) -> dict[str, float]:
    """Claude looks at a few frames per take and rates on-camera delivery 0-10 (framing, eye contact, expression, product visible)."""
    if not available():
        return {}
    content = []
    for take_id, paths in frames.items():
        content.append({"type": "text", "text": f"Take {take_id}:"})
        for p in paths[:4]:
            with open(p, "rb") as f:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(f.read()).decode()}})
    content.append({"type": "text", "text": 'Rate each take 0-10 for on-camera delivery (framing, eye contact, expression, focus, product clearly visible). Return {"scores": {"<take>": n}, "notes": {"<take>": "<=10 words"}}'})
    try:
        data = extract_json(call("You are a video director choosing the best take. Reply with JSON only.", content, 600))
        return {k: max(0.0, min(10.0, float(v))) for k, v in data.get("scores", {}).items()}
    except Exception:  # noqa: BLE001
        return {}
