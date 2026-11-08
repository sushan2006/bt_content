"""Brand kit: logo clean-up (white background removal) and palette extraction."""
from __future__ import annotations

import colorsys
import os

import numpy as np
from PIL import Image

DEFAULT_COLORS = {
    "primary": "#18A689", "accent": "#F39C1A", "alert": "#E8453C",
    "dark": "#1E2E40", "darker": "#111B27", "light": "#FFFFFF",
}


def _hex(rgb) -> str:
    return "#" + "".join(f"{int(max(0, min(255, c))):02x}" for c in rgb)


def prepare_logo(src: str, out_path: str, min_size: int = 900) -> dict:
    """Makes a transparent, tightly cropped, upscaled PNG. Handles white or near-white backgrounds."""
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0
    corners = np.concatenate([rgb[:4, :4].reshape(-1, 3), rgb[:4, -4:].reshape(-1, 3), rgb[-4:, :4].reshape(-1, 3), rgb[-4:, -4:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    already_transparent = float((alpha < 0.05).mean()) > 0.2
    if not already_transparent and bg.min() > 200:
        # distance from the background colour -> alpha, then un-mix the background from the edge pixels
        dist = np.max(np.abs(rgb - bg), axis=-1)
        new_a = np.clip((dist - 8) / 60.0, 0, 1)
        safe = np.maximum(new_a, 1e-3)[..., None]
        rgb = np.clip((rgb - (1 - new_a[..., None]) * bg) / safe, 0, 255)
        alpha = new_a * alpha
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    pad = int(max(w, h) * 0.04)
    canvas = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    canvas.paste(img, (pad, pad))
    img = canvas
    if max(img.size) < min_size:
        s = min_size / max(img.size)
        img = img.resize((int(img.width * s), int(img.height * s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    img.save(out_path)
    # version for dark backgrounds: very dark logo colours become white
    arr = np.asarray(img).astype(np.float32)
    lum = (0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]) / 255
    sat = (arr[..., :3].max(-1) - arr[..., :3].min(-1)) / 255
    dark = (lum < 0.32) & (sat < 0.35)
    arr[dark, :3] = 255
    light_path = os.path.splitext(out_path)[0] + "_light.png"
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(light_path)
    return {"path": out_path, "light_path": light_path, "width": img.width, "height": img.height, "source_width": im.width, "source_height": im.height,
            "low_resolution": max(im.size) < 500}


def extract_palette(src: str, k: int = 8) -> dict:
    """Finds the logo's main colours and assigns them to roles."""
    im = Image.open(src).convert("RGBA")
    im.thumbnail((300, 300))
    a = np.asarray(im).reshape(-1, 4).astype(np.float32)
    a = a[a[:, 3] > 200][:, :3]
    if len(a) == 0:
        return dict(DEFAULT_COLORS)
    # drop near-white / near-grey pixels (background, anti-aliasing)
    mx, mn = a.max(1), a.min(1)
    keep = ~((mn > 215) | ((mx - mn) < 18) & (mx > 120))
    px = a[keep] if keep.sum() > 50 else a
    rng = np.random.default_rng(0)
    cent = px[rng.choice(len(px), size=min(k, len(px)), replace=False)]
    for _ in range(25):
        d = ((px[:, None, :] - cent[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        cent = np.array([px[lab == i].mean(0) if (lab == i).any() else cent[i] for i in range(len(cent))])
    counts = np.bincount(lab, minlength=len(cent))
    order = np.argsort(-counts)
    cols = [(cent[i], counts[i]) for i in order if counts[i] > 0.02 * len(px)]
    info = []
    for c, n in cols:
        h, l, s = colorsys.rgb_to_hls(*(c / 255))
        info.append({"hex": _hex(c), "h": h, "l": l, "s": s, "n": int(n)})
    roles = dict(DEFAULT_COLORS)
    info = [x for x in info if x["l"] < 0.72] or info
    dark = min(info, key=lambda x: x["l"]) if info else None
    if dark and dark["l"] < 0.35:
        roles["dark"] = dark["hex"]
        r = np.array([int(dark["hex"][i:i + 2], 16) for i in (1, 3, 5)]) * 0.6
        roles["darker"] = _hex(r)
    vivid = [x for x in info if x is not dark and x["s"] > 0.35]
    cool = [x for x in vivid if 0.35 < x["h"] < 0.75]
    warm = [x for x in vivid if x["h"] <= 0.12 or x["h"] >= 0.9 or 0.12 < x["h"] <= 0.2]
    if cool:
        roles["primary"] = max(cool, key=lambda x: x["n"])["hex"]
    oranges = [x for x in warm if 0.05 < x["h"] <= 0.2]
    reds = [x for x in warm if x["h"] <= 0.05 or x["h"] >= 0.9]
    if oranges:
        roles["accent"] = max(oranges, key=lambda x: x["n"])["hex"]
    if reds:
        roles["alert"] = max(reds, key=lambda x: x["n"])["hex"]
    roles["found"] = [x["hex"] for x in info]
    return roles
