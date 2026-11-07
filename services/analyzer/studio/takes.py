"""Take analysis and selection.

For 2-3 takes of the same content:
  1. transcribe each take with word timings (faster-whisper; or a supplied transcript)
  2. split into sentences and measure every sentence: audio (speech level, signal-to-noise, clipping),
     delivery (fillers, repeated words, unsure words, long pauses, pace) and picture (sharpness, brightness, face)
  3. line the takes up sentence by sentence (or against a script) and score each candidate
  4. choose the best take per line with a small preference for staying on the same take (fewer jump cuts)
  5. tighten each chosen line: drop filler words, shorten long pauses
"""
from __future__ import annotations

import difflib
import math
import os
import re
import subprocess
import tempfile

import numpy as np

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FILLERS = {"um", "uh", "erm", "er", "ah", "uhm", "hmm", "mm", "umm", "uhh", "ehm"}
_model = None


def _norm(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower())


# ---------------------------------------------------------------- transcription
PROMPT_TAIL = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking."


def hint_terms(hints: str | None) -> list[str]:
    """Words worth protecting from mis-hearing: names, products, technical terms (from the brief)."""
    if not hints:
        return []
    terms = re.findall(r"[A-Za-z][A-Za-z0-9'-]{3,}", hints)
    seen, out = set(), []
    for t in terms:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:60]


def snap_to_hints(words: list[dict], hints: str | None) -> list[dict]:
    """A recognised word that sounds like a hint term but is not a real word for this video is replaced by the term
    ("Beastings" -> "BridgeThings", "employer" -> "impeller" when impeller is in the brief)."""
    terms = hint_terms(hints)
    if not terms:
        return words
    low = {t.lower(): t for t in terms}
    for w in words:
        core = re.sub(r"^[^\w]+|[^\w]+$", "", w["text"])
        if len(core) < 4 or core.lower() in low:
            continue
        best, score = None, 0.0
        cl = core.lower()
        for t in terms:
            tl = t.lower()
            # the same word in another form (work/works, electric/electrical, tank/tanks) is not a mis-hearing
            stem = max(3, min(len(cl), len(tl)) - 2)
            if min(len(cl), len(tl)) >= 4 and cl[:stem] == tl[:stem] and abs(len(cl) - len(tl)) <= 3:
                best, score = None, 0.0
                break
            r = difflib.SequenceMatcher(None, core.lower(), t.lower()).ratio()
            if r > score:
                best, score = t, r
        # strict for common words, a little looser when the word itself is unusual (low recogniser confidence)
        need = 0.80 if w.get("prob", 1.0) > 0.6 else 0.66
        if best and score >= need and core[0].lower() == best[0].lower():
            w["text"] = w["text"].replace(core, best)
            w["snapped"] = core
    return words


def transcribe(path: str, language: str | None = None, audio: "np.ndarray | None" = None, hints: str | None = None) -> list[dict]:
    """Word-timed transcript. Audio is decoded with FFmpeg and passed as an array (no PyAV dependency)."""
    global _model
    from faster_whisper import WhisperModel
    if _model is None:
        size = os.environ.get("WHISPER_MODEL", "small")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        _model = WhisperModel(size, device=device, compute_type="int8" if device == "cpu" else "float16")
    audio = decode_audio(path) if audio is None else audio
    prompt = (f"Vocabulary: {', '.join(hint_terms(hints))}. " if hints else "") + PROMPT_TAIL
    segs, _info = _model.transcribe(audio, language=language, word_timestamps=True, vad_filter=False, initial_prompt=prompt)
    words = []
    for s in segs:
        for w in s.words or []:
            txt = w.word.strip()
            if txt:
                words.append({"start": round(float(w.start), 3), "end": round(float(w.end), 3), "text": txt, "prob": round(float(w.probability), 3)})
    return words


