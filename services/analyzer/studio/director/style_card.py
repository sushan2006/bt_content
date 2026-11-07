"""Style cards: Claude watches a reference video (frames + the engine's measurements) and writes down its style once.

The card is stored with the style. When the style is chosen for a new video the card is given to Claude when it plans
the edit, and its numbers (cut rhythm, grade, captions, letterbox, grain, sound levels) drive the renderer.
"""
from __future__ import annotations

import json
import os
from typing import Callable

from . import claude as C
from . import frames as F

GRADES = ("warm", "cool", "punchy", "teal_orange", "clean")
CAPTION_MODES = ("classic", "kinetic", "box", "subtle", "soft")
BASES = ("explainer3d", "hype", "cinematic", "minimal")
TRANSITIONS = ("cut", "whip", "fade", "zoom")

SYSTEM = """You are a senior video editor and motion designer. You study reference videos frame by frame and write precise style guides
that another editor can follow to make a different video feel the same: the same rhythm, the same kind of graphics and motion, the same
transitions, the same look and the same sound. The guide is used to edit vertical talking-to-camera videos for an engineering company.
The rendering engine offers:
- base styles: explainer3d (cuts to full-screen 3D explainers, 3D objects rising behind the speaker), hype (jump cuts ~2 s, zoom pulses,
  boxed captions, statement cards), cinematic (letterbox, film grade, chapter cards, slow push-ins), minimal (calm cuts, soft captions, clean cards)
- transitions into and out of full-screen graphics: cut | whip (fast slide with motion blur) | fade (short dissolve) | zoom (scales in while it fades)
- grades: warm | cool | punchy | teal_orange | clean; caption modes: classic | kinetic (1-3 words pop, key words big) | box (boxed words) | subtle | soft
- beat kinds: explainer (full-screen 3D), object (3D over the speaker), machine (the company's own machine in 3D), text_behind (huge words behind
  the speaker), number, statement, list, chapter, diagram
- sound: soft generated effects (air, whoosh, tap, thump, ding) at chosen gains, a music bed or licensed track ducked under the voice.
Describe what you SEE, then map it to the engine. Where the reference does something the engine cannot do, say so and give the closest
engine choice. Reply with JSON only."""


CARD_FORMAT = """{
 "name": "...", "summary": "one sentence a colleague would recognise the style by",
 "base": "explainer3d|hype|cinematic|minimal",
 "pacing": {"cut_every": <seconds between cuts or framing changes>, "leave_speaker_every": <seconds between full-screen moments, or null>,
            "graphic_hold": <typical seconds a full-screen graphic stays>, "speaker_hold": <typical seconds back on the speaker>,
            "rhythm": "how the pace builds or changes through the video", "notes": "..."},
 "transitions": {"between_shots": "what happens at a normal cut (hard cut on a word, jump cut, punch-in, whip ...)",
                 "into_graphics": "exactly how a full-screen graphic arrives", "out_of_graphics": "exactly how it goes back to the speaker",
                 "duration_s": <typical length of a transition>, "easing": "e.g. fast start, soft landing",
                 "engine_in": "cut|whip|fade|zoom", "engine_out": "cut|whip|fade|zoom", "notes": "what makes them feel smooth"},
 "motion_graphics": {"used_for": ["what kinds of moments get a graphic"], "not_used_for": ["moments that stay on the speaker"],
                     "per_minute": <full-screen or overlay graphics per minute>, "how_they_enter": "...", "how_they_move": "camera moves, builds, counts ...",
                     "how_they_leave": "...", "depth": "flat 2D | 2.5D | full 3D", "signature_effects": ["the 1-3 moves that make people say wow"],
                     "kinds": ["explainer", "object", "statement", ...]},
 "graphics": {"look": "colours, materials, lighting, background of the graphics", "motion": "one line summary"},
 "typography": {"font_feel": "geometric sans, condensed, serif ...", "weight": "...", "case": "upper|title|sentence", "notes": "..."},
 "captions": {"mode": "classic|kinetic|box|subtle|soft", "position": <0.55-0.86 fraction of height>, "highlight": "#RRGGBB", "uppercase": true, "notes": "..."},
 "look": {"grade": "warm|cool|punchy|teal_orange|clean", "palette": ["#RRGGBB", ...], "letterbox": <0-0.1>, "grain": <0-0.15>, "contrast": "low|medium|high", "notes": "..."},
 "sound": {"music": "genre, energy, how loud under the voice", "sfx": "what effects, how often, how loud", "sfx_kinds": ["air|whoosh|tap|thump|ding"],
           "sfx_per_min": <number>, "sfx_db": <-24..-10>, "music_db": <-28..-16>},
 "replicate": ["8-14 concrete instructions for the director, each one specific and checkable, e.g. 'leave the speaker for a full-screen 3D shot every 6-8 s, hold it 3 s, zoom in, cut back'"],
 "do": ["..."], "dont": ["..."],
 "signature_moments": [{"t": <seconds>, "what": "what happens and why it works"}],
 "engine_gaps": ["things the reference does that the engine cannot do, with the closest substitute"]
}"""


