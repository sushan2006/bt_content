"""Claude directs the edit: research -> direction per style (with new 3D assets) -> storyboard check -> plans.

Everything Claude writes is validated and compiled by direction.py; problems go back to Claude to fix. If Claude is not
available (no key, budget reached, API down) a style falls back to the automatic rule-based edit, so a job never stops.
"""
from __future__ import annotations

import copy
import glob
import json
import os
import re
import time
from typing import Any, Callable, Optional

from . import claude as C
from . import direction as DR
from . import frames as F
from .. import kit
from ..schema import Plan

HERE = os.path.dirname(__file__)
DEFAULTS = {"model": "claude-opus-5-5", "helper_model": "claude-sonnet-5-5", "research": True, "check_rounds": 1, "budget_usd": 3.0, "frames": 8, "searches": 5}
STYLE_ABOUT = {
    "editorial": "3D Explainer: cuts between the speaker and full-screen 3D explainers, 3D objects rise from behind him, kinetic captions, light sound design.",
    "hype": "Bold & Fast: jump cuts every ~2 s, punch-ins and zoom pulses on key words, big boxed captions, bold statement and number cards, louder beat. Fewer long 3D explainers (keep them 2-4 s), more statements and objects.",
    "cinematic": "Cinematic Story: letterbox, teal-orange film look, slow push-ins, chapter cards at topic changes, subtle captions, longer calmer 3D explainers.",
    "minimal": "Clean & Minimal: calm cuts on sentences, soft captions, clean light number cards and diagrams, few effects; use 3D sparingly (one or two objects).",
}


def handbook(brand: dict) -> str:
    parts = [open(p, encoding="utf-8").read() for p in sorted(glob.glob(os.path.join(HERE, "handbook", "*.md")))]
    from ..draw import icon_names
    b = brand or {}
    parts.append("# The brand\n" + json.dumps({k: b.get(k) for k in ("company_name", "handle", "colors") if b.get(k)}, indent=1)
                 + "\nUse the brand's colours for accents (colour roles primary, accent, alert, dark in the kit).")
    parts.append("# Icons available for diagrams\n" + ", ".join(icon_names()))
    return "\n\n".join(parts)


def _library_text(library: dict[str, dict]) -> str:
    if not library:
        return "No assets from earlier videos yet."
    rows = []
    for aid, spec in library.items():
        groups = sorted({p.get("group") for p in spec.get("parts", []) if p.get("group")})
        rows.append(f"- library:{aid} — {spec.get('name', aid)}; parts: {', '.join(p['id'] for p in spec.get('parts', [])[:30])}"
                    + (f"; groups: {', '.join(groups)}" if groups else "") + (f"; flows: {', '.join(f['id'] for f in spec.get('flows', []))}" if spec.get("flows") else ""))
    return "\n".join(rows[:40])


def _style_text(st: dict) -> str:
    out = f"Style: {st.get('name', st['style'])} (id '{st['style']}')\n{STYLE_ABOUT.get(st['style'], '')}"
    card = st.get("card")
    if card:
        out += "\nStyle card learned from the reference video (follow it closely):\n" + json.dumps(card, indent=1)[:10000]
    elif st.get("profile"):
        out += "\nMeasured from the reference video: " + json.dumps(st["profile"].get("params", {}))[:1500]
    return out


