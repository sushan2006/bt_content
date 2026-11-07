"""3D building kit: any object described as parts (the language Claude writes), built into meshes, animated,
rendered with the studio renderer and exported as a .glb file.

An asset spec looks like:
{
  "id": "step_down_transformer", "name": "Step-down transformer",
  "parts": [
    {"id": "core", "shape": "box", "size": [2.4, 3.0, 0.7], "at": [0, 0, 0], "color": "#4A5563", "material": "metal"},
    {"id": "coil_hv", "shape": "coil", "radius": 0.55, "height": 1.8, "turns": 14, "wire": 0.07, "at": [-0.8, 0, 0], "material": "copper"},
    {"id": "front", "shape": "plate", "size": [2.0, 1.4], "at": [0, 0, 0.36], "photo": 0}
  ],
  "flows": [{"id": "current", "path": [[-2, 1, 0], [-0.8, 1, 0], [-0.8, -1, 0]], "kind": "current"}],
  "labels": [{"part": "core", "title": "Iron core", "sub": "carries the magnetic field"}]
}
Units are free: the asset is centred and scaled to the studio size when it is built.
Animations are separate (they belong to the moment in the video, not to the object):
  spin, explode, move, appear, fade_out, glow, pulse, highlight, flow, label.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from . import scene3d as S

# ---------------------------------------------------------------- the language
Shape = Literal["box", "cylinder", "tube", "cone", "sphere", "dome", "torus", "gear", "pipe", "coil", "plate", "text", "arrow", "rounded_box"]
Material = Literal["metal", "steel", "painted", "plastic", "rubber", "copper", "brass", "glass", "glow", "matte"]
Axis = Literal["x", "y", "z"]

MATERIALS = {   # metal, rough, emit, alpha
    "metal": (0.85, 0.28, 0.0, 1.0), "steel": (0.95, 0.22, 0.0, 1.0), "painted": (0.25, 0.34, 0.0, 1.0),
    "plastic": (0.0, 0.45, 0.0, 1.0), "rubber": (0.0, 0.85, 0.0, 1.0), "copper": (0.9, 0.3, 0.0, 1.0),
    "brass": (0.9, 0.3, 0.0, 1.0), "glass": (0.0, 0.05, 0.0, 0.32), "glow": (0.0, 0.3, 1.2, 1.0), "matte": (0.0, 0.7, 0.0, 1.0),
}
DEFAULT_COLOR = {"copper": "#D07A35", "brass": "#C9A13B", "steel": "#C7CDD5", "glass": "#DCEFFF", "rubber": "#22272E", "glow": "#FFD25A"}
NAMED_COLORS = {"blue": "#2F6FD6", "red": "#E2453A", "steel": "#9AA5B4", "dark": "#3A4350", "copper": "#D07A35", "gold": "#F2A21E",
                "teal": "#19A287", "water": "#3FA9F5", "green": "#2DBE6C", "white": "#EEF1F5", "black": "#1B1F24", "orange": "#F08A24",
                "yellow": "#FFD25A", "grey": "#7D8794", "gray": "#7D8794", "silver": "#C7CDD5"}
FLOW_COLORS = {"current": "#6FE4FF", "water": "#3FA9F5", "air": "#E8F4FF", "heat": "#FF7A2F", "signal": "#7CFF8A", "gas": "#B9F2D0", "oil": "#C98A2B", "light": "#FFF3B0"}

TARGET_W, TARGET_H = 5.4, 3.6          # studio size the asset is scaled into (the built-in machines are about this big)
FIT = 1.05                              # camera distance factor for full-screen stages


def _vec(v, n=3, name="value"):
    if v is None:
        return None
    v = [float(x) for x in (v if isinstance(v, (list, tuple)) else [v])]
    if len(v) == 1 and n > 1:
        v = v * n
    if len(v) != n:
        raise ValueError(f"{name} needs {n} numbers")
    return v


class KitPart(BaseModel):
    id: str
    shape: Shape
    at: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    rot: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])     # degrees about x, y, z
    axis: Axis = "y"                                                         # long axis of cylinders, cones, coils ...
    color: Optional[str] = None
    material: Material = "painted"
    group: Optional[str] = None
    hidden: bool = False                                                     # starts hidden (an "appear" action shows it)
    photo: Optional[int] = None                                              # plate: index of the photo mapped onto it
    # dimensions (only the ones the shape uses)
    size: Optional[list[float]] = None          # box/rounded_box [x,y,z]; plate [w,h]
    radius: Optional[float] = None
    radius_top: Optional[float] = None          # cone
    inner: Optional[float] = None               # tube inner radius
    height: Optional[float] = None
    thickness: Optional[float] = None           # torus tube radius / gear thickness
    arc: Optional[float] = None                 # torus arc in degrees
    teeth: Optional[int] = None
    turns: Optional[float] = None
    wire: Optional[float] = None
    path: Optional[list[list[float]]] = None    # pipe
    corner: Optional[float] = None
    text: Optional[str] = None
    depth: Optional[float] = None
    to: Optional[list[float]] = None            # arrow end (start is "at")

    @field_validator("at", "rot")
    @classmethod
    def _three(cls, v):
        return _vec(v, 3)

    @model_validator(mode="after")
    def _dims(self):
        s = self.shape
        need = {"box": ("size",), "rounded_box": ("size",), "cylinder": ("radius", "height"), "tube": ("radius", "inner", "height"),
                "cone": ("radius", "height"), "sphere": ("radius",), "dome": ("radius", "height"), "torus": ("radius", "thickness"),
                "gear": ("radius",), "pipe": ("path", "radius"), "coil": ("radius", "height"), "plate": ("size",), "text": ("text",), "arrow": ("to",)}[s]
        for k in need:
            if getattr(self, k) in (None, "", []):
                raise ValueError(f"part '{self.id}' ({s}) needs '{k}'")
        if s in ("box", "rounded_box"):
            self.size = _vec(self.size, 3, "size")
        if s == "plate":
            self.size = _vec(self.size, 2, "size")
        if s == "pipe" and len(self.path) < 2:
            raise ValueError(f"pipe '{self.id}' needs at least 2 points")
        if s == "tube" and not self.inner < self.radius:
            raise ValueError(f"tube '{self.id}': inner must be smaller than radius")
        for k in ("radius", "height", "thickness", "wire", "inner"):
            x = getattr(self, k)
            if x is not None and not (0 < x < 1e4):
                raise ValueError(f"part '{self.id}': {k} must be positive")
        return self


class KitFlow(BaseModel):
    id: str
    path: list[list[float]]
    kind: Literal["current", "water", "air", "heat", "signal", "gas", "oil", "light"] = "current"
    color: Optional[str] = None
    count: int = 24
    size: float = 0.07
    tube: bool = False          # draw a faint glass tube along the path

    @field_validator("path")
    @classmethod
    def _path(cls, v):
        if len(v) < 2:
            raise ValueError("a flow path needs at least 2 points")
        return [_vec(p, 3) for p in v]


class KitLabel(BaseModel):
    part: str
    title: str
    sub: str = ""


class Asset(BaseModel):
    id: str
    name: str = ""
    parts: list[KitPart]
    flows: list[KitFlow] = Field(default_factory=list)
    labels: list[KitLabel] = Field(default_factory=list)
    photos: list[str] = Field(default_factory=list)     # image paths for plates (filled in by the engine)
    notes: str = ""

    @model_validator(mode="after")
    def _check(self):
        if not self.parts:
            raise ValueError("an asset needs parts")
        if len(self.parts) > 400:
            raise ValueError("too many parts (max 400)")
        ids = [p.id for p in self.parts]
        if len(set(ids)) != len(ids):
            dup = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"duplicate part ids: {dup}")
        known = set(ids) | {p.group for p in self.parts if p.group}
        for lb in self.labels:
            if lb.part not in known:
                raise ValueError(f"label '{lb.title}' points at unknown part '{lb.part}'")
        for p in self.parts:
            if p.photo is not None and p.shape != "plate":
                raise ValueError(f"part '{p.id}': photos go on 'plate' parts")
        return self


class Action(BaseModel):
    do: Literal["spin", "explode", "move", "appear", "fade_out", "glow", "pulse", "highlight", "flow", "label"]
    at: float = 0.0                      # seconds from the start of the shot
    dur: float = 0.8
    until: Optional[float] = None
    target: str = "*"                    # part id, group name or "*"
    axis: Axis = "y"
    rpm: float = 60.0
    by: Optional[list[float]] = None     # move
    distance: float = 1.2                # explode
    color: Optional[str] = None
    flow: Optional[str] = None
    speed: float = 0.5
    title: str = ""
    sub: str = ""


# ---------------------------------------------------------------- building
def _axis_m(axis):
    return {"y": np.eye(4, dtype=np.float32), "x": S.AX_X, "z": S.AX_Z}[axis]


def _rot_m(rot):
    rx, ry, rz = (math.radians(a) for a in rot)
    return S.chain(S.RZ(rz), S.RY(ry), S.RX(rx))


def _cone(r0, r1, h, seg=64):
    return S.lathe([(0, -h / 2), (r0, -h / 2), (r0, -h / 2), (r1, h / 2), (r1, h / 2), (0, h / 2)], seg)


def _rounded_box(sx, sy, sz):
    import trimesh
    from shapely.geometry import box as sbox
    r = min(sx, sy) * 0.12
    poly = sbox(-sx / 2 + r, -sy / 2 + r, sx / 2 - r, sy / 2 - r).buffer(r, 8)
    m = trimesh.creation.extrude_polygon(poly, sz)
    m.apply_translation((0, 0, -sz / 2))
    v = m.vertices[m.faces].reshape(-1, 3)
    return S._tri(v, np.repeat(m.face_normals, 3, axis=0))


def _coil(r, h, turns, wire):
    n = max(24, int(turns * 28))
    pts = [(r * math.cos(2 * math.pi * turns * k / n), -h / 2 + h * k / n, r * math.sin(2 * math.pi * turns * k / n)) for k in range(n + 1)]
    return S.sweep(pts, wire, 12)


def _plate(w, h):
    hw, hh = w / 2, h / 2
    pos = np.array([(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)], np.float32)
    nrm = np.tile(np.array([0, 0, 1], np.float32), (6, 1))
    uv = np.array([(0, 1), (1, 1), (1, 0), (0, 1), (1, 0), (0, 0)], np.float32)   # V runs top-down like image rows
    return pos, nrm, uv


def _arrow(a, b, r):
    a, b = np.array(a, np.float64), np.array(b, np.float64)
    d = b - a
    L = float(np.linalg.norm(d)) or 1.0
    head = min(L * 0.35, r * 6)
    shaft = S.cylinder(r, L - head, 24)
    cone = _cone(r * 2.6, 0.0, head, 32)
    sp = shaft[0] + np.array([0, (L - head) / 2, 0], np.float32)
    cp = cone[0] + np.array([0, L - head / 2, 0], np.float32)
    pos = np.concatenate([sp, cp]).astype(np.float32)
    nrm = np.concatenate([shaft[1], cone[1]]).astype(np.float32)
    # rotate +Y onto d
    y = np.array([0, 1.0, 0])
    u = d / L
    v = np.cross(y, u)
    s, c = np.linalg.norm(v), float(np.dot(y, u))
    if s < 1e-8:
        R = np.eye(3) if c > 0 else np.diag([1, -1, -1])
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + vx + vx @ vx * ((1 - c) / s ** 2)
    return S._tri(pos @ R.T.astype(np.float32), nrm @ R.T.astype(np.float32))


def part_mesh(p: KitPart):
    s = p.shape
    if s == "box":
        return S.box(*p.size)
    if s == "rounded_box":
        return _rounded_box(*p.size)
    if s == "cylinder":
        return S.cylinder(p.radius, p.height, 64)
    if s == "tube":
        return S.tube_ring(p.radius, p.inner, p.height)
    if s == "cone":
        return _cone(p.radius, p.radius_top or 0.0, p.height)
    if s == "sphere":
        return S.sphere(p.radius, 3)
    if s == "dome":
        r, h = p.radius, p.height
        prof = [(0, h)] + [(r * math.sin(t), h * math.cos(t)) for t in np.linspace(0.05, math.pi / 2, 14)] + [(r, 0), (r, 0), (0, 0)]
        return S.lathe(prof, 64)
    if s == "torus":
        return S.torus(p.radius, p.thickness, arc=math.radians(p.arc) if p.arc else 2 * math.pi)
    if s == "gear":
        teeth = int(p.teeth or 12)
        return S.extrude(S.gear_poly(teeth, p.radius, p.radius * 0.82, p.inner or p.radius * 0.25), p.thickness or p.radius * 0.35)
    if s == "pipe":
        return S.sweep(S.round_path(p.path, p.corner if p.corner is not None else p.radius * 2.5), p.radius, 20)
    if s == "coil":
        return _coil(p.radius, p.height, p.turns or 10, p.wire or p.radius * 0.1)
    if s == "plate":
        return _plate(*p.size)
    if s == "text":
        size = p.height or 0.8
        return S.text_mesh(p.text, size, p.depth or size * 0.35)
    if s == "arrow":
        return _arrow((0, 0, 0), np.array(p.to) - np.array(p.at), p.radius or 0.08)
    raise ValueError(s)


def _color(p: KitPart, brand: dict | None = None) -> str:
    c = p.color or DEFAULT_COLOR.get(p.material, "#9AA5B4")
    if brand and c in (brand.get("colors") or {}):
        return brand["colors"][c]
    c = NAMED_COLORS.get(c.lower(), c) if isinstance(c, str) else c
    if not (isinstance(c, str) and c.startswith("#") and len(c) in (4, 7)):
        return "#9AA5B4"
    return c


class Built:
    """Meshes and rest matrices of an asset, centred and scaled to the studio size."""

    def __init__(self, asset: Asset):
        self.asset = asset
        self.meshes, self.rest, self.local = [], [], []
        for p in asset.parts:
            mesh = part_mesh(p)
            base = S.chain(S.T(*p.at), _rot_m(p.rot), _axis_m(p.axis) if p.shape in ("cylinder", "tube", "cone", "dome", "coil", "gear", "torus") else np.eye(4, dtype=np.float32))
            if p.shape == "gear":   # gear_poly lies in XY and extrudes along Z: make "axis" mean the turning axis
                base = S.chain(S.T(*p.at), _rot_m(p.rot), {"z": np.eye(4, dtype=np.float32), "y": S.RX(-math.pi / 2), "x": S.RY(math.pi / 2)}[p.axis])
            if p.shape in ("pipe", "arrow"):
                base = S.chain(S.T(*p.at), _rot_m(p.rot)) if p.shape == "arrow" else _rot_m(p.rot)
            if p.shape == "text":
                base = S.chain(S.T(*p.at), _rot_m(p.rot))
            self.meshes.append(mesh)
            self.local.append(base)
        # bounds of the whole asset in its own units
        pts = []
        for mesh, m in zip(self.meshes, self.local):
            v = mesh[0]
            idx = np.linspace(0, len(v) - 1, min(len(v), 400)).astype(int)
            pv = np.hstack([v[idx], np.ones((len(idx), 1), np.float32)]) @ m.T
            pts.append(pv[:, :3])
        for f in asset.flows:
            pts.append(np.array(f.path, np.float32))
        allp = np.concatenate(pts)
        lo, hi = allp.min(0), allp.max(0)
        self.center = (lo + hi) / 2
        ext = np.maximum(hi - lo, 1e-3)
        self.scale = float(min(TARGET_W / max(ext[0], ext[2] * 0.8), TARGET_H / ext[1]))
        self.norm = S.chain(S.S(self.scale), S.T(*(-self.center)))
        self.rest = [self.norm @ m for m in self.local]
        self.size = ext * self.scale                         # studio-size extents (x, y, z)
        self.index = {p.id: i for i, p in enumerate(asset.parts)}
        self.groups: dict[str, list[int]] = {}
        for i, p in enumerate(asset.parts):
            if p.group:
                self.groups.setdefault(p.group, []).append(i)
        self.flow_pts = {f.id: self._densify([self.norm @ np.array(list(q) + [1.0], np.float32) for q in f.path]) for f in asset.flows}

    @staticmethod
    def _densify(pts4):
        pts = [np.array(p[:3], np.float64) for p in pts4]
        return np.array(S.round_path(pts, 0.25), np.float32) if len(pts) > 2 else np.array(np.linspace(pts[0], pts[1], 24), np.float32)

    def targets(self, name: str) -> list[int]:
        if name in ("*", "", "all"):
            return list(range(len(self.asset.parts)))
        if name in self.index:
            return [self.index[name]]
        return list(self.groups.get(name, []))

    def anchor(self, name: str) -> tuple[float, float, float]:
        """Top of a part or group, in studio units: where its label points."""
        idx = self.targets(name)
        if not idx:
            return (0.0, 0.0, 0.0)
        pts = []
        for i in idx:
            v = self.meshes[i][0]
            sel = np.linspace(0, len(v) - 1, min(len(v), 200)).astype(int)
            pv = np.hstack([v[sel], np.ones((len(sel), 1), np.float32)]) @ self.rest[i].T
            pts.append(pv[:, :3])
        P = np.concatenate(pts)
        lo, hi = P.min(0), P.max(0)
        return (float((lo[0] + hi[0]) / 2), float(hi[1]), float(hi[2] * 0.6 + (lo[2] + hi[2]) * 0.2))

    def pivot(self, idx: list[int]) -> np.ndarray:
        return np.mean([self.rest[i][:3, 3] for i in idx], axis=0) if idx else np.zeros(3, np.float32)


_BUILT: dict[str, Built] = {}


def asset_key(spec: dict) -> str:
    return hashlib.sha1(json.dumps(spec, sort_keys=True, default=str).encode()).hexdigest()[:16]


def built(spec: dict) -> Built:
    k = asset_key(spec)
    if k not in _BUILT:
        _BUILT[k] = Built(Asset.model_validate(spec))
    return _BUILT[k]


def validate(spec: dict) -> tuple[Optional[Asset], Optional[str]]:
    try:
        a = Asset.model_validate(spec)
        Built(a)   # catches geometry errors (bad polygons, zero-length pipes ...)
        return a, None
    except Exception as e:  # noqa: BLE001
        return None, str(e)[:600]


# ---------------------------------------------------------------- animation
def _side(lb_p):
    return 1 if lb_p[0] >= 0 else -1


def pose(b: Built, tl: float, actions: list[dict], brand: dict | None = None, extra_labels: list[dict] | None = None):
    """Parts (scene3d.Part) and labels of the asset at local time tl."""
    acts = [Action.model_validate(a) for a in actions or []]
    n = len(b.asset.parts)
    M = [m.copy() for m in b.rest]
    alpha = np.array([0.0 if p.hidden else 1.0 for p in b.asset.parts], np.float32)
    emit = np.zeros(n, np.float32)
    emit_col: list[Optional[str]] = [None] * n
    dim = np.zeros(n, np.float32)
    flows_on: dict[str, tuple[float, Optional[float], float]] = {}
    labels = []
    for a in acts:
        idx = b.targets(a.target)
        p = S.smooth(S.prog(tl, a.at, max(0.05, a.dur)))
        live = tl >= a.at and (a.until is None or tl < a.until)
        if a.do == "spin" and tl >= a.at:
            w = (tl if a.until is None else min(tl, a.until)) - a.at
            # spin up smoothly over 0.6 s
            ang = 2 * math.pi * a.rpm / 60.0 * (w - 0.3 * (1 - math.exp(-w / 0.3)))
            piv = b.pivot(idx)
            R = {"x": S.RX, "y": S.RY, "z": S.RZ}[a.axis](ang)
            for i in idx:
                M[i] = S.chain(S.T(*piv), R, S.T(*(-piv))) @ M[i]
        elif a.do == "explode" and p > 0:
            c = b.pivot(list(range(n)))
            for i in idx:
                d = M[i][:3, 3] - c
                L = float(np.linalg.norm(d))
                d = d / L if L > 1e-4 else np.array([0, 1.0, 0])
                M[i] = S.T(*(d * a.distance * p)) @ M[i]
        elif a.do == "move" and p > 0 and a.by:
            off = np.array(_vec(a.by, 3), np.float32) * b.scale * p
            for i in idx:
                M[i] = S.T(*off) @ M[i]
        elif a.do == "appear":
            for i in idx:
                alpha[i] = p
                if p < 1:
                    piv = M[i][:3, 3].copy()
                    sc = 0.6 + 0.4 * S.ease_out_quint(p)
                    M[i] = S.chain(S.T(*piv), S.S(sc), S.T(*(-piv))) @ M[i]
        elif a.do == "fade_out":
            for i in idx:
                alpha[i] *= 1 - p
        elif a.do == "glow" and live:
            for i in idx:
                emit[i] = max(emit[i], 0.5 * p)
                emit_col[i] = a.color or "#FFD25A"
        elif a.do == "pulse" and tl >= a.at:
            k = math.exp(-(tl - a.at) * 3.0)
            for i in idx:
                emit[i] = max(emit[i], 1.1 * k)
                emit_col[i] = a.color or "#6FE4FF"
        elif a.do == "highlight" and live:
            keep = set(idx)
            for i in range(n):
                if i not in keep:
                    dim[i] = max(dim[i], 0.7 * p)
        elif a.do == "flow":
            fid = a.flow or a.target
            if fid in b.flow_pts:
                flows_on[fid] = (a.at, a.until, a.speed)
        elif a.do == "label":
            labels.append({"p": b.anchor(a.target), "title": a.title, "sub": a.sub, "at": a.at, "side": _side(b.anchor(a.target))})
    parts = []
    for i, pt in enumerate(b.asset.parts):
        if alpha[i] <= 0.002:
            continue
        mt, rough, em, al = MATERIALS[pt.material]
        col = _color(pt, brand)
        tex = None
        if pt.shape == "plate" and pt.photo is not None and pt.photo < len(b.asset.photos) and os.path.exists(b.asset.photos[pt.photo]):
            tex = b.asset.photos[pt.photo]
            col, mt, rough = "#FFFFFF", 0.0, 0.8
        e = max(em, float(emit[i]))
        parts.append(S.Part(b.meshes[i], M[i], col, mt, rough, emit=e, alpha=al * float(alpha[i]), dim=float(dim[i]), emit_color=emit_col[i] or col, tex=tex))
    # flowing particles
    for f in b.asset.flows:
        if f.id not in flows_on:
            continue
        at, until, spd = flows_on[f.id]
        if tl < at:
            continue
        fade = S.smooth(S.prog(tl, at, 0.4)) * (1 - (S.smooth(S.prog(tl, until, 0.4)) if until else 0.0))
        pts = b.flow_pts[f.id]
        col = f.color or FLOW_COLORS.get(f.kind, "#6FE4FF")
        if f.tube:
            parts.append(S.Part(S.custom(f"flowtube:{id(pts)}", lambda pts=pts: S.sweep(pts, f.size * 1.8, 16)), np.eye(4, dtype=np.float32), "#DCEFFF", 0.0, 0.05, alpha=0.3))
        seglen = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seglen)])
        total = float(cum[-1]) or 1.0
        for k in range(f.count):
            s = ((tl - at) * spd * 3.0 / total + k / f.count) % 1.0
            d = s * total
            j = min(len(seglen) - 1, int(np.searchsorted(cum, d, side="right") - 1))
            u = (d - cum[j]) / (seglen[j] or 1.0)
            q = pts[j] + (pts[j + 1] - pts[j]) * u
            mesh = S.M(f"sphere:{f.size:.3f}:2") if f.kind in ("water", "oil", "gas", "air") else S.M(f"box:{f.size * 2.2:.3f}:{f.size * 0.9:.3f}:{f.size * 0.9:.3f}")
            parts.append(S.Part(mesh, S.T(*q), col, 0.0, 0.2, emit=1.3 if f.kind in ("current", "signal", "heat", "light") else 0.35, alpha=0.95 * fade * math.sin(math.pi * s) ** 0.3))
    for lb in b.asset.labels:
        pass   # spec labels are shown through "label" actions with times; listed here for the GLB and the dashboard
    for lb in extra_labels or []:
        labels.append(lb)
    return parts, labels


# ---------------------------------------------------------------- scene3d hooks: over the speaker ("kit") and full screen
def model_kit(tl, prm):
    b = built(prm["asset"])
    return pose(b, tl, prm.get("actions") or [], prm.get("brand"))


def _cam_keys(b: Built, camera: str, dur: float, focus: Optional[str], aspect: float = 9 / 16):
    sx, sy, sz = (float(x) for x in b.size)
    t15 = math.tan(math.radians(15))
    # fit the object in a 9:16 frame (narrow horizontal field of view), leaving room for labels
    R = max(sy * 1.25 / (2 * t15), max(sx, sz) * 1.15 / (2 * t15 * aspect)) * FIT
    tgt = (0.0, 0.0, 0.0)
    if camera.startswith("detail") or focus:
        name = focus or camera.split(":", 1)[-1]
        ft = b.anchor(name)
        ftgt = (ft[0], ft[1] - 0.3, ft[2] * 0.5)
        return [(0.0, (R * 0.35, R * 0.22, R * 0.95), tgt, 30), (min(dur, 1.6), (ft[0] + R * 0.25, ft[1] + R * 0.12, R * 0.62), ftgt, 30),
                (dur, (ft[0] + R * 0.18, ft[1] + R * 0.1, R * 0.55), ftgt, 30)]
    if camera == "push_in":
        return [(0.0, (R * 0.3, R * 0.3, R * 1.2), tgt, 30), (dur, (R * 0.2, R * 0.2, R * 0.86), tgt, 30)]
    if camera == "pull_back":
        return [(0.0, (R * 0.15, R * 0.18, R * 0.82), tgt, 30), (dur, (R * 0.35, R * 0.32, R * 1.2), tgt, 30)]
    if camera == "rise":
        return [(0.0, (R * 0.5, -R * 0.12, R * 0.9), (0, -sy * 0.2, 0), 30), (dur, (R * 0.35, R * 0.55, R * 0.85), (0, sy * 0.1, 0), 30)]
    if camera == "top_down":
        return [(0.0, (0.01, R * 1.05, R * 0.35), tgt, 30), (dur, (R * 0.2, R * 0.95, R * 0.55), tgt, 30)]
    # orbit (default): a slow 48 degree turn around the object
    keys = []
    for k in range(5):
        u = k / 4
        a = math.radians(-24 + 48 * u)
        keys.append((dur * u, (R * math.sin(a), R * (0.32 - 0.08 * u), R * math.cos(a)), tgt, 30))
    return keys


def stage_kit(tl, dur, prm):
    b = built(prm["asset"])
    parts, labels = pose(b, tl, prm.get("actions") or [], prm.get("brand"))
    keys = _cam_keys(b, prm.get("camera", "orbit"), dur, prm.get("focus"), float(prm.get("aspect_ratio", 9 / 16)))
    return parts, labels, keys, -float(b.size[1]) / 2


S.MODELS["kit"] = model_kit
S.BASE_POSE["kit"] = (0.35, 0.22, 0.0)
S.SCALE["kit"] = 1.0
S.STAGES["kit"] = stage_kit


# ---------------------------------------------------------------- stills and .glb
def preview(spec: dict, out_path: str, actions: list[dict] | None = None, size: int = 640) -> str:
    """Three-angle preview sheet (the dashboard shows it; Claude looks at it to check its own model)."""
    from PIL import Image
    b = built(spec)
    R = S.Renderer.get(size, size)
    tiles = []
    for yaw in (-0.6, 0.0, 0.6):
        parts, _ = pose(b, 99.0 if actions else 0.0, actions or [])
        for p in parts:
            p.model = S.RY(yaw) @ p.model
        sx, sy, sz = b.size
        dist = max(sx, sy * 1.15, sz) / (2 * math.tan(math.radians(15))) * 1.18
        eye = (0.0, dist * 0.22, dist)
        img = R.render(parts, S.look_at(eye, (0, 0, 0)), S.perspective(math.radians(30), 1.0), eye)
        bg = Image.new("RGBA", (size, size), (24, 34, 48, 255))
        bg.alpha_composite(Image.fromarray(img, "RGBA"))
        tiles.append(bg.convert("RGB"))
    sheet = Image.new("RGB", (size * 3, size))
    for i, t in enumerate(tiles):
        sheet.paste(t, (size * i, 0))
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    sheet.save(out_path, quality=88)
    return out_path


def export_glb(spec: dict, out_path: str) -> str:
    """Writes the asset as a standard .glb (opens in Blender, Windows 3D Viewer, three.js ...)."""
    import trimesh
    from PIL import Image
    b = built(spec)
    scene = trimesh.Scene()
    for i, p in enumerate(b.asset.parts):
        mesh = b.meshes[i]
        pos = mesh[0].astype(np.float64)
        faces = np.arange(len(pos)).reshape(-1, 3)
        mt, rough, em, al = MATERIALS[p.material]
        col = _color(p)
        rgb = [int(col.lstrip("#")[k:k + 2], 16) for k in (0, 2, 4)] if len(col) == 7 else [150, 160, 170]
        if p.shape == "plate" and p.photo is not None and p.photo < len(b.asset.photos) and os.path.exists(b.asset.photos[p.photo]):
            uv = mesh[2].astype(np.float64).copy()
            uv[:, 1] = 1.0 - uv[:, 1]          # glTF/trimesh UV origin is bottom-left
            mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.open(b.asset.photos[p.photo]).convert("RGBA"), metallicFactor=0.0, roughnessFactor=0.8,
                                                      alphaMode="MASK")
            visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
        else:
            mat = trimesh.visual.material.PBRMaterial(baseColorFactor=rgb + [int(255 * al)], metallicFactor=mt, roughnessFactor=rough,
                                                      emissiveFactor=[c / 255 * min(1.0, em) for c in rgb] if em else None, alphaMode="BLEND" if al < 1 else "OPAQUE")
            visual = trimesh.visual.TextureVisuals(material=mat)
        tm = trimesh.Trimesh(vertices=pos, faces=faces, vertex_normals=mesh[1].astype(np.float64), visual=visual, process=False)
        scene.add_geometry(tm, node_name=p.id, geom_name=p.id, transform=b.rest[i].astype(np.float64))
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    data = scene.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(data)
    return out_path


def save(spec: dict, out_dir: str) -> dict:
    """Validates, writes spec.json, model.glb and preview.jpg. Returns a summary for the dashboard."""
    a, err = validate(spec)
    if err:
        raise ValueError(err)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=1)
    out = {"id": a.id, "name": a.name or a.id, "spec_path": os.path.join(out_dir, "spec.json"), "parts": len(a.parts), "key": asset_key(spec)}
    try:
        out["glb"] = export_glb(spec, os.path.join(out_dir, "model.glb"))
    except Exception as e:  # noqa: BLE001
        out["glb_error"] = str(e)[:200]
    if S.available():
        try:
            out["preview"] = preview(spec, os.path.join(out_dir, "preview.jpg"))
        except Exception as e:  # noqa: BLE001
            out["preview_error"] = str(e)[:200]
    return out
