"""Video content understanding pipeline -> structured, comparable metadata."""
from __future__ import annotations

import os
import re
import shutil
import tempfile

from . import media, speech, vision

ANALYZER_VERSION = "1.0.0"

QUESTION_START = re.compile(r"^\s*(what|why|how|did you|do you|have you|are you|is your|can you|would you|ever wondered|which|when|who)\b", re.I)
PROBLEM_WORDS = re.compile(r"\b(problem|struggl|tired of|issue|challenge|fail|wast|leak|break|broken|costly|expensive|risk|damage|pain|difficult|hard to|stop)\w*", re.I)
EDU_WORDS = re.compile(r"\b(how|why|step|because|tip|learn|means|works|process|reason|example|first|second|finally)\b", re.I)
CONCLUSION_WORDS = re.compile(r"\b(so that's|that's why|in short|to summari[sz]e|in summary|that's how|thanks for watching|thank you)\b", re.I)
CTA_PATTERNS = {
    "website": re.compile(r"\b(visit|website|link in (the )?bio|link below|www\.|\.com|learn more|check out)\b", re.I),
    "enquiry": re.compile(r"\b(contact|enquir|inquir|get in touch|request a quote|quote|call us|email us|whatsapp|talk to)\w*", re.I),
    "purchase": re.compile(r"\b(buy|order|shop|purchase|book now|get yours)\b", re.I),
    "follow": re.compile(r"\b(follow|subscribe|like and share|turn on notifications)\b", re.I),
    "dm": re.compile(r"\b(dm|direct message|message us|comment below)\b", re.I),
}


def _cta(text: str) -> list[str]:
    return [k for k, p in CTA_PATTERNS.items() if p.search(text or "")]


def _count_in(scenes: list[dict], a: float, b: float) -> int:
    return sum(1 for s in scenes[1:] if a < s["start"] < b)


