"""Learn an editing style from a reference video.

Measures what a viewer notices about an edit; the report goes into the prompt so Claude can match the style:
  * rhythm: hard cuts per minute (frame-difference scene detection) and how long shots last
  * how much of the video is the speaker vs full-screen graphics / B-roll (face detection), and whether those
    graphics are light or dark
  * the picture: warmth, saturation, contrast, teal-orange split, letterbox bars
  * captions: where they sit, how big they are, and the highlight colour (bright text detection)
  * sound: sound effects per minute (high-frequency transients) and how loud the music is under the voice
  * framing changes between shots (face size jumps = punch-ins)
Claude also watches the reference video itself (it is kept in Google Drive); these numbers make the match precise.
"""
from __future__ import annotations

import os
import subprocess

import numpy as np

import json

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def probe(path: str) -> dict:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path], capture_output=True, text=True, timeout=600,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()[-600:]}")
    info = json.loads(r.stdout)
    v = next((x for x in info["streams"] if x.get("codec_type") == "video"), None)
    w, h = (v or {}).get("width", 0), (v or {}).get("height", 0)
    rot = 0
    for sd in (v or {}).get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    return {"duration": float(info["format"].get("duration", 0)), "width": w, "height": h}

SR = 16000


def _frames(path, fps=4.0, width=240):
    pr = probe(path)
    w = width
    h = int(round(pr["height"] * w / pr["width"] / 2) * 2)
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True)
    n = len(r.stdout) // (w * h * 3)
    return np.frombuffer(r.stdout[: n * w * h * 3], dtype=np.uint8).reshape(n, h, w, 3), pr


def _audio(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _cuts(frames, fps):
    import cv2
    hs = []
    for f in frames:
        hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
        hs.append(cv2.normalize(h, h).flatten())
    cuts = []
    for i in range(1, len(frames)):
        corr = float(cv2.compareHist(hs[i - 1], hs[i], cv2.HISTCMP_CORREL))
        diff = float(np.mean(np.abs(frames[i].astype(np.int16) - frames[i - 1].astype(np.int16)))) / 255
        if corr < 0.55 or diff > 0.22:
            if not cuts or i / fps - cuts[-1] > 0.4:
                cuts.append(i / fps)
    return cuts


def _faces(frames):
    import cv2
    model = os.path.join(os.path.dirname(__file__), "assets", "models", "face_detection_yunet_2023mar.onnx")
    if not os.path.exists(model):
        return [None] * len(frames)
    h, w = frames[0].shape[:2]
    det = cv2.FaceDetectorYN.create(model, "", (w * 2, h * 2), 0.7, 0.3, 50)
    out = []
    for f in frames:
        big = cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2BGR), (w * 2, h * 2))
        _, found = det.detect(big)
        if found is not None and len(found):
            x, y, fw, fh = max(found, key=lambda r: r[2] * r[3])[:4]
            out.append({"cy": float(y + fh / 2) / (h * 2), "size": float(fh) / (h * 2)})
        else:
            out.append(None)
    return out