class Director:
    def __init__(self, req: dict, log: Callable[[str], None]):
        self.req = req
        self.log = log
        self.cfg = {**DEFAULTS, **(req.get("settings") or {})}
        self.usage = C.Usage(float(self.cfg["budget_usd"]) if self.cfg.get("budget_usd") else None)
        self.work = req.get("work_dir") or "/tmp/director"
        os.makedirs(self.work, exist_ok=True)
        self.inputs = req["inputs"]
        self.brief = self.inputs.get("brief") or {}
        self.brand = self.inputs.get("brand") or {}
        self.machine = self.inputs.get("machine")
        # several machines can be chosen for one video: "machine" / "machine:1" is the first, "machine:2" the second ...
        self.machines = [m for m in (self.inputs.get("machines") or ([self.machine] if self.machine else [])) if m]
        if len(self.machines) > 1:
            self.brief = dict(self.brief, _machines=self.machines)
        self.library: dict[str, dict] = {}
        for a in req.get("library") or []:
            try:
                spec = a.get("spec") or json.load(open(a["spec_path"], encoding="utf-8"))
                self.library[a.get("id") or spec["id"]] = spec
            except Exception:  # noqa: BLE001
                continue
        self.session_assets: dict[str, dict] = {}
        self.built_assets: list[dict] = []

    def step(self, msg: str):
        self.log(f"◆ {msg}")

    # ------------------------------------------------------------ shared context
    def _context(self, refs, sheets, research: Optional[dict]) -> list[dict]:
        b = self.brief
        brief = {k: b.get(k) for k in ("title", "headline", "speaker_name", "speaker_role", "keywords", "glossary", "cta", "tagline", "notes", "platforms", "audience", "description")
                 if b.get(k)}
        txt = ["# This video", "Brief from the team:\n" + json.dumps(brief, indent=1, ensure_ascii=False)]
        if len(self.machines) > 1:
            txt.append("The company's own machines chosen for this video. Use kind 'machine' with asset 'machine:1', 'machine:2' … (in this order), "
                       "and bring each one on screen when it is talked about:\n"
                       + "\n".join(f"machine:{i + 1} = " + json.dumps({k: m.get(k) for k in ("name", "tagline", "keywords")}, ensure_ascii=False) for i, m in enumerate(self.machines)))
        elif self.machine:
            txt.append("The company's own machine chosen for this video (use asset 'machine' or kind 'machine'): "
                       + json.dumps({k: self.machine.get(k) for k in ("name", "tagline", "keywords")}, ensure_ascii=False))
        txt.append("Assets from earlier videos (reuse with 'library:<id>' when they fit):\n" + _library_text(self.library))
        total = refs[-1].out_end if refs else 0
        txt.append(f"Transcript after the automatic clean-up (best takes chosen, long pauses removed). Length {total:.1f} s. "
                   "Each line is [start-end seconds] followed by word ids:\n" + DR.transcript_text(refs))
        blocks = [C.text_block("\n\n".join(txt))]
        for s in sheets:
            blocks.append(C.image_block(s, 1400))
        for i, m in enumerate(self.machines[:4]):
            p = (m.get("previews") or [None])[0]
            if p and os.path.exists(p):
                label = f"machine:{i + 1} ({m.get('name', '')})" if len(self.machines) > 1 else "The machine"
                blocks.append(C.text_block(f"{label}: its 3D model from three angles:"))
                blocks.append(C.image_block(p, 1200))
        blocks.append(C.text_block("Frames above: the raw footage at the times shown (seconds in the edited video).", cache=True))
        if research:
            blocks.append(C.text_block("# Research notes (from the web, with sources)\n" + json.dumps(research, indent=1, ensure_ascii=False)[:9000], cache=True))
        return blocks

    # ------------------------------------------------------------ research
    def research(self, cl: C.Claude, system, ctx) -> dict:
        prompt = ("Research the topic of this video before it is edited. Use web search to check the facts the speaker states and to find "
                  "the correct technical terms, how the thing works (so the 3D explainers are correct), and how it looks (shape, parts, colours) "
                  "so it can be modelled. Reply with JSON only:\n"
                  '{"topic": "...", "summary": "3-5 sentences", "how_it_works": ["step", ...], "appearance": ["what the main objects look like: shape, parts, colours", ...], '
                  '"facts": [{"fact": "...", "source": "site name", "url": "https://..."}], "checks": [{"claim": "what the speaker says", "verdict": "correct|unclear|wrong", "note": "..."}], '
                  '"terms": ["correct spelling of key terms"], "visual_ideas": ["one idea per mechanism worth showing"]}')
        obj, _ = cl.ask_json("Research", self.cfg["helper_model"], system, [{"role": "user", "content": ctx + [C.text_block(prompt)]}],
                             max_tokens=5000, web_search=int(self.cfg.get("searches", 5)), retries=1)
        return obj if isinstance(obj, dict) else {}

    # ------------------------------------------------------------ one style
    def plan_style(self, cl: C.Claude, system, ctx, st: dict, refs, base: dict, previous: Optional[dict], request: Optional[str]) -> dict:
        style = st["style"]
        lib = {**self.library, **self.session_assets}
        built_note = ""
        if self.session_assets:
            built_note = ("\nAssets you already built for this video in another style (reuse them by id, no need to define them again): "
                          + "; ".join(f"{k} ({v.get('name', k)}; parts: {', '.join(p['id'] for p in v.get('parts', [])[:25])})" for k, v in self.session_assets.items()))
        if previous and request:
            task = (f"{_style_text(st)}\n\nThis is a revision. Your previous direction for this style:\n```json\n{json.dumps(previous)[:20000]}\n```\n"
                    f"The reviewers asked for these changes:\n\"{request}\"\n"
                    "Make exactly what they ask (keep everything else as it was unless it conflicts) and reply with the complete revised direction JSON.")
        else:
            task = (f"{_style_text(st)}{built_note}\n\nWrite the complete direction JSON for this style now. "
                    "Build every 3D object you need with the kit in 'assets' (or reuse builtin/library/machine assets). Anchor every beat and action on word ids.")

        def check(obj):
            if not isinstance(obj, dict):
                return ["reply with one JSON object"]
            obj.setdefault("style", style)
            try:
                _, problems, _ = DR.compile_direction(base, obj, refs, style, self.brief, self.machine, lib, (self.machine or {}).get("cutouts"), st.get("profile"), self.brand)
            except Exception as e:  # noqa: BLE001
                return [str(e)[:500]]
            return problems

        name = st.get("name", style)
        obj, msgs = cl.ask_json(f"Direction {name}", self.cfg["model"], system, [{"role": "user", "content": ctx + [C.text_block(task)]}],
                                max_tokens=16000, check=check, retries=2)
        direction = obj
        plan, problems, adjust = DR.compile_direction(base, direction, refs, style, self.brief, self.machine, lib, (self.machine or {}).get("cutouts"), st.get("profile"), self.brand)
        new_assets = self._keep_assets(direction)
        # storyboard check: Claude looks at its own edit and fixes it
        for rnd in range(int(self.cfg.get("check_rounds", 1))):
            try:
                self.usage.check(0.15)
            except C.BudgetExceeded:
                self.log("Budget nearly reached: skipping the storyboard check")
                break
            self.step(f"Checking the storyboard of {name}" + (f" (round {rnd + 1})" if rnd else ""))
            try:
                sheets = self._storyboard(plan, direction, f"{style}_{rnd}")
            except Exception as e:  # noqa: BLE001
                self.log(f"Storyboard could not be rendered here ({str(e)[:120]}); skipping the visual check")
                break
            blocks = [C.text_block("Storyboard of your edit (frames at the times shown, as they will look in the final video):")]
            blocks += [C.image_block(s, 1400) for s in sheets]
            for a in new_assets:
                if a.get("preview"):
                    blocks += [C.text_block(f"Preview of the 3D asset '{a['id']}' you built (three angles):"), C.image_block(a["preview"], 1200)]
            blocks.append(C.text_block(
                "Check it like a senior editor and motion designer, against the quality bar in the handbook:\n"
                "1. Transitions: the frames marked 'in' and 'out' are taken during the moves into and out of full-screen graphics. Is every move clean "
                "(no half-drawn frame, no jump in the speaker's position, no graphic starting before its word)? Is the same kind of transition used "
                "consistently, and is each one the right choice for that moment?\n"
                "2. Rhythm: does something change every few seconds without chaos? Is the speaker seen long enough between graphics?\n"
                "3. Need: does every graphic explain something? Remove decoration. Is there at least one wow moment, placed on the key idea?\n"
                "4. Machines: is every company machine shown when it is named?\n"
                "5. Look: are the 3D objects recognisable and correct (shape, proportions, colours)? Do labels overlap or cover the subject? Is text short and readable?\n"
                "6. Sound: is it minimal (one soft sound per moment at most, silence for small moves, one accent at the wow moment)?\n"
                "Anything ugly, empty, cluttered, laggy or wrong?\n"
                + (f"Notes from the engine: {'; '.join(problems + adjust)}\n" if problems or adjust else "")
                + 'If it is good, reply {"ok": true}. Otherwise reply {"ok": false, "issues": ["..."], "direction": <the complete corrected direction>} (JSON only).'))
            try:
                verdict, msgs2 = cl.ask_json(f"Check {name}", self.cfg["model"], system, msgs + [{"role": "user", "content": blocks}], max_tokens=16000,
                                             check=lambda o: ([] if isinstance(o, dict) and (o.get("ok") or isinstance(o.get("direction"), dict)) else ["reply {\"ok\": true} or include the full corrected 'direction'"]),
                                             retries=1)
            except C.ClaudeError as e:
                self.log(f"Storyboard check skipped: {str(e)[:160]}")
                break
            if verdict.get("ok") or not isinstance(verdict.get("direction"), dict):
                self.log(f"{name}: Claude approved its storyboard")
                break
            self.log(f"{name}: Claude fixed {len(verdict.get('issues') or [])} issue(s): " + "; ".join(verdict.get("issues") or [])[:300])
            cand = verdict["direction"]
            cand.setdefault("style", style)
            p2, probs2, adj2 = DR.compile_direction(base, cand, refs, style, self.brief, self.machine, {**lib, **self.session_assets}, (self.machine or {}).get("cutouts"), st.get("profile"), self.brand)
            if len(probs2) <= len(problems):
                direction, plan, problems, adjust = cand, p2, probs2, adj2
                new_assets = self._keep_assets(direction)
            msgs = msgs2
        return {"direction": direction, "plan": plan, "problems": problems, "adjust": adjust}

    def _keep_assets(self, direction: dict) -> list[dict]:
        out = []
        for spec in direction.get("assets") or []:
            if self.machine and any(p.get("photo") is not None for p in spec.get("parts", [])):
                spec = dict(spec, photos=list(self.machine.get("cutouts") or []))
            a, err = kit.validate(spec)
            if err:
                continue
            if a.id in self.session_assets and kit.asset_key(self.session_assets[a.id]) == kit.asset_key(spec):
                out.extend(x for x in self.built_assets if x["id"] == a.id)
                continue
            self.session_assets[a.id] = spec
            d = os.path.join(self.work, "assets", re.sub(r"[^\w-]+", "_", a.id))
            try:
                info = kit.save(spec, d)
                info["spec"] = spec
                self.built_assets = [x for x in self.built_assets if x["id"] != a.id] + [info]
                out.append(info)
                self.log(f"Built 3D asset '{a.name or a.id}' ({len(a.parts)} parts) -> model.glb")
            except Exception as e:  # noqa: BLE001
                self.log(f"Asset '{a.id}' could not be saved: {str(e)[:160]}")
        return out

    def _storyboard(self, plan: dict, direction: dict, tag: str) -> list[str]:
        times, moves = [], []
        for g in plan["graphics"]:
            if g["type"] in ("logo_bug", "progress_bar", "end_card"):
                continue
            d = g["end"] - g["start"]
            times.append(g["start"] + min(1.4, d * 0.45))
            if d > 4.0:
                times.append(g["start"] + d * 0.8)
            if g["type"] == "fullscreen":     # frames during the moves in and out, to check the transitions
                if g["params"].get("enter", "whip") != "cut":
                    moves.append(g["start"] + 0.14)
                if g["params"].get("exit", "cut") != "cut":
                    moves.append(g["end"] - 0.12)
        speech = sum(c["t_out"] - c["t_in"] for c in plan["clips"])
        times += [0.6, speech * 0.5]
        times = sorted({round(t, 2) for t in times if 0 <= t < speech})[:16]
        moves = sorted({round(t, 2) for t in moves if 0 <= t < speech} - set(times))[:8]
        return F.storyboard_sheets(plan, sorted(times + moves), os.path.join(self.work, "storyboard", tag), labels={t: "in/out" for t in moves})

    # ------------------------------------------------------------ main
    def run(self) -> dict:
        from .. import planner
        styles = self.req["styles"]
        previous = self.req.get("previous") or {}
        request = self.req.get("request")
        only = set(self.req.get("only") or [])
        self.step("Preparing the footage for Claude")
        bases, refs = {}, None
        for st in styles:
            out = planner.build_plan(self.inputs, st["variant"], "9:16", self.req.get("overrides") or [])
            bases[st["id"]] = out["plan"]
            if refs is None:
                refs = DR.word_refs(Plan.model_validate(out["plan"]))
        first = bases[styles[0]["id"]]
        sheets = F.raw_sheets(first, os.path.join(self.work, "frames"), n=int(self.cfg.get("frames", 8)), per_sheet=8)
        cl = C.Claude(self.usage, self.log)
        system = [C.text_block(handbook(self.brand), cache=True)]
        research = previous.get("research")
        ctx0 = self._context(refs, sheets, None)
        if research is None and self.cfg.get("research", True):
            self.step("Researching the topic on the web")
            try:
                research = self.research(cl, system, ctx0)
                self.log(f"Research: {research.get('topic', '')} — {len(research.get('facts') or [])} facts with sources")
            except (C.ClaudeError, C.BudgetExceeded) as e:
                self.log(f"Research skipped: {str(e)[:200]}")
                research = None
        ctx = self._context(refs, sheets, research)
        versions = []
        for st in styles:
            name = st.get("name", st["style"])
            if only and st["id"] not in only and previous.get("directions", {}).get(st["id"]):
                # unchanged style in a revision: recompile the previous direction on the new base
                prev = previous["directions"][st["id"]]
                plan, problems, adjust = DR.compile_direction(bases[st["id"]], prev, refs, st["style"], self.brief, self.machine, {**self.library, **self.session_assets},
                                                              (self.machine or {}).get("cutouts"), st.get("profile"), self.brand)
                versions.append(self._version(st, plan, prev, problems, adjust, "kept from the previous revision"))
                continue
            self.step(f"Claude is planning version {st.get('label', '')} ({name})")
            try:
                res = self.plan_style(cl, system, ctx, st, refs, bases[st["id"]], previous.get("directions", {}).get(st["id"]), request)
                versions.append(self._version(st, res["plan"], res["direction"], res["problems"], res["adjust"], None))
            except Exception as e:  # noqa: BLE001
                why = str(e)[:240]
                self.log(f"{name}: Claude could not plan it ({why}); using the automatic edit")
                out = planner.build_plan(self.inputs, st["variant"], "9:16", self.req.get("overrides") or [])
                versions.append({"id": st["id"], "plan": out["plan"], "summary": out["summary"], "notes": [f"Automatic edit (Claude unavailable: {why})"],
                                 "direction": None, "problems": [], "planner": "rules"})
        self.step(f"Planned {len(versions)} version{'' if len(versions) == 1 else 's'} (Claude cost ${self.usage.cost:.2f})")
        return {"versions": versions, "research": research, "assets": [{k: v for k, v in a.items()} for a in self.built_assets],
                "usage": self.usage.summary(), "transcript_words": len(refs or [])}

    def _version(self, st, plan, direction, problems, adjust, note) -> dict:
        from ..planner import summarize
        p = Plan.model_validate(plan)
        summ = summarize(p, [])
        summ["steps"] = DR.summarize_direction(plan, direction or {})
        summ["planner"] = "claude"
        summ["claude_notes"] = (direction or {}).get("notes") or []
        notes = list(p.notes) + ([f"Fixed automatically: {'; '.join(adjust)}"] if adjust else []) + ([f"Left out (could not be built): {'; '.join(problems)}"] if problems else [])
        if note:
            notes.append(note)
        return {"id": st["id"], "plan": plan, "summary": summ, "notes": notes, "direction": direction, "problems": problems, "planner": "claude"}


def direct(req: dict, log: Callable[[str], None]) -> dict:
    if not C.available():
        raise C.ClaudeError("ANTHROPIC_API_KEY is not set in .env")
    return Director(req, log).run()
