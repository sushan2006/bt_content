"""Contact sheets: what Claude looks at (frames from the raw video, storyboards of its own edit, reference videos)."""
from __future__ import annotations

import os
import subprocess

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")


def _font(size: int):
    from PIL import ImageFont
    here = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")
    for name in ("Inter-Bold.otf", "Inter-Medium.otf", "Inter-Bold.ttf"):
        p = os.path.join(here, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def grab(path: str, t: float, out: str, height: int = 480) -> str | None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, t):.2f}", "-i", path, "-frames:v", "1",
                    "-vf", f"scale=-2:{height}", "-y", out], check=False, timeout=60)
    return out if os.path.exists(out) and os.path.getsize(out) > 0 else None


def sheet(images: list[tuple[str, str]], out: str, cols: int = 4, tile_h: int = 420) -> str:
    """images: [(path, caption)] -> one JPEG grid with a caption on each tile."""
    from PIL import Image, ImageDraw
    tiles = []
    for p, cap in images:
        try:
            im = Image.open(p).convert("RGB")
        except Exception:  # noqa: BLE001
            continue
        w = int(im.width * tile_h / im.height)
        tiles.append((im.resize((w, tile_h)), cap))
    if not tiles:
        raise ValueError("no frames")
    tw = max(t[0].width for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    S = Image.new("RGB", (cols * tw + (cols + 1) * 6, rows * (tile_h + 34) + 6), (18, 22, 28))
    d = ImageDraw.Draw(S)
    f = _font(20)
    for i, (im, cap) in enumerate(tiles):
        x = 6 + (i % cols) * (tw + 6)
        y = 6 + (i // cols) * (tile_h + 34)
        S.paste(im, (x + (tw - im.width) // 2, y))
        d.text((x + 4, y + tile_h + 6), cap[:44], fill=(230, 235, 240), font=f)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    S.save(out, quality=80)
    return out


def raw_sheets(plan: dict, out_dir: str, n: int = 16, per_sheet: int = 8) -> list[str]:
    """Frames of the raw footage at evenly spaced moments of the edited video, captioned with the output time."""
    clips = plan["clips"]
    speech = sum(c["t_out"] - c["t_in"] for c in clips)
    times = [speech * (k + 0.5) / n for k in range(n)]
    os.makedirs(out_dir, exist_ok=True)
    shots = []
    for k, t in enumerate(times):
        off = 0.0
        for c in clips:
            d = c["t_out"] - c["t_in"]
            if t < off + d:
                p = grab(c["src"], c["t_in"] + (t - off), os.path.join(out_dir, f"raw_{k:02d}.jpg"))
                if p:
                    shots.append((p, f"{t:5.1f}s"))
                break
            off += d
    return [sheet(shots[i:i + per_sheet], os.path.join(out_dir, f"raw_sheet_{i // per_sheet}.jpg"), cols=4) for i in range(0, len(shots), per_sheet)]


def video_sheets(path: str, out_dir: str, n: int = 16, per_sheet: int = 8, duration: float | None = None) -> list[str]:
    """Evenly spaced frames of any video (reference videos)."""
    from ..render import probe
    dur = duration or float(probe(path).get("duration") or 30.0)
    os.makedirs(out_dir, exist_ok=True)
    shots = []
    for k in range(n):
        t = dur * (k + 0.5) / n
        p = grab(path, t, os.path.join(out_dir, f"ref_{k:02d}.jpg"))
        if p:
            shots.append((p, f"{t:5.1f}s"))
    return [sheet(shots[i:i + per_sheet], os.path.join(out_dir, f"ref_sheet_{i // per_sheet}.jpg"), cols=4) for i in range(0, len(shots), per_sheet)]


def transition_sheets(path: str, cuts: list[float], out_dir: str, max_cuts: int = 8, duration: float | None = None) -> list[str]:
    """For a reference video: five frames around each detected cut (-0.20, -0.07, 0, +0.07, +0.20 s), one row per cut,
    so Claude can see HOW the video changes shot or brings a graphic in (hard cut, whip, zoom, dissolve, slide, mask ...)."""
    if not cuts:
        return []
    picks = cuts if len(cuts) <= max_cuts else [cuts[round(i * (len(cuts) - 1) / (max_cuts - 1))] for i in range(max_cuts)]
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for ci, c in enumerate(picks):
        row = []
        for k, dt in enumerate((-0.20, -0.07, 0.0, 0.07, 0.20)):
            t = c + dt
            if t < 0 or (duration and t > duration):
                continue
            p = grab(path, t, os.path.join(out_dir, f"cut_{ci:02d}_{k}.jpg"), height=360)
            if p:
                row.append((p, f"cut {ci + 1} @{c:.1f}s {dt:+.2f}"))
        if row:
            rows.append(row)
    sheets = []
    for i in range(0, len(rows), 2):
        tiles = [t for r in rows[i:i + 2] for t in r]
        sheets.append(sheet(tiles, os.path.join(out_dir, f"cut_sheet_{i // 2}.jpg"), cols=5, tile_h=360))
    return sheets


def storyboard_sheets(plan: dict, times: list[float], out_dir: str, per_sheet: int = 8, labels: dict | None = None) -> list[str]:
    from ..render import storyboard
    files = storyboard(plan, times, out_dir, 360)
    labels = labels or {}
    shots = list(zip(files, [f"{t:5.2f}s" + (f" {labels[t]}" if t in labels else "") for t in sorted(times)]))
    return [sheet(shots[i:i + per_sheet], os.path.join(out_dir, f"sb_sheet_{i // per_sheet}.jpg"), cols=4) for i in range(0, len(shots), per_sheet)]