def _captions(frames):
    """Bright, low-saturation, wide components = caption words. Returns centre y, height and highlight hue."""
    import cv2
    ys, hs, hues = [], [], []
    for f in frames[:: max(1, len(frames) // 120)]:
        hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV)
        H, W = f.shape[:2]
        white = ((hsv[..., 2] > 225) & (hsv[..., 1] < 40)).astype(np.uint8)
        white[: int(H * 0.12)] = 0
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, W // 40), 3))
        blobs = cv2.morphologyEx(white, cv2.MORPH_CLOSE, k)
        n, lab, st, cen = cv2.connectedComponentsWithStats(blobs)
        for i in range(1, n):
            x, y, w, h, a = st[i]
            if w > W * 0.12 and H * 0.015 < h < H * 0.12 and w / max(h, 1) > 1.8 and a / (w * h) > 0.18:
                ys.append((y + h / 2) / H)
                hs.append(h / H)
                # colourful pixels right next to the words = highlight colour
                band = hsv[max(0, y - h): min(H, y + 2 * h), max(0, x - w // 4): min(W, x + w + w // 4)]
                col = band[(band[..., 1] > 140) & (band[..., 2] > 150)]
                if len(col) > 20:
                    hues.append(float(np.median(col[:, 0])))
    if not ys:
        return None
    hue = float(np.median(hues)) if len(hues) > len(ys) * 0.4 else None
    name = None
    if hue is not None:
        name = "yellow" if 18 <= hue <= 35 else "green" if 35 < hue <= 85 else "blue" if 85 < hue <= 130 else "red" if hue < 10 or hue > 160 else "orange"
    hexes = {"yellow": "#FFD60A", "green": "#2BD964", "blue": "#3D8BFF", "red": "#FF4D4D", "orange": "#FF9F1C"}
    return {"y": round(float(np.median(ys)), 3), "height": round(float(np.median(hs)), 4), "highlight": hexes.get(name), "highlight_name": name, "samples": len(ys)}


def _picture(frames, faces):
    sel = [f for f, fc in zip(frames, faces) if fc] or list(frames)
    a = np.stack(sel[:: max(1, len(sel) // 60)]).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    mx, mn = a.max(-1), a.min(-1)
    sat = float(np.mean((mx - mn) / (mx + 1e-4)))
    warm = float(np.mean(r - b))
    contrast = float(np.std(luma))
    dark, bright = luma < 0.3, luma > 0.65
    teal_orange = float(np.mean((b - r)[dark])) if dark.any() else 0.0
    teal_orange = teal_orange + (float(np.mean((r - b)[bright])) if bright.any() else 0.0)
    # letterbox: top and bottom rows black in most frames
    all_f = np.stack(frames[:: max(1, len(frames) // 60)]).astype(np.float32) / 255
    H = all_f.shape[1]
    lb = 0.0
    for frac in (0.12, 0.10, 0.08, 0.06, 0.04):
        rows = int(H * frac)
        top = all_f[:, :rows].mean(axis=(1, 2, 3))
        bot = all_f[:, -rows:].mean(axis=(1, 2, 3))
        if np.mean((top < 0.04) & (bot < 0.04)) > 0.7:
            lb = frac
            break
    return {"saturation": round(sat, 3), "warmth": round(warm, 3), "contrast": round(contrast, 3), "brightness": round(float(luma.mean()), 3),
            "teal_orange": round(teal_orange, 3), "letterbox": lb}


def _sound(a, dur):
    if not len(a):
        return {"sfx_per_min": 0.0, "music_rel_db": -60.0}
    hp = np.diff(np.diff(a, prepend=a[:1]), prepend=0.0)   # second difference: a simple high-pass
    fr = int(0.05 * SR)
    n = len(a) // fr
    e = np.array([np.sqrt(np.mean(a[i * fr:(i + 1) * fr] ** 2)) + 1e-9 for i in range(n)])
    eh = np.array([np.sqrt(np.mean(hp[i * fr:(i + 1) * fr] ** 2)) + 1e-9 for i in range(n)])
    db, dbh = 20 * np.log10(e), 20 * np.log10(eh)
    base = np.median(dbh)
    spikes = 0
    last = -10
    for i in range(2, n - 2):
        if dbh[i] > base + 9 and dbh[i] > dbh[i - 2] + 6 and i - last > 8:
            spikes += 1
            last = i
    speech = np.percentile(db, 80)
    quiet = np.percentile(db, 12)
    return {"sfx_per_min": round(spikes / max(dur / 60, 0.1), 1), "music_rel_db": round(float(quiet - speech), 1)}


def extract(path: str, name: str | None = None) -> dict:
    frames, pr = _frames(path)
    fps = 4.0
    dur = pr["duration"]
    cuts = _cuts(frames, fps)
    faces = _faces(frames)
    face_ratio = float(np.mean([f is not None for f in faces])) if faces else 1.0
    no_face = [fr for fr, fc in zip(frames, faces) if fc is None]
    g_luma = float(np.mean([fr.mean() / 255 for fr in no_face])) if no_face else None
    theme = None if g_luma is None else ("light" if g_luma > 0.6 else "dark" if g_luma < 0.38 else "mixed")
    sizes = [f["size"] for f in faces if f]
    face_jump = 0.0
    if len(sizes) > 4:
        s = np.array(sizes)
        face_jump = float(np.percentile(np.abs(np.diff(s)) / (s[:-1] + 1e-6), 90))
    cap = _captions(frames)
    pic = _picture(frames, faces)
    snd = _sound(_audio(path), dur)
    cut_every = dur / (len(cuts) + 1)
    graphics = 1 - face_ratio
    grade = "teal_orange" if pic["teal_orange"] > 0.12 else "warm" if pic["warmth"] > 0.05 else "punchy" if pic["saturation"] > 0.42 and pic["contrast"] > 0.22 else "clean"
    summary = [f"Cuts every {cut_every:.1f} s ({len(cuts)} cuts in {dur:.0f} s)",
               f"{graphics * 100:.0f}% of the time is full-screen graphics or B-roll" + (f" ({theme} look)" if theme else ""),
               f"Picture: {grade.replace('_', '-')} grade, saturation {pic['saturation']:.2f}, contrast {pic['contrast']:.2f}" + (", letterbox bars" if pic["letterbox"] else ""),
               (f"Captions around {cap['y'] * 100:.0f}% down the frame, {'large' if cap['height'] > 0.032 else 'small'}" + (f", {cap['highlight_name']} highlight" if cap and cap['highlight_name'] else "")) if cap else "No burned-in captions detected",
               f"About {snd['sfx_per_min']:.0f} sound effects a minute; music {abs(snd['music_rel_db']):.0f} dB under the voice",
               f"Shot size changes (punch-ins) of about {face_jump * 100:.0f}% between frames" if face_jump > 0.05 else "Steady framing (few punch-ins)"]
    return {"name": name or os.path.splitext(os.path.basename(path))[0], "summary": "; ".join(summary[:3]),
            "report": summary, "measured": {"duration": round(dur, 1), "cuts": [round(c, 2) for c in cuts], "face_ratio": round(face_ratio, 2), "picture": pic,
                                           "captions": cap, "sound": snd}}


if __name__ == "__main__":  # python -m studio.style_extract ref.mp4
    import json
    import sys
    print(json.dumps(extract(sys.argv[1]), indent=1)[:4000])
