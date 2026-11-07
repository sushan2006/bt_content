"""Your own machines as 3D objects.

From one or more photos of a machine:
  1. the machine is cut out of its background (U^2-Net salient-object model, runs on the CPU),
  2. a 3D model is built from the cut-out: the silhouette is inflated into a rounded solid (front and back surfaces
     meeting at the outline), surface detail comes from the photo's shading, and the photo is mapped onto it,
  3. preview renders from three angles are written so you can check it.
The model is then used like the built-in machines: it flies in or rises from behind the speaker, or turns on a
full-screen stage with its name.

One photo gives a convincing 3D "relief" that reads well when it turns up to about +/-35 degrees. A true all-round
model needs photogrammetry (dozens of photos all round) or a CAD file; if you have a CAD export (.obj / .stl / .glb)
put it next to the photos and it is used directly.
"""
from __future__ import annotations

import json
import math
import os

import numpy as np

MODEL = os.path.join(os.path.dirname(__file__), "assets", "models", "u2netp.onnx")
_sess = None


def cutout(path: str) -> np.ndarray:
    """RGBA image with the background removed."""
    global _sess
    import cv2
    from PIL import Image
    im = Image.open(path).convert("RGB")
    im.thumbnail((1600, 1600))
    rgb = np.asarray(im)
    if _sess is None:
        import onnxruntime as ort
        _sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
    x = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    out = _sess.run(None, {_sess.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0][0, 0]
    m = (out - out.min()) / (out.max() - out.min() + 1e-6)
    m = cv2.resize(m, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
    a = np.clip((m - 0.35) / 0.3, 0, 1)
    # keep the largest object only, fill holes
    bin_ = (a > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(bin_)
    if n > 1:
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        keep = (lab == big).astype(np.float32)
        keep = cv2.dilate(keep, np.ones((9, 9), np.uint8))
        a = a * keep
    return np.dstack([rgb, (a * 255).astype(np.uint8)])


def _crop(rgba, pad=0.04):
    ys, xs = np.where(rgba[..., 3] > 128)
    if not len(xs):
        return rgba
    h, w = rgba.shape[:2]
    p = int(max(w, h) * pad)
    return rgba[max(0, ys.min() - p): min(h, ys.max() + p), max(0, xs.min() - p): min(w, xs.max() + p)]


def relief_mesh(rgba: np.ndarray, width: float = 5.0, depth: float = 0.55, grid: int = 150):
    """Rounded solid from the silhouette + shading detail. Returns (pos, nrm, uv) as triangle lists."""
    import cv2
    h, w = rgba.shape[:2]
    gw = grid
    gh = max(8, int(round(grid * h / w)))
    alpha = cv2.resize(rgba[..., 3].astype(np.float32) / 255, (gw + 1, gh + 1), interpolation=cv2.INTER_AREA)
    lum = cv2.resize(cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, (gw + 1, gh + 1), interpolation=cv2.INTER_AREA)
    inside = (alpha > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
    # a solid with a flat face and rounded edges (like a real casing), not a pyramid
    edge = max(2.0, 0.10 * min(gw, gh))
    dist = cv2.GaussianBlur(dist, (0, 0), 1.2)
    prof = np.sin(np.pi / 2 * np.clip(dist / edge, 0, 1))
    detail = lum - cv2.GaussianBlur(lum, (0, 0), 6)                  # fine shading -> small bumps
    sx = width / gw
    height = width * gh / gw
    z = depth * prof + 0.10 * depth * detail * (prof > 0)
    zb = -0.55 * depth * prof
    X = (np.arange(gw + 1) * sx - width / 2)[None, :].repeat(gh + 1, 0)
    Y = (height / 2 - np.arange(gh + 1) * (height / gh))[:, None].repeat(gw + 1, 1)
    U = (np.arange(gw + 1) / gw)[None, :].repeat(gh + 1, 0)
    V = (np.arange(gh + 1) / gh)[:, None].repeat(gw + 1, 1)

    def normals(Z):
        dzdx = np.gradient(Z, axis=1) / sx
        dzdy = -np.gradient(Z, axis=0) / (height / gh)
        n = np.dstack([-dzdx, -dzdy, np.ones_like(Z)])
        return n / np.linalg.norm(n, axis=2, keepdims=True)

    NF, NB = normals(z), normals(zb) * np.array([1, 1, -1])
    cell_in = cv2.resize(rgba[..., 3].astype(np.float32) / 255, (gw, gh), interpolation=cv2.INTER_AREA) > 0.3
    iy, ix = np.where(cell_in)
    corners = [(0, 0), (1, 0), (0, 1), (0, 1), (1, 0), (1, 1)]      # two triangles per cell (dy, dx)
    P, N, T = [], [], []
    for Z, NN in ((z, NF), (zb, NB)):
        ys = np.stack([iy + dy for dy, dx in corners], 1).reshape(-1)
        xs = np.stack([ix + dx for dy, dx in corners], 1).reshape(-1)
        P.append(np.stack([X[ys, xs], Y[ys, xs], Z[ys, xs]], 1))
        N.append(NN[ys, xs])
        T.append(np.stack([U[ys, xs], V[ys, xs]], 1))
    pos, nrm, uv = (np.concatenate(L).astype(np.float32) for L in (P, N, T))
    return pos, nrm, uv, {"width": width, "height": round(float(height), 3), "depth": depth}


def load_cad(path: str, width: float = 5.0):
    import trimesh
    m = trimesh.load(path, force="mesh")
    m.apply_translation(-m.bounding_box.centroid)
    m.apply_scale(width / max(m.extents))
    v = m.vertices[m.faces].reshape(-1, 3).astype(np.float32)
    n = np.repeat(m.face_normals, 3, axis=0).astype(np.float32)
    return v, n


def build(images: list[str], out_dir: str, name: str = "Machine", cad: str | None = None) -> dict:
    from PIL import Image
    os.makedirs(out_dir, exist_ok=True)
    if cad and os.path.exists(cad):
        v, n = load_cad(cad)
        np.savez_compressed(os.path.join(out_dir, "mesh.npz"), pos=v, nrm=n)
        meta = {"name": name, "kind": "cad", "mesh": os.path.join(out_dir, "mesh.npz"), "texture": None}
    else:
        if not images:
            raise ValueError("add at least one photo of the machine")
        rgba = _crop(cutout(images[0]))
        tex = Image.fromarray(rgba, "RGBA")
        tex.thumbnail((1400, 1400))
        tex_path = os.path.join(out_dir, "texture.png")
        tex.save(tex_path)
        cut_paths = [tex_path]
        for i, extra in enumerate(images[1:6]):
            p = os.path.join(out_dir, f"cutout_{i + 2}.png")
            Image.fromarray(_crop(cutout(extra)), "RGBA").save(p)
            cut_paths.append(p)
        pos, nrm, uv, dims = relief_mesh(np.asarray(tex))
        np.savez_compressed(os.path.join(out_dir, "mesh.npz"), pos=pos, nrm=nrm, uv=uv)
        meta = {"name": name, "kind": "relief", "mesh": os.path.join(out_dir, "mesh.npz"), "texture": tex_path, "cutouts": cut_paths, **dims}
    meta["previews"] = previews(meta, out_dir)
    with open(os.path.join(out_dir, "machine.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    return meta


def previews(meta: dict, out_dir: str) -> list[str]:
    from PIL import Image
    from . import scene3d as S
    if not S.available():
        return []
    files = []
    tiles = []
    for k, yaw in enumerate((-0.55, 0.0, 0.55)):
        prm = {"machine": meta, "name": meta.get("name", ""), "yaw": yaw}
        img = S.render_machine_still(prm, 720, 720)
        bg = Image.new("RGBA", img.size[::-1] if False else (720, 720), (24, 34, 48, 255))
        bg.alpha_composite(Image.fromarray(img, "RGBA"))
        tiles.append(bg.convert("RGB"))
    sheet = Image.new("RGB", (720 * 3, 720))
    for i, t in enumerate(tiles):
        sheet.paste(t, (720 * i, 0))
    p = os.path.join(out_dir, "preview.jpg")
    sheet.save(p, quality=90)
    files.append(p)
    return files