def analyze(path: str, *, transcript_text: str | None = None, language: str | None = None, product: str | None = None,
            company: str | None = None, company_keywords: list[str] | None = None, use_vision: bool = True) -> dict:
    media.require_ffmpeg()
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    pr = media.probe(path)
    dur = pr.duration
    if dur <= 0:
        raise RuntimeError("Video has zero duration")
    tmp = tempfile.mkdtemp(prefix="cip_")
    try:
        scenes = media.detect_scenes(path, duration=dur)
        silences = media.detect_silences(path) if pr.has_audio else []
        loud = media.loudness(path) if pr.has_audio else {"integrated_lufs": None, "true_peak_dbfs": None}
        motion = media.frame_motion(path, min(3.0, dur))

        # ---- transcript
        if transcript_text:
            transcript, t_status = speech.parse_subtitles(transcript_text), "ok: supplied subtitles"
        elif pr.has_audio:
            wav = media.extract_audio_wav(path)
            transcript, t_status = speech.transcribe(wav, language) if wav else ([], "error: audio extraction failed")
            if wav and os.path.exists(wav):
                os.remove(wav)
        else:
            transcript, t_status = [], "no audio track"
        have_speech = t_status.startswith("ok")

        # ---- frames: dense in the opening, then one per scene (max 24)
        times = [t for t in (0.2, 0.5, 1.0, 2.0, 3.0, 5.0) if t < dur]
        times += [round((s["start"] + s["end"]) / 2, 2) for s in scenes if (s["start"] + s["end"]) / 2 > 5.0]
        times.append(max(0, dur - 0.5))
        times = sorted(set(times))[:24]
        frames = media.extract_frames(path, times, tmp)
        for f in frames:
            f["ocr"] = vision.ocr(f["path"])
        vis = None   # no vision model: visual judgements stay "unknown" for a person to set
        vision_ok = bool(vis) and "error" not in vis
        if vision_ok:
            by_t = {round(float(x.get("t", -1)), 1): x for x in vis.get("frames", [])}
            for f in frames:
                d = by_t.get(round(f["t"], 1))
                if d:
                    f.update({k: v for k, v in d.items() if k != "t"})

        # ---- windows
        end_start = max(min(dur * 0.85, dur - min(3.0, dur * 0.25)), 0)

        def window(a: float, b: float) -> dict:
            fr = [f for f in frames if a <= f["t"] < b]
            return {
                "speech": speech.text_between(transcript, a, b),
                "on_screen_text": " | ".join(f["ocr"] for f in fr if f.get("ocr")),
                "visuals": [f.get("description") for f in fr if f.get("description")],
                "scene_changes": _count_in(scenes, a, b),
            }

        w1, w3, w5 = window(0, 1), window(0, 3), window(0, 5)
        opening_text = w5["speech"]
        first_sentence = re.split(r"(?<=[.?!])\s", opening_text.strip())[0] if opening_text else ""
        question = bool(first_sentence) and (first_sentence.strip().endswith("?") or bool(QUESTION_START.search(first_sentence)))
        problem = bool(PROBLEM_WORDS.search(opening_text))
        kw = [k.lower() for k in (company_keywords or [])] + ([company.lower()] if company else [])
        intro = any(k and k in opening_text.lower() for k in kw)
        op_vis = (vis or {}).get("opening", {}) if vision_ok else {}
        product_by = op_vis.get("product_visible_by_sec")
        if product_by is None and vision_ok:
            pv = [f["t"] for f in frames if f.get("product_visible")]
            product_by = min(pv) if pv else None
        branding_first = vision_ok and (op_vis.get("starts_with_company_branding") or any(f.get("logo_or_company_branding") for f in frames if f["t"] <= 2))
        speech_first3 = speech.speech_seconds(transcript, 0, min(3, dur)) if have_speech else None
        first_speech_at = transcript[0]["start"] if transcript else None

        if vision_ok and ((product_by is not None and product_by <= 2) or op_vis.get("starts_with_demo")):
            style, conf = "product_demo_first", 0.75
        elif question:
            style, conf = "question", 0.8
        elif problem:
            style, conf = "problem_first", 0.65
        elif intro or branding_first:
            style, conf = "company_intro", 0.7
        elif have_speech and (speech_first3 or 0) < 0.5 and w3["scene_changes"] == 0 and (motion is not None and motion < 4):
            style, conf = "slow_cinematic", 0.6
        elif have_speech and (speech_first3 or 0) >= 0.5:
            style, conf = "direct_statement", 0.5
        else:
            style, conf = "unknown", 0.0

        # ---- middle
        mid_a, mid_b = min(5.0, dur), end_start
        cuts_total = max(0, len(scenes) - 1)
        cuts_per_10s = round(cuts_total / dur * 10, 2)
        longest_shot = max((s["end"] - s["start"] for s in scenes), default=dur)
        mid_pauses = [s for s in silences if s["end"] and s["start"] >= mid_a and s["end"] <= mid_b and s["end"] - s["start"] >= 1.2]
        long_expl = []
        for s in scenes:
            if s["end"] - s["start"] >= 12 and have_speech and speech.speech_seconds(transcript, s["start"], s["end"]) / (s["end"] - s["start"]) > 0.7:
                long_expl.append({"start": s["start"], "end": s["end"]})
        mid_text = speech.text_between(transcript, mid_a, mid_b)
        demo_frames = [f["t"] for f in frames if f.get("is_demonstration")]
        diagrams = bool(vis and vis.get("has_diagrams_or_animations")) or any(f.get("is_diagram_or_animation") for f in frames)

        # ---- ending
        end_text = speech.text_between(transcript, end_start, dur)
        ocr_end = " ".join(f.get("ocr", "") for f in frames if f["t"] >= end_start)
        ctas_end = _cta(end_text + " " + ocr_end)
        ctas_all = _cta(speech.text_between(transcript, 0, dur) + " " + " ".join(f.get("ocr", "") for f in frames))
        last_speech_end = transcript[-1]["end"] if transcript else None
        trailing = round(dur - last_speech_end, 2) if last_speech_end is not None else None
        abrupt = trailing is not None and trailing < 0.3 and not CONCLUSION_WORDS.search(end_text)
        closing_footage = trailing is not None and trailing > max(3.0, 0.1 * dur) and not ctas_end
        product_msg = bool(product and product.lower() in (end_text + " " + ocr_end).lower())

        speech_ratio = round(speech.speech_seconds(transcript, 0, dur) / dur, 3) if have_speech else None
        pace = "fast" if cuts_per_10s > 3 else "medium" if cuts_per_10s >= 1 else "slow"
        audio_type = "silent" if not pr.has_audio else ("speech" if (speech_ratio or 0) > 0.3 else "music_or_ambient" if have_speech else "unknown")
        cta_type = ctas_end[0] if ctas_end else (ctas_all[0] if ctas_all else "none")
        hook = "question" if question else "problem" if problem else "demo" if style == "product_demo_first" else "company_intro" if style == "company_intro" else "statement" if style == "direct_statement" else "none" if style == "slow_cinematic" else "unknown"

        summary = {
            "opening": {
                "first_1s": w1, "first_3s": w3, "first_5s": w5,
                "begins_with_question": question, "begins_with_problem_statement": problem,
                "begins_with_product_demo": style == "product_demo_first" if vision_ok else None,
                "begins_with_surprising_visual": op_vis.get("surprising_visual") if vision_ok else None,
                "introduces_company_immediately": bool(intro or branding_first),
                "uses_text_overlay": bool(w3["on_screen_text"]) if vision.ocr_available() else None,
                "uses_narration": (speech_first3 or 0) >= 0.5 if have_speech else None,
                "uses_animation": any(f.get("is_diagram_or_animation") for f in frames if f["t"] <= 3) if vision_ok else None,
                "main_subject": op_vis.get("main_subject") if vision_ok else None,
                "subject_clear_by_sec": op_vis.get("subject_clear_by_sec", product_by) if vision_ok else None,
                "first_speech_at_sec": first_speech_at,
                "motion_first_3s": motion,
            },
            "middle": {
                "range": [round(mid_a, 2), round(end_start, 2)],
                "scene_changes": _count_in(scenes, mid_a, mid_b), "cuts_per_10s_overall": cuts_per_10s,
                "longest_shot_sec": round(longest_shot, 2), "long_explanations": long_expl,
                "unnecessary_pauses": mid_pauses, "demonstrates_product": bool(demo_frames) if vision_ok else None,
                "demo_at_sec": demo_frames, "educational_elements": bool(EDU_WORDS.search(mid_text)) or diagrams,
                "visual_reengagement_points": [s["start"] for s in scenes if mid_a < s["start"] < mid_b],
            },
            "ending": {
                "range": [round(end_start, 2), round(dur, 2)], "speech": end_text, "on_screen_text": ocr_end.strip(),
                "has_conclusion": bool(CONCLUSION_WORDS.search(end_text)), "has_product_message": product_msg,
                "has_cta": bool(ctas_end), "cta_types": ctas_end, "asks_to_visit_website": "website" in ctas_end,
                "encourages_enquiries": "enquiry" in ctas_end, "ends_abruptly": abrupt,
                "unnecessary_closing_footage_sec": trailing if closing_footage else 0,
            },
            "overall": {
                "duration_sec": round(dur, 2), "aspect_ratio": pr.aspect_ratio, "resolution": f"{pr.width}x{pr.height}" if pr.width else None,
                "fps": round(pr.fps, 2) if pr.fps else None, "scenes": len(scenes), "editing_pace": pace, "speech_ratio": speech_ratio,
                "audio_type": audio_type, "loudness_lufs": loud["integrated_lufs"], "true_peak_dbfs": loud["true_peak_dbfs"],
                "loudness_note": None if loud["integrated_lufs"] is None else ("quieter than typical social target (-14 LUFS)" if loud["integrated_lufs"] < -18 else "louder than typical social target" if loud["integrated_lufs"] > -10 else "within typical social range"),
                "low_resolution": bool(pr.height and min(pr.width or 0, pr.height) < 720),
                "visual_style": (vis or {}).get("visual_style") if vision_ok else None,
                "has_diagrams_or_animations": diagrams if vision_ok else None,
            },
        }
        src = "ai" if vision_ok else "heuristic"

        def feat(key, value=None, num=None, source="heuristic", confidence=None, evidence=None):
            return {"key": key, "value": None if value is None else str(value), "num": num, "source": source, "confidence": confidence, "evidence": evidence}

        features = [
            feat("opening_style", style, source=src if style == "product_demo_first" else "heuristic", confidence=conf,
                 evidence={"first_5s_speech": opening_text[:300], "question": question, "problem": problem, "company_intro": bool(intro or branding_first), "product_visible_by_sec": product_by}),
            feat("hook_type", hook, confidence=conf),
            feat("opening_scene_changes", num=w3["scene_changes"], confidence=1.0),
            feat("editing_pace", pace, confidence=0.9, evidence={"cuts_per_10s": cuts_per_10s}),
            feat("cuts_per_10s", num=cuts_per_10s, confidence=1.0),
            feat("num_scenes", num=len(scenes), confidence=1.0),
            feat("aspect_ratio", pr.aspect_ratio, confidence=1.0),
            feat("cta_type", cta_type if have_speech or vision.ocr_available() else "unknown", confidence=0.7 if have_speech else 0.3, evidence={"ending_speech": end_text[:300], "ending_text": ocr_end[:200]}),
            feat("ending_type", "abrupt" if abrupt else "closing_footage" if closing_footage else "cta" if ctas_end else "conclusion" if summary["ending"]["has_conclusion"] else "other", confidence=0.6),
            feat("audio_type", audio_type, confidence=0.6),
        ]
        if have_speech:
            features += [
                feat("opening_has_narration", "yes" if (speech_first3 or 0) >= 0.5 else "no", confidence=0.9),
                feat("speech_ratio", num=speech_ratio, confidence=0.9),
                feat("narration_style", "continuous_narration" if (speech_ratio or 0) > 0.6 else "partial_narration" if (speech_ratio or 0) > 0.2 else "minimal_speech", confidence=0.6),
            ]
        if vision_ok:
            features += [
                feat("product_shown_in_opening", "yes" if product_by is not None and product_by <= 2 else "no", source="ai", confidence=0.7),
                feat("subject_visible_by_sec", num=op_vis.get("subject_clear_by_sec", product_by), source="ai", confidence=0.6),
                feat("visual_style", vis.get("visual_style"), source="ai", confidence=0.6),
                feat("has_diagrams_or_animations", "yes" if diagrams else "no", source="ai", confidence=0.6),
            ]
        if loud["integrated_lufs"] is not None:
            features.append(feat("loudness_lufs", num=loud["integrated_lufs"], confidence=1.0))

        for f in frames:
            f.pop("path", None)
        return {
            "analyzer_version": ANALYZER_VERSION, "duration": round(dur, 3),
            "probe": pr.__dict__, "scenes": scenes, "silences": silences, "loudness": loud,
            "transcript": transcript, "transcript_status": t_status,
            "frames": frames, "vision_status": "not used",
            "ocr_status": "ok" if vision.ocr_available() else "unavailable: tesseract not installed",
            "summary": summary, "features": features,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