def recover_hidden_words(words: list[dict], audio: np.ndarray, sr: int = 16000, language: str | None = None) -> list[dict]:
    """Whisper sometimes swallows a restarted phrase into one stretched word ("0" lasting 1.9 s while the speaker
    actually says "So the basic electric motor has a 0"). Such spans are transcribed again on their own."""
    global _model
    if _model is None or not len(audio):
        return words
    out = []
    for k, w in enumerate(words):
        dur = w["end"] - w["start"]
        if dur > 1.0 and len(re.sub(r"[^\w]", "", w["text"])) <= 6:
            a0 = max(0.0, w["start"] - 0.25)
            nxt = words[k + 1]["start"] if k + 1 < len(words) else w["end"] + 0.4
            a1 = min(len(audio) / sr, max(w["end"], nxt) + 0.05)
            seg = audio[int(a0 * sr):int(a1 * sr)]
            try:
                segs, _ = _model.transcribe(seg, language=language, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
                got = [{"start": round(a0 + float(x.start), 3), "end": round(a0 + float(x.end), 3), "text": x.word.strip(), "prob": round(float(x.probability), 3)}
                       for sg in segs for x in (sg.words or []) if x.word.strip()]
            except Exception:  # noqa: BLE001
                got = []
            # keep only the words that end inside the stretched span (the following word is still in the list)
            got = [g for g in got if g["end"] <= w["end"] + 0.15 and g["start"] >= w["start"] - 0.3 and re.search(r"\w", g["text"])]
            key = re.sub(r"[^\w]", "", w["text"].lower())
            if len(got) >= 3 and key and re.sub(r"[^\w]", "", got[-1]["text"].lower()).startswith(key[:1]):
                got[0]["start"] = max(got[0]["start"], out[-1]["end"] + 0.01 if out else 0.0)
                out.extend(got)
                continue
        out.append(w)
    return out


def mark_false_starts(words: list[dict], max_len: int = 7, window: float = 7.0) -> list[dict]:
    """A false start is a phrase the speaker abandons and says again ("So the electric motor... has a... So the basic
    electric motor has a 0.5 to 1.5"). The abandoned words are flagged and left out of the cut."""
    norm = [_norm(w["text"]) for w in words]
    n = len(words)
    i = 0
    while i < n:
        best = None
        for L in range(max_len, 1, -1):
            if i + L > n:
                continue
            a = [x for x in norm[i:i + L] if x]
            if len(a) < 2 or not norm[i]:
                continue
            for j in range(i + L, n):
                if words[j]["start"] - words[i]["start"] > window:
                    break
                if norm[j] != norm[i]:
                    continue
                b = [x for x in norm[j:j + L + 2] if x]
                # how much of the earlier phrase reappears, in order, at j
                hit, pos = 0, 0
                for x in a:
                    while pos < len(b) and b[pos] != x:
                        pos += 1
                    if pos < len(b):
                        hit += 1
                        pos += 1
                if hit / len(a) >= 0.8 and hit >= 3:
                    best = (j, L)
                    break
            if best:
                break
        if best and any(re.search(r"[.!?]$", words[k]["text"].strip()) for k in range(i, best[0])):
            best = None   # the earlier phrase was finished: a deliberate repeat, not a false start
        if best:
            j, _ = best
            for k in range(i, j):
                words[k]["false_start"] = True
            i = j
        else:
            i += 1
    return words


def decode_audio(path: str, sr: int = 16000) -> np.ndarray:
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


# ---------------------------------------------------------------- sentences
def sentences(words: list[dict], max_gap: float = 0.9) -> list[dict]:
    out, cur = [], []
    for i, w in enumerate(words):
        if cur and (w["start"] - cur[-1]["end"] > max_gap):
            out.append(cur)
            cur = []
        cur.append(dict(w, i=i))
        if re.search(r"[.!?]$", w["text"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    res = []
    for ws in out:
        text = " ".join(w["text"] for w in ws)
        res.append({"words": ws, "start": ws[0]["start"], "end": ws[-1]["end"], "text": text,
                    "norm": [n for n in (_norm(w["text"]) for w in ws) if n and n not in FILLERS]})
    return res


# ---------------------------------------------------------------- measurements
def _db(x: float) -> float:
    return 20 * math.log10(max(x, 1e-6))


def audio_profile(a: np.ndarray, sr: int = 16000) -> dict:
    hop = int(sr * 0.02)
    n = len(a) // hop
    if n == 0:
        return {"rms": np.zeros(0), "hop": hop, "noise_db": -90.0}
    frames = a[: n * hop].reshape(n, hop)
    rms = np.sqrt((frames ** 2).mean(1) + 1e-12)
    noise = float(np.percentile(rms, 10))
    return {"rms": rms, "hop": hop, "sr": sr, "noise_db": _db(noise)}


def sentence_audio(a: np.ndarray, prof: dict, start: float, end: float) -> dict:
    sr, hop = prof.get("sr", 16000), prof["hop"]
    i0, i1 = int(start * sr / hop), max(int(start * sr / hop) + 1, int(end * sr / hop))
    seg = prof["rms"][i0:i1]
    raw = a[int(start * sr): int(end * sr)]
    if len(seg) == 0:
        return {"speech_db": -90.0, "snr_db": 0.0, "clip_frac": 0.0}
    speech = float(np.percentile(seg, 75))
    noise_db = max(prof["noise_db"], -75.0)  # digital silence would give meaningless 100+ dB
    return {"speech_db": round(_db(speech), 1), "snr_db": round(min(60.0, _db(speech) - noise_db), 1),
            "clip_frac": round(float((np.abs(raw) > 0.985).mean()) if len(raw) else 0.0, 5)}


def delivery(sent: dict) -> dict:
    ws = sent["words"]
    norm = [_norm(w["text"]) for w in ws]
    fillers = sum(1 for n in norm if n in FILLERS)
    repeats = sum(1 for a, b in zip(norm, norm[1:]) if a and a == b and a not in FILLERS)
    unsure = sum(1 for w in ws if w.get("prob", 1) < 0.45)
    pauses = sum(1 for a, b in zip(ws, ws[1:]) if b["start"] - a["end"] > 0.65)
    dur = max(0.3, sent["end"] - sent["start"])
    wps = len([n for n in norm if n not in FILLERS]) / dur
    return {"fillers": fillers, "repeats": repeats, "unsure": unsure, "long_pauses": pauses, "wps": round(wps, 2)}


_face = None


def visual(path: str, t: float) -> dict:
    """Sharpness (variance of the Laplacian), brightness and the largest face, measured on one frame."""
    global _face
    try:
        import cv2
    except Exception:  # noqa: BLE001
        return {}
    fd, fn = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    try:
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0, t):.2f}", "-i", path, "-frames:v", "1", "-vf", "scale=640:-2", "-y", fn], check=False)
        img = cv2.imread(fn)
        if img is None:
            return {}
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        bright = float(gray.mean())
        H, W = gray.shape
        face = None
        if _face is None:
            model = os.path.join(os.path.dirname(__file__), "assets", "models", "face_detection_yunet_2023mar.onnx")
            _face = cv2.FaceDetectorYN.create(model, "", (W, H), 0.75, 0.3, 50) if os.path.exists(model) else False
        if _face:
            _face.setInputSize((W, H))
            _, found = _face.detect(img)
            if found is not None and len(found):
                x, y, w, h = max(found, key=lambda f: f[2] * f[3])[:4]
                face = {"cx": round(float(x + w / 2) / W, 3), "cy": round(float(y + h / 2) / H, 3), "size": round(float(w) / W, 3)}
        return {"sharpness": round(sharp, 1), "brightness": round(bright, 1), "face": face}
    finally:
        try:
            os.remove(fn)
        except OSError:
            pass


def refine_word_times(words: list[dict], a: np.ndarray, prof: dict, max_len: float = 0.6) -> list[dict]:
    """Whisper sometimes stretches a word over a pause ("has......"). Trim long words to their voiced part."""
    rms, hop, sr = prof["rms"], prof["hop"], prof.get("sr", 16000)
    if not len(rms):
        return words
    thr = 10 ** ((max(prof["noise_db"], -70.0) + 12) / 20)
    out = []
    for w in words:
        d = w["end"] - w["start"]
        if d <= max_len:
            out.append(w)
            continue
        i0, i1 = int(w["start"] * sr / hop), int(w["end"] * sr / hop)
        voiced = rms[i0:i1] > thr
        if not voiced.any():
            out.append(w)
            continue
        # longest voiced run (gaps under 120 ms are bridged)
        runs, start, gap = [], None, 0
        for k, v in enumerate(voiced):
            if v:
                if start is None:
                    start = k
                gap = 0
                end = k
            elif start is not None:
                gap += 1
                if gap * hop / sr > 0.12:
                    runs.append((start, end))
                    start, gap = None, 0
        if start is not None:
            runs.append((start, end))
        a0, a1 = max(runs, key=lambda r: r[1] - r[0])
        ns = round(max(w["start"], (i0 + a0) * hop / sr - 0.03), 3)
        ne = round(min(w["end"], (i0 + a1 + 1) * hop / sr + 0.05), 3)
        out.append(dict(w, start=ns, end=max(ne, ns + 0.12)))
    return out


# ---------------------------------------------------------------- per take
def analyze_take(take_id: str, path: str, words: list[dict] | None = None, language: str | None = None, with_visual: bool = True, hints: str | None = None) -> dict:
    a = decode_audio(path)
    words = words if words is not None else recover_hidden_words(transcribe(path, language, audio=a, hints=hints), a, language=language)
    words = snap_to_hints(words, hints)
    words = mark_false_starts(words)
    prof = audio_profile(a)
    words = refine_word_times(words, a, prof)
    sents = sentences(words)
    for s in sents:
        s.update(sentence_audio(a, prof, s["start"], s["end"]))
        s.update(delivery(s))
        if with_visual:
            s["visual"] = visual(path, (s["start"] + s["end"]) / 2)
    faces = [s["visual"]["face"] for s in sents if s.get("visual", {}).get("face")]
    focus = {"x": float(np.median([f["cx"] for f in faces])), "y": float(np.median([f["cy"] for f in faces])) - 0.02} if faces else {"x": 0.5, "y": 0.42}
    return {"take_id": take_id, "path": path, "duration": round(len(a) / 16000, 2), "noise_db": round(prof["noise_db"], 1),
            "words": words, "sentences": sents, "focus": focus, "faces_found": len(faces)}


# ---------------------------------------------------------------- alignment
def _sim(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def _script_lines(script: str) -> list[list[str]]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", script.strip())
    return [[n for n in (_norm(w) for w in p.split()) if n] for p in parts if p.strip()]


def align(takes: list[dict], script: str | None = None) -> list[dict]:
    """Returns lines in script order; each line lists the sentence candidates from every take."""
    if script and script.strip():
        lines = [{"ref": ref, "text": None, "candidates": []} for ref in _script_lines(script)]
        for tk in takes:
            for si, s in enumerate(tk["sentences"]):
                best, bi = 0.0, None
                for li, ln in enumerate(lines):
                    sc = _sim(ln["ref"], s["norm"])
                    if sc > best:
                        best, bi = sc, li
                if bi is not None and best >= 0.5:
                    lines[bi]["candidates"].append({"take_id": tk["take_id"], "sent": si, "similarity": round(best, 3)})
        return [ln for ln in lines if ln["candidates"]]
    # no script: the most complete take is the reference, others are merged in order
    ref = max(takes, key=lambda tk: sum(len(s["norm"]) for s in tk["sentences"]))
    lines = [{"ref": s["norm"], "candidates": [{"take_id": ref["take_id"], "sent": i, "similarity": 1.0}]} for i, s in enumerate(ref["sentences"])]
    for tk in takes:
        if tk is ref:
            continue
        last = -1
        for si, s in enumerate(tk["sentences"]):
            best, bi = 0.0, None
            for li in range(len(lines)):
                sc = _sim(lines[li]["ref"], s["norm"])
                if sc > best:
                    best, bi = sc, li
            if bi is not None and best >= 0.55 and bi > last - 1:
                if not any(c["take_id"] == tk["take_id"] for c in lines[bi]["candidates"]):
                    lines[bi]["candidates"].append({"take_id": tk["take_id"], "sent": si, "similarity": round(best, 3)})
                last = bi
            elif len(s["norm"]) >= 3:
                lines.insert(last + 1, {"ref": s["norm"], "candidates": [{"take_id": tk["take_id"], "sent": si, "similarity": 1.0}]})
                last += 1
    return lines


# ---------------------------------------------------------------- scoring
def score_candidate(s: dict, sim: float, peers: list[dict]) -> tuple[float, dict]:
    parts = {}
    parts["content"] = 30 * sim
    parts["clarity"] = 16 * min(1.0, max(0.0, (s["snr_db"] - 12) / 22))
    lvl = s["speech_db"]
    parts["level"] = 0 if -32 <= lvl <= -4 else -4
    parts["clipping"] = -min(15.0, s["clip_frac"] * 3000)
    parts["fillers"] = -6 * s["fillers"]
    parts["repeats"] = -7 * s["repeats"]
    parts["unsure_words"] = -2.5 * min(4, s["unsure"])
    parts["long_pauses"] = -2.0 * s["long_pauses"]
    parts["pace"] = 0 if 1.7 <= s["wps"] <= 4.3 else -4
    v = s.get("visual") or {}
    sharp = [p.get("visual", {}).get("sharpness") for p in peers if p.get("visual", {}).get("sharpness")]
    if v.get("sharpness") and sharp:
        parts["sharpness"] = 8 * (v["sharpness"] / max(sharp))
    if any((p.get("visual") or {}).get("face") for p in peers):
        parts["face"] = 8 if v.get("face") else 0
    if v.get("brightness") is not None:
        parts["exposure"] = 2 if 60 <= v["brightness"] <= 200 else -3
    return round(sum(parts.values()), 2), {k: round(x, 2) for k, x in parts.items()}


_PART_WORDS = {
    "content": "most complete wording", "clarity": "clearest sound", "clipping": "no distortion", "fillers": "no 'um' or 'uh'",
    "repeats": "no repeated words", "unsure_words": "clearer pronunciation", "long_pauses": "smoother delivery",
    "pace": "better pace", "sharpness": "sharper picture", "face": "face clearly in frame", "exposure": "better lighting", "level": "better volume",
}


def _reason(pick: dict, others: list[dict]) -> str:
    """Names the two biggest advantages of the chosen candidate over the best alternative."""
    if not others:
        return "only take with this line"
    rival = max(others, key=lambda c: c["score"])
    diffs = sorted(((pick["parts"].get(k, 0) - rival["parts"].get(k, 0), k) for k in set(pick["parts"]) | set(rival["parts"])), reverse=True)
    bits = [_PART_WORDS.get(k, k) for d, k in diffs if d >= 1.0][:2]
    return ", ".join(bits) if bits else "about the same as the other takes"


def select(takes: list[dict], script: str | None = None, continuity_bonus: float = 4.0) -> dict:
    by_id = {t["take_id"]: t for t in takes}
    lines = align(takes, script)
    for ln in lines:
        peers = [by_id[c["take_id"]]["sentences"][c["sent"]] for c in ln["candidates"]]
        for c in ln["candidates"]:
            s = by_id[c["take_id"]]["sentences"][c["sent"]]
            c["score"], c["parts"] = score_candidate(s, c["similarity"], peers)
            c["text"] = s["text"]
    # Viterbi over lines: maximise total score + bonus for staying on the same take
    n = len(lines)
    best: list[dict] = [{} for _ in range(n)]
    for i, ln in enumerate(lines):
        for c in ln["candidates"]:
            if i == 0:
                best[i][c["take_id"]] = (c["score"], None)
                continue
            cands = [(v[0] + c["score"] + (continuity_bonus if k == c["take_id"] else 0), k) for k, v in best[i - 1].items()]
            sc, prev = max(cands)
            best[i][c["take_id"]] = (sc, prev)
    chosen = [None] * n
    if n:
        k = max(best[-1], key=lambda x: best[-1][x][0])
        for i in range(n - 1, -1, -1):
            chosen[i] = k
            k = best[i][k][1]
    out_lines = []
    for i, ln in enumerate(lines):
        pick = next(c for c in ln["candidates"] if c["take_id"] == chosen[i])
        others = [c for c in ln["candidates"] if c is not pick]
        reason = _reason(pick, others)
        if others and pick["score"] < max(o["score"] for o in others):
            reason += " (kept on the same take to avoid an extra cut)"
        out_lines.append({"index": i, "text": pick["text"], "take_id": pick["take_id"], "sent": pick["sent"], "score": pick["score"],
                          "reason": reason, "candidates": [{k2: c[k2] for k2 in ("take_id", "sent", "similarity", "score", "parts", "text")} for c in ln["candidates"]]})
    return {"lines": out_lines}


# ---------------------------------------------------------------- tightening
def tighten(take: dict, sent_idx: int, max_pause: float = 0.45, pad_in: float = 0.07, pad_out: float = 0.14) -> list[dict]:
    """Turns one chosen sentence into one or more clips: filler words dropped, long pauses shortened."""
    words = take["words"]
    s = take["sentences"][sent_idx]
    idx = [w["i"] for w in s["words"]]
    keep = [i for i in idx if _norm(words[i]["text"]) not in FILLERS and words[i]["text"].strip() and not words[i].get("false_start")]
    # drop the first of an immediately repeated word ("check check")
    keep2 = []
    for j, i in enumerate(keep):
        nxt = keep[j + 1] if j + 1 < len(keep) else None
        if nxt is not None and _norm(words[i]["text"]) == _norm(words[nxt]["text"]) and words[nxt]["start"] - words[i]["end"] < 1.2:
            continue
        keep2.append(i)
    if not keep2:
        return []
    groups: list[list[int]] = [[keep2[0]]]
    for i in keep2[1:]:
        prev = groups[-1][-1]
        only_merged = all(not words[k]["text"].strip() for k in range(prev + 1, i))  # joined number parts ("0" ".5")
        if only_merged and words[i]["start"] - words[prev]["end"] <= max_pause:
            groups[-1].append(i)
        else:
            groups.append([i])
    clips = []
    for gi, g in enumerate(groups):
        first, last = words[g[0]], words[g[-1]]
        prev_end = words[g[0] - 1]["end"] if g[0] > 0 else 0.0
        next_start = words[g[-1] + 1]["start"] if g[-1] + 1 < len(words) else take["duration"]
        t_in = max(first["start"] - pad_in, prev_end + 0.02 if g[0] > 0 else 0.0)
        is_last = gi == len(groups) - 1
        t_out = min(last["end"] + (pad_out if is_last else 0.09), next_start - 0.02 if g[-1] + 1 < len(words) else take["duration"])
        if t_out - t_in < 0.15:
            continue
        clips.append({"take_id": take["take_id"], "src": take["path"], "t_in": round(t_in, 3), "t_out": round(t_out, 3),
                      "words": [{"start": words[k]["start"], "end": words[k]["end"], "text": words[k]["text"]} for k in g]})
    return clips