def make_card(video_path: str, measured: dict, name: str, work_dir: str, log: Callable[[str], None] = lambda m: None,
              model: str = "claude-sonnet-5-5", budget_usd: float = 1.2) -> dict:
    usage = C.Usage(budget_usd)
    cl = C.Claude(usage, log)
    m = measured.get("measured") or {}
    dur = m.get("duration")
    sheets = F.video_sheets(video_path, os.path.join(work_dir, "frames"), n=24, per_sheet=8, duration=dur)
    cuts = F.transition_sheets(video_path, list(m.get("cuts") or []), os.path.join(work_dir, "cuts"), max_cuts=8, duration=dur)
    blocks = [C.text_block(f"Reference video '{name}'. The engine measured (cuts in seconds, picture, captions, sound):\n"
                           + json.dumps({"base": measured.get("base"), "params": measured.get("params"), "report": measured.get("report"),
                                         "duration": dur, "cuts": (m.get("cuts") or [])[:80], "face_on_screen": m.get("face_ratio"),
                                         "picture": m.get("picture"), "captions": m.get("captions"), "sound": m.get("sound")}, indent=1)
                           + "\n\nOverview: frames spread over the whole video (times in seconds):")]
    blocks += [C.image_block(s, 1400) for s in sheets]
    if cuts:
        blocks.append(C.text_block("Transitions: each row is five frames around one cut (0.20 s and 0.07 s before, the cut, 0.07 s and 0.20 s after). "
                                   "Read them to see exactly how the shot changes: a hard cut looks identical until the cut frame; a dissolve shows both "
                                   "pictures mixed; a whip shows motion blur; a zoom shows the picture scaling; a slide or mask shows edges moving."))
        blocks += [C.image_block(s, 1400) for s in cuts]
    blocks.append(C.text_block(
        "Analyse everything that makes this video look and feel the way it does, so it can be replicated on our own talking videos:\n"
        "1. Cutting and pacing: how often it cuts, how long it stays on the speaker and on graphics, how the rhythm changes.\n"
        "2. Transitions: between speaker shots, into and out of graphics, their speed and easing. Name the engine transition that matches best.\n"
        "3. Motion graphics: where they are used and where not, how they enter, move and leave, 2D or 3D, and the signature moves that create the wow.\n"
        "4. Typography and captions: size, position, case, weight, colour, animation.\n"
        "5. Colour and light: grade, palette (hex), contrast, letterbox, grain.\n"
        "6. Sound: music energy and level, which effects, how often and how loud.\n"
        "Then write 'replicate': the concrete instructions the director must follow. Use the measured numbers; where you disagree with a measurement "
        "because the frames show otherwise, trust the frames and say why in notes.\nJSON in this format:\n" + CARD_FORMAT))
    obj, _ = cl.ask_json("Style card", model, SYSTEM, [{"role": "user", "content": blocks}], max_tokens=6000,
                         check=lambda o: [] if isinstance(o, dict) and o.get("base") in BASES else [f"'base' must be one of {BASES}"], retries=1)
    card = obj
    card["name"] = card.get("name") or name
    return {"card": card, "params": card_params(card, measured.get("params") or {}), "base": card["base"], "usage": usage.summary()}


def card_params(card: dict, measured: dict) -> dict:
    """Renderer numbers: Claude's reading where it is valid, the measurements otherwise."""
    p = dict(measured)
    pace = (card.get("pacing") or {}).get("cut_every")
    if isinstance(pace, (int, float)) and 0.8 <= pace <= 12:
        p["cut_every"] = round(float(pace), 2)
    look = card.get("look") or {}
    if look.get("grade") in GRADES:
        p["grade"] = look["grade"]
    for k, lo, hi in (("letterbox", 0.0, 0.12), ("grain", 0.0, 0.2)):
        v = look.get(k)
        if isinstance(v, (int, float)) and lo <= v <= hi:
            p[k] = float(v)
    tr = card.get("transitions") or {}
    for src, dst in (("engine_in", "transition_in"), ("engine_out", "transition_out")):
        if tr.get(src) in TRANSITIONS:
            p[dst] = tr[src]
    snd = card.get("sound") or {}
    for k, lo, hi in (("sfx_db", -26, -8), ("music_db", -30, -14)):
        v = snd.get(k)
        if isinstance(v, (int, float)) and lo <= v <= hi:
            p[k] = float(v)
    cap = dict(p.get("captions") or {})
    cc = card.get("captions") or {}
    if cc.get("mode") in CAPTION_MODES:
        cap["mode"] = cc["mode"]
    if isinstance(cc.get("position"), (int, float)) and 0.5 <= cc["position"] <= 0.9:
        cap["position"] = float(cc["position"])
    if isinstance(cc.get("highlight"), str) and cc["highlight"].startswith("#") and len(cc["highlight"]) == 7:
        cap["highlight"] = cc["highlight"]
    p["captions"] = cap
    return p
