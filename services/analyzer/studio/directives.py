"""Edit directives: the small, safe vocabulary every change request is turned into.

Suggestions (before the edit) and approver replies (after it) are parsed into these operations,
either by the rule-based parser below or by Claude. The planner applies them deterministically.
"""
from __future__ import annotations

import re

ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "last": -1}
COLORS = {"yellow": "#FFD60A", "white": "#FFFFFF", "green": "#2EE59D", "orange": "#F39C1A", "red": "#FF4D4D", "blue": "#3DA5FF",
          "teal": "#18A689", "pink": "#FF5FA2", "black": "#000000"}

OP_TYPES = {"music", "captions", "logo", "end_card", "headline", "trim", "remove_line", "remove_line_text", "use_take", "target_length",
            "pace", "graphics_density", "remove_graphic", "add_keyword", "lower_third", "note", "cta"}


def _num(s: str) -> float:
    return float(s)


def _ordinal(word: str) -> int | None:
    word = word.lower()
    if word in ORDINALS:
        return ORDINALS[word]
    m = re.match(r"(\d+)(st|nd|rd|th)?$", word)
    return int(m.group(1)) if m else None


def parse(text: str) -> tuple[list[dict], list[str]]:
    """Returns (ops, unhandled sentences)."""
    ops: list[dict] = []
    unhandled: list[str] = []
    # protect quoted text ("Stop guessing. Start measuring.") from the sentence splitter
    quotes: list[str] = []

    def _keep(m):
        quotes.append(m.group(0))
        return f"\x00{len(quotes) - 1}\x00"
    text = re.sub(r'"[^"\n]{1,200}"|“[^”\n]{1,200}”|\'[^\'\n]{2,200}\'(?=\W|$)', _keep, text)
    parts = [p.strip() for p in re.split(r"(?<=[.!?\n])\s+|\s*;\s*|\n+|\s+and also\s+|,\s+(?=(?:and\s+)?(?:make|remove|cut|use|add|no|change|put|move|set|keep)\b)", text) if p and p.strip()]
    parts = [re.sub(r"\x00(\d+)\x00", lambda m: quotes[int(m.group(1))], p) for p in parts]
    for raw in parts:
        s = raw.lower().strip(" .!")
        before = len(ops)
        # ---- music
        if re.search(r"\b(no|remove|without|drop|delete)\b.*\bmusic\b|\bmusic\b.*\b(off|remove)\b", s):
            ops.append({"op": "music", "action": "remove"})
        elif re.search(r"\bmusic\b.*\b(louder|up|higher)\b|\b(louder|raise)\b.*\bmusic\b", s):
            ops.append({"op": "music", "action": "volume", "delta_db": 4})
        elif re.search(r"\bmusic\b.*\b(softer|lower|quieter|down)\b|\b(softer|lower|quieter|reduce)\b.*\bmusic\b", s):
            ops.append({"op": "music", "action": "volume", "delta_db": -4})
        # ---- captions
        if re.search(r"\b(no|remove|without|hide)\b.*\b(captions?|subtitles?)\b", s):
            ops.append({"op": "captions", "enabled": False})
        else:
            if re.search(r"\b(bigger|larger)\b.*\b(captions?|subtitles?|text)\b|\b(captions?|subtitles?)\b.*\b(bigger|larger)\b", s):
                ops.append({"op": "captions", "scale": 1.15})
            if re.search(r"\bsmaller\b.*\b(captions?|subtitles?)\b|\b(captions?|subtitles?)\b.*\bsmaller\b", s):
                ops.append({"op": "captions", "scale": 0.87})
            if re.search(r"\b(captions?|subtitles?)\b.*\b(higher|up)\b|\bmove\b.*\b(captions?|subtitles?)\b.*\bup\b", s):
                ops.append({"op": "captions", "position_delta": -0.04})
            if re.search(r"\b(captions?|subtitles?)\b.*\b(lower|down)\b", s) and "lowercase" not in s:
                ops.append({"op": "captions", "position_delta": 0.03})
            m = re.search(r"\b(highlight|spoken word|current word|captions?)\b.*\b(" + "|".join(COLORS) + r")\b", s)
            if m and "caption" in s or (m and "highlight" in s):
                ops.append({"op": "captions", "highlight": COLORS[m.group(2)]})
            if re.search(r"\blower ?case\b|\bnot (in )?(all )?caps\b", s):
                ops.append({"op": "captions", "uppercase": False})
        # ---- logo
        if re.search(r"\b(no|remove|hide|without)\b.*\blogo\b", s):
            ops.append({"op": "logo", "action": "remove"})
        elif re.search(r"\b(bigger|larger)\b.*\blogo\b|\blogo\b.*\b(bigger|larger)\b", s):
            ops.append({"op": "logo", "action": "scale", "scale": 1.25})
        elif re.search(r"\bsmaller\b.*\blogo\b|\blogo\b.*\bsmaller\b", s):
            ops.append({"op": "logo", "action": "scale", "scale": 0.8})
        # ---- end card / cta
        if re.search(r"\b(no|remove|without|drop)\b.*\bend ?(card|screen)\b", s):
            ops.append({"op": "end_card", "action": "remove"})
        m = re.search(r"\b(cta|call to action|end card text|end card)\b[^\"'“”]*[\"'“”](.+?)[\"'“”]", raw, re.I)
        if m:
            ops.append({"op": "cta", "text": m.group(2).strip()})
        # ---- headline
        m = re.search(r"\b(headline|title|hook text|top text)\b[^\"'“”]*[\"'“”](.+?)[\"'“”]", raw, re.I)
        if m:
            ops.append({"op": "headline", "action": "set", "text": m.group(2).strip()})
        elif re.search(r"\b(no|remove|without)\b.*\b(headline|title|top text)\b", s):
            ops.append({"op": "headline", "action": "remove"})
        # ---- trims
        m = re.search(r"\b(cut|remove|trim|drop)\b.*\b(first|last|opening|final)\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)\b", s)
        if m:
            ops.append({"op": "trim", "where": "start" if m.group(2) in ("first", "opening") else "end", "seconds": _num(m.group(3))})
        m = re.search(r"\b(remove|cut|drop|delete)\b\s+(?:the\s+)?(\w+)\s+(line|sentence|part)\b", s)
        if m and _ordinal(m.group(2)) is not None and not re.search(r"\bseconds?\b", s):
            ops.append({"op": "remove_line", "index": _ordinal(m.group(2))})
        m = re.search(r"\b(remove|cut|drop|delete)\b.*\b(line|part|bit|sentence)\b.*\b(about|where|that says|saying|with)\b\s+[\"'“”]?(.+?)[\"'“”]?$", raw.strip(" ."), re.I)
        if m:
            q = re.search(r"[\"'“”‘’](.+?)[\"'“”‘’]", raw)
            ops.append({"op": "remove_line_text", "text": (q.group(1) if q else m.group(4)).strip(" '\"")})
        m = re.search(r"\buse\b\s+take\s+(\d+)\s+for\s+(?:the\s+)?(\w+)\s+(line|sentence|part)", s)
        if m and _ordinal(m.group(2)) is not None:
            ops.append({"op": "use_take", "take": f"T{m.group(1)}", "line": _ordinal(m.group(2))})
        # ---- length / pace / density
        m = re.search(r"\b(under|below|max(?:imum)?|at most|shorter than|to)\s+(\d+)\s*(s|sec|secs|seconds?)\b", s)
        if m and re.search(r"\b(shorter|length|long|under|keep it|make it|cut it|trim it)\b", s):
            ops.append({"op": "target_length", "seconds": _num(m.group(2))})
        elif re.search(r"\b(shorter|too long|tighter)\b", s) and not re.search(r"\bpause", s):
            ops.append({"op": "target_length", "seconds": -0.8})
        if re.search(r"\b(faster|more energ|snappier|quicker cuts?|more dynamic)\b", s):
            ops.append({"op": "pace", "value": "faster"})
        elif re.search(r"\b(slower|calmer|less cuts|fewer cuts|too many cuts|less zoom)\b", s):
            ops.append({"op": "pace", "value": "slower"})
        if re.search(r"\b(more|extra)\b.*\b(graphics|animations?|motion|visuals)\b", s):
            ops.append({"op": "graphics_density", "value": "more"})
        elif re.search(r"\b(less|fewer|too many|reduce)\b.*\b(graphics|animations?|pop-?ups|text pops?|motion)\b", s):
            ops.append({"op": "graphics_density", "value": "less"})
        if re.search(r"\b(no|remove)\b.*\b(progress bar)\b", s):
            ops.append({"op": "remove_graphic", "type": "progress_bar"})
        if re.search(r"\b(no|remove)\b.*\b(intro|wipe|opening animation)\b", s):
            ops.append({"op": "remove_graphic", "type": "intro_wipe"})
        m = re.search(r"\b(highlight|show|pop up|emphasi[sz]e)\b\s+(?:the\s+)?(?:word\s+)?[\"'“”](.+?)[\"'“”]", raw, re.I)
        if m:
            ops.append({"op": "add_keyword", "text": m.group(2).strip()})
        m = re.search(r"\b(?:name|lower third)\b[^\"'“”]*[\"'“”](.+?)[\"'“”](?:[^\"'“”]*[\"'“”](.+?)[\"'“”])?", raw, re.I)
        if m and "name" in s:
            ops.append({"op": "lower_third", "name": m.group(1).strip(), "role": (m.group(2) or "").strip()})
        if len(ops) == before and re.search(r"\w", s) and not re.fullmatch(r"(thanks?|thank you|cheers|regards|best|hi|hello|ok(ay)?|looks? (nice|good|great|fine)|great( work| job)?|nice( work| job)?|love it|good work|well done)[\w\s,!]*", s):
            unhandled.append(raw.strip())
    return ops, unhandled


def validate_ops(ops: list) -> list[dict]:
    """Keeps only well-formed operations (used for Claude's output too)."""
    out = []
    for o in ops if isinstance(ops, list) else []:
        if isinstance(o, dict) and o.get("op") in OP_TYPES:
            out.append({k: v for k, v in o.items() if isinstance(v, (str, int, float, bool)) or v is None})
    return out
