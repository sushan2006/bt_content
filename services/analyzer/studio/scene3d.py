"""Real-time 3D for the editorial cut: modelled objects (meshes), studio lighting, MSAA and motion blur.

The objects are built from code (lathe, extrude, sweep), lit by a key / fill / rim setup with a soft studio
environment for reflections, and rendered with OpenGL (moderngl, EGL on servers, the normal driver on desktops).
Each object flies in from far away, settles, turns very slowly like a product shot, and flies out again.
Labels are attached to 3D anchor points and drawn as clean 2D call-outs.
"""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache

import numpy as np

# ---------------------------------------------------------------- math
def _m(a):
    return np.array(a, dtype=np.float32)


def T(x=0.0, y=0.0, z=0.0):
    m = np.eye(4, dtype=np.float32)
    m[:3, 3] = (x, y, z)
    return m


def S(x=1.0, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return np.diag([x, y, z, 1.0]).astype(np.float32)


def RX(a):
    c, s = math.cos(a), math.sin(a)
    return _m([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]])


def RY(a):
    c, s = math.cos(a), math.sin(a)
    return _m([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]])


def RZ(a):
    c, s = math.cos(a), math.sin(a)
    return _m([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])


def chain(*ms):
    out = np.eye(4, dtype=np.float32)
    for m in ms:
        out = out @ m
    return out


def perspective(fovy, aspect, near=0.1, far=200.0):
    f = 1.0 / math.tan(fovy / 2)
    return _m([[f / aspect, 0, 0, 0], [0, f, 0, 0], [0, 0, (far + near) / (near - far), 2 * far * near / (near - far)], [0, 0, -1, 0]])


def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = (np.array(v, dtype=np.float32) for v in (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    s = np.cross(f, up)
    s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4, dtype=np.float32)
    m[0, :3], m[1, :3], m[2, :3] = s, u, -f
    m[:3, 3] = -m[:3, :3] @ eye
    return m


# ---------------------------------------------------------------- meshes (non-indexed triangles: pos, normal)
def _tri(pos, nrm):
    return np.ascontiguousarray(pos, dtype=np.float32).reshape(-1, 3), np.ascontiguousarray(nrm, dtype=np.float32).reshape(-1, 3)


def lathe(profile, seg=72, smooth=True):
    """Revolves a (radius, y) profile around the Y axis. Hard edges where consecutive points repeat."""
    pr = np.array(profile, dtype=np.float32)
    th = np.linspace(0, 2 * np.pi, seg + 1, dtype=np.float32)
    ct, st = np.cos(th), np.sin(th)
    P, N = [], []
    for i in range(len(pr) - 1):
        (r0, y0), (r1, y1) = pr[i], pr[i + 1]
        if abs(r0 - r1) < 1e-6 and abs(y0 - y1) < 1e-6:
            continue
        dy, dr = y1 - y0, r1 - r0
        ln = math.hypot(dy, dr) or 1.0
        nr, ny = dy / ln, -dr / ln          # outward normal of the segment
        for k in range(seg):
            a0 = (r0 * ct[k], y0, r0 * st[k])
            a1 = (r0 * ct[k + 1], y0, r0 * st[k + 1])
            b0 = (r1 * ct[k], y1, r1 * st[k])
            b1 = (r1 * ct[k + 1], y1, r1 * st[k + 1])
            n0 = (nr * ct[k], ny, nr * st[k])
            n1 = (nr * ct[k + 1], ny, nr * st[k + 1])
            if not smooth:
                n0 = n1 = (nr * (ct[k] + ct[k + 1]) / 2, ny, nr * (st[k] + st[k + 1]) / 2)
            P += [a0, b0, a1, a1, b0, b1]
            N += [n0, n0, n1, n1, n0, n1]
    return _tri(P, N)


def cylinder(r, h, seg=64, caps=True):
    prof = [(0, -h / 2), (r, -h / 2), (r, -h / 2), (r, h / 2), (r, h / 2), (0, h / 2)] if caps else [(r, -h / 2), (r, h / 2)]
    return lathe(prof, seg)


def tube_ring(r_out, r_in, h, seg=72):
    return lathe([(r_in, -h / 2), (r_out, -h / 2), (r_out, -h / 2), (r_out, h / 2), (r_out, h / 2), (r_in, h / 2), (r_in, h / 2), (r_in, -h / 2)], seg)


def torus(R, r, seg=72, seg2=20, arc=2 * np.pi):
    P, N = [], []
    us = np.linspace(0, arc, seg + 1)
    vs = np.linspace(0, 2 * np.pi, seg2 + 1)
    for i in range(seg):
        for j in range(seg2):
            quad = []
            for (u, v) in ((us[i], vs[j]), (us[i + 1], vs[j]), (us[i], vs[j + 1]), (us[i + 1], vs[j + 1])):
                n = (math.cos(v) * math.cos(u), math.sin(v), math.cos(v) * math.sin(u))
                p = ((R + r * math.cos(v)) * math.cos(u), r * math.sin(v), (R + r * math.cos(v)) * math.sin(u))
                quad.append((p, n))
            for a, b, c in ((0, 2, 1), (1, 2, 3)):
                P += [quad[a][0], quad[b][0], quad[c][0]]
                N += [quad[a][1], quad[b][1], quad[c][1]]
    return _tri(P, N)


def box(sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [((1, 0, 0), [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]),
             ((-1, 0, 0), [(-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz)]),
             ((0, 1, 0), [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
             ((0, -1, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz)]),
             ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
             ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)])]
    P, N = [], []
    for n, q in faces:
        P += [q[0], q[1], q[2], q[0], q[2], q[3]]
        N += [n] * 6
    return _tri(P, N)


def sphere(r, sub=3):
    import trimesh
    m = trimesh.creation.icosphere(subdivisions=sub, radius=r)
    v = m.vertices[m.faces].reshape(-1, 3)
    return _tri(v, v / r)


def sweep(path, r, seg=20, closed=False):
    """Tube of radius r along a 3D polyline (parallel-transport frames)."""
    pts = np.array(path, dtype=np.float64)
    n = len(pts)
    tang = np.zeros_like(pts)
    tang[1:-1] = pts[2:] - pts[:-2]
    tang[0] = pts[1] - pts[0]
    tang[-1] = pts[-1] - pts[-2]
    tang /= np.linalg.norm(tang, axis=1)[:, None]
    ref = np.array([0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.array([1.0, 0, 0])
    nor = np.cross(tang[0], ref)
    nor /= np.linalg.norm(nor)
    frames = []
    for i in range(n):
        if i:
            nor = nor - tang[i] * np.dot(nor, tang[i])
            nor /= np.linalg.norm(nor)
        frames.append((nor, np.cross(tang[i], nor)))
    ang = np.linspace(0, 2 * np.pi, seg + 1)
    rings = [[pts[i] + r * (math.cos(a) * frames[i][0] + math.sin(a) * frames[i][1]) for a in ang] for i in range(n)]
    norms = [[(math.cos(a) * frames[i][0] + math.sin(a) * frames[i][1]) for a in ang] for i in range(n)]
    P, N = [], []
    for i in range(n - 1):
        for k in range(seg):
            P += [rings[i][k], rings[i + 1][k], rings[i][k + 1], rings[i][k + 1], rings[i + 1][k], rings[i + 1][k + 1]]
            N += [norms[i][k], norms[i + 1][k], norms[i][k + 1], norms[i][k + 1], norms[i + 1][k], norms[i + 1][k + 1]]
    return _tri(P, N)


def round_path(points, radius=0.35, steps=8):
    """Polyline with rounded corners (for pipes)."""
    p = [np.array(x, dtype=np.float64) for x in points]
    out = [p[0]]
    for i in range(1, len(p) - 1):
        a, b, c = p[i - 1], p[i], p[i + 1]
        d1, d2 = (a - b), (c - b)
        l1, l2 = np.linalg.norm(d1), np.linalg.norm(d2)
        rr = min(radius, l1 / 2, l2 / 2)
        s, e = b + d1 / l1 * rr, b + d2 / l2 * rr
        for k in range(steps + 1):
            t = k / steps
            out.append((1 - t) ** 2 * s + 2 * (1 - t) * t * b + t ** 2 * e)
    out.append(p[-1])
    # densify straight runs so the tube bends evenly
    dense = [out[0]]
    for q in out[1:]:
        L = np.linalg.norm(q - dense[-1])
        k = max(1, int(L / 0.25))
        for j in range(1, k + 1):
            dense.append(dense[-1] + (q - dense[-1]) * (1 / (k - j + 1)))
    return dense


def extrude(poly, depth):
    """Shapely polygon (x, y) extruded along Z, centred on z=0. Flat shaded."""
    import trimesh
    m = trimesh.creation.extrude_polygon(poly, depth)
    m.apply_translation((0, 0, -depth / 2))
    v = m.vertices[m.faces].reshape(-1, 3)
    n = np.repeat(m.face_normals, 3, axis=0)
    return _tri(v, n)


def _skia_contours(path, tol=0.6):
    import skia
    it = skia.Path.Iter(path, True)
    contours, cur = [], []
    while True:
        verb, pts = it.next()
        if verb == skia.Path.Verb.kDone_Verb:
            break
        if verb == skia.Path.Verb.kMove_Verb:
            if len(cur) > 2:
                contours.append(cur)
            cur = [(pts[0].x(), pts[0].y())]
        elif verb == skia.Path.Verb.kLine_Verb:
            cur.append((pts[1].x(), pts[1].y()))
        elif verb == skia.Path.Verb.kQuad_Verb:
            p0, p1, p2 = pts[0], pts[1], pts[2]
            for k in range(1, 7):
                t = k / 6
                cur.append(((1 - t) ** 2 * p0.x() + 2 * (1 - t) * t * p1.x() + t * t * p2.x(), (1 - t) ** 2 * p0.y() + 2 * (1 - t) * t * p1.y() + t * t * p2.y()))
        elif verb == skia.Path.Verb.kCubic_Verb:
            p0, p1, p2, p3 = pts
            for k in range(1, 9):
                t = k / 8
                a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                cur.append((a * p0.x() + b * p1.x() + c * p2.x() + d * p3.x(), a * p0.y() + b * p1.y() + c * p2.y() + d * p3.y()))
        elif verb == skia.Path.Verb.kConic_Verb:
            p0, p1, p2 = pts[0], pts[1], pts[2]
            for k in range(1, 9):
                t = k / 8
                cur.append(((1 - t) ** 2 * p0.x() + 2 * (1 - t) * t * p1.x() + t * t * p2.x(), (1 - t) ** 2 * p0.y() + 2 * (1 - t) * t * p1.y() + t * t * p2.y()))
    if len(cur) > 2:
        contours.append(cur)
    return contours


def text_polys(text, font_name="Montserrat-Black", size=1.0):
    """Glyph outlines as shapely polygons (with holes), in units where the cap height is about `size`."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from . import draw as D
    f = D.font(font_name, 200)
    glyphs = f.textToGlyphs(text)
    xs = f.getXPos(glyphs)
    rings = []
    for gid, x in zip(glyphs, xs):
        gp = f.getPath(gid)
        if gp is None:
            continue
        for c in _skia_contours(gp):
            pg = Polygon([(px + x, -py) for px, py in c]).buffer(0)
            if pg.area > 1:
                rings.append(pg)
    rings.sort(key=lambda p: -p.area)
    solids = []
    for r in rings:
        depth = sum(1 for s in rings if s is not r and s.area > r.area and s.contains(r.representative_point()))
        solids.append((r, depth))
    shape = None
    for r, d in solids:
        shape = r if shape is None else (shape.union(r) if d % 2 == 0 else shape.difference(r))
    shape = unary_union(shape)
    b = shape.bounds
    k = size / 145.0
    from shapely import affinity
    shape = affinity.translate(shape, -(b[0] + b[2]) / 2, -(b[1] + b[3]) / 2)
    return affinity.scale(shape, k, k, origin=(0, 0))


def text_mesh(text, size=1.0, depth=0.35, font_name="Montserrat-Black"):
    shape = text_polys(text, font_name, size)
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    P, N = [], []
    for g in geoms:
        p, n = extrude(g, depth)
        P.append(p)
        N.append(n)
    return np.concatenate(P), np.concatenate(N)


def gear_poly(teeth, r_out, r_root, r_hole, tooth_frac=0.45):
    from shapely.geometry import Point, Polygon
    pts = []
    for k in range(teeth):
        a0 = 2 * math.pi * k / teeth
        w = 2 * math.pi / teeth
        for frac, r in ((0.0, r_root), (0.5 - tooth_frac / 2 - 0.06, r_root), (0.5 - tooth_frac / 2, r_out), (0.5 + tooth_frac / 2, r_out), (0.5 + tooth_frac / 2 + 0.06, r_root)):
            a = a0 + frac * w
            pts.append((r * math.cos(a), r * math.sin(a)))
    return Polygon(pts).difference(Point(0, 0).buffer(r_hole, 48))


@lru_cache(maxsize=None)
def M(key: str):
    """Mesh library, cached by key."""
    name, *args = key.split(":")
    a = [float(x) for x in args]
    if name == "cyl":
        return cylinder(*a[:2], seg=int(a[2]) if len(a) > 2 else 64)
    if name == "ring":
        return tube_ring(*a)
    if name == "torus":
        return torus(a[0], a[1], arc=a[2] if len(a) > 2 else 2 * np.pi)
    if name == "box":
        return box(*a)
    if name == "sphere":
        return sphere(a[0], int(a[1]) if len(a) > 1 else 3)
    if name == "gear":
        return extrude(gear_poly(int(a[0]), a[1], a[2], a[3]), a[4])
    if name == "dome":
        r, h = a
        prof = [(0, h)] + [(r * math.sin(t), h * math.cos(t)) for t in np.linspace(0.05, math.pi / 2, 14)] + [(r, 0), (r, 0), (0, 0)]
        return lathe(prof, 64)
    raise KeyError(key)


_TEXT: dict = {}


def TM(text: str, size=1.0, depth=0.35):
    key = (text, size, depth)
    if key not in _TEXT:
        _TEXT[key] = text_mesh(text, size, depth)
    return _TEXT[key]


_CUSTOM: dict = {}


def custom(key, fn):
    if key not in _CUSTOM:
        _CUSTOM[key] = fn()
    return _CUSTOM[key]


# ---------------------------------------------------------------- renderer
VERT = """
#version 330
uniform mat4 u_mvp; uniform mat4 u_model; uniform mat3 u_nrm;
in vec3 in_pos; in vec3 in_norm;
out vec3 v_pos; out vec3 v_n;
void main(){ vec4 w = u_model * vec4(in_pos, 1.0); v_pos = w.xyz; v_n = u_nrm * in_norm; gl_Position = u_mvp * vec4(in_pos, 1.0); }
"""
FRAG = """
#version 330
uniform vec3 u_color; uniform float u_metal; uniform float u_rough; uniform vec3 u_emit; uniform float u_alpha;
uniform vec3 u_cam; uniform float u_dim; uniform float u_fog;
in vec3 v_pos; in vec3 v_n; out vec4 f;
vec3 env(vec3 r){
  vec3 sky = mix(vec3(0.62,0.66,0.72), vec3(1.05,1.05,1.08), smoothstep(0.0, 0.85, r.y));
  vec3 gnd = vec3(0.10,0.11,0.13);
  vec3 c = mix(gnd, sky, smoothstep(-0.30, 0.12, r.y));
  float b1 = smoothstep(0.30,0.50,r.x) * (1.0 - smoothstep(0.62,0.80,r.x)) * smoothstep(-0.1,0.35,r.y);
  float b2 = smoothstep(-0.95,-0.80,r.x) * (1.0 - smoothstep(-0.62,-0.50,r.x)) * smoothstep(0.0,0.5,r.y);
  float b3 = smoothstep(0.55,0.95,r.y) * 0.6;
  return c + vec3(2.2) * b1 + vec3(1.2) * b2 + vec3(0.9) * b3;
}
void main(){
  vec3 n = normalize(v_n); vec3 v = normalize(u_cam - v_pos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 lin = pow(u_color, vec3(2.2));
  float lum = dot(lin, vec3(0.3, 0.59, 0.11));
  vec3 base = mix(lin, vec3(lum), u_dim * 0.85) * (1.0 - 0.35 * u_dim);
  float rough = clamp(u_rough, 0.04, 1.0);
  float shin = mix(6.0, 420.0, pow(1.0 - rough, 2.0));
  vec3 Ls[3] = vec3[3](normalize(vec3(-0.55, 0.85, 0.65)), normalize(vec3(0.85, 0.20, 0.55)), normalize(vec3(0.15, 0.55, -0.95)));
  vec3 Lc[3] = vec3[3](vec3(1.0, 0.97, 0.92) * 2.3, vec3(0.62, 0.70, 0.85) * 0.9, vec3(1.0) * 1.6);
  vec3 diff = vec3(0.0); vec3 spec = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float d = max(dot(n, Ls[i]), 0.0);
    vec3 h = normalize(Ls[i] + v);
    float s = pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 40.0;
    diff += Lc[i] * d * (i == 2 ? 0.25 : 1.0);
    spec += Lc[i] * s * d;
  }
  vec3 amb = mix(vec3(0.16, 0.17, 0.19), vec3(0.55, 0.58, 0.62), n.y * 0.5 + 0.5) * 0.55;
  vec3 F0 = mix(vec3(0.04), base, u_metal);
  float nv = max(dot(n, v), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0) * (1.0 - rough * 0.8);
  vec3 refl = env(reflect(-v, n));
  vec3 col = (1.0 - u_metal) * base * (amb + diff * 0.42)
           + spec * mix(vec3(1.0), base, u_metal) * (1.0 - rough * 0.6) * 0.55
           + refl * F * mix(0.55, 1.0, u_metal) * (1.0 - rough * 0.65)
           + u_metal * base * amb * 0.5;
  float rim = pow(1.0 - nv, 3.0);
  col += vec3(0.9, 0.95, 1.0) * rim * 0.18;
  col += pow(u_emit, vec3(2.2)) * 1.5;
  col = col * 1.25;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);   // ACES filmic
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  float a = u_alpha * (1.0 - u_fog);
  f = vec4(col * a, a);
}
"""


VERT_T = VERT.replace("in vec3 in_norm;", "in vec3 in_norm; in vec2 in_uv; out vec2 v_uv;").replace("v_n = u_nrm * in_norm;", "v_n = u_nrm * in_norm; v_uv = in_uv;")
FRAG_T = (FRAG.replace("in vec3 v_pos; in vec3 v_n;", "in vec3 v_pos; in vec3 v_n; in vec2 v_uv; uniform sampler2D u_tex;")
          .replace("vec3 lin = pow(u_color, vec3(2.2));", "vec4 tx = texture(u_tex, v_uv); if (tx.a < 0.5) discard; vec3 lin = pow(tx.rgb * u_color, vec3(2.2));"))


class Part:
    __slots__ = ("mesh", "model", "color", "metal", "rough", "emit", "alpha", "dim", "tex")

    def __init__(self, mesh, model, color="#cccccc", metal=0.0, rough=0.5, emit=0.0, alpha=1.0, dim=0.0, emit_color=None, tex=None):
        self.mesh, self.model, self.tex = mesh, model, tex
        self.color = _rgb(color)
        self.metal, self.rough, self.alpha, self.dim = metal, rough, alpha, dim
        ec = _rgb(emit_color) if emit_color else self.color
        self.emit = tuple(c * emit for c in ec)


def _rgb(h):
    if isinstance(h, (tuple, list)):
        return tuple(h)
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


class Renderer:
    _inst: dict = {}

    @classmethod
    def get(cls, w, h):
        key = (w, h)
        if key not in cls._inst:
            cls._inst[key] = Renderer(w, h)
        return cls._inst[key]

    _shared: dict = {}

    def __init__(self, w, h, samples=8):
        # One OpenGL context for every size: switching between several standalone contexts mixes up their
        # buffers (objects drawn with another mesh's geometry). Each size only gets its own framebuffers.
        sh = Renderer._shared
        if not sh:
            import moderngl
            try:
                ctx = moderngl.create_standalone_context(backend="egl") if os.name != "nt" else moderngl.create_standalone_context()
            except Exception:  # noqa: BLE001
                ctx = moderngl.create_standalone_context()
            sh["ctx"] = ctx
            sh["prog"] = ctx.program(vertex_shader=VERT, fragment_shader=FRAG)
            sh["prog_t"] = ctx.program(vertex_shader=VERT_T, fragment_shader=FRAG_T)
            sh["vaos"] = {}
            sh["texs"] = {}
        self.ctx = sh["ctx"]
        self.prog, self.prog_t, self.vaos, self.texs = sh["prog"], sh["prog_t"], sh["vaos"], sh["texs"]
        self.w, self.h = w, h
        samples = min(samples, self.ctx.max_samples)
        self.ms = self.ctx.framebuffer(color_attachments=[self.ctx.renderbuffer((w, h), 4, samples=samples)],
                                       depth_attachment=self.ctx.depth_renderbuffer((w, h), samples=samples))
        self.out = self.ctx.framebuffer(color_attachments=[self.ctx.renderbuffer((w, h), 4)])

    def _vao(self, mesh):
        key = id(mesh[0])
        if key not in self.vaos:
            if len(mesh) > 2:
                data = np.hstack([mesh[0], mesh[1], mesh[2]]).astype("f4")
                vbo = self.ctx.buffer(data.tobytes())
                self.vaos[key] = (self.ctx.vertex_array(self.prog_t, [(vbo, "3f 3f 2f", "in_pos", "in_norm", "in_uv")]), mesh)
            else:
                data = np.hstack([mesh[0], mesh[1]]).astype("f4")
                vbo = self.ctx.buffer(data.tobytes())
                self.vaos[key] = (self.ctx.vertex_array(self.prog, [(vbo, "3f 3f", "in_pos", "in_norm")]), mesh)
        return self.vaos[key][0]

    def _tex(self, path):
        if path not in self.texs:
            from PIL import Image
            im = Image.open(path).convert("RGBA")   # mesh V runs top-down like the image rows
            t = self.ctx.texture(im.size, 4, im.tobytes())
            t.build_mipmaps()
            t.filter = (self.ctx.LINEAR_MIPMAP_LINEAR, self.ctx.LINEAR)
            t.anisotropy = 8.0
            self.texs[path] = t
        return self.texs[path]

    def render(self, parts, view, proj, eye) -> np.ndarray:
        ctx = self.ctx
        self.ms.use()
        ctx.clear(0, 0, 0, 0)
        ctx.enable(ctx.DEPTH_TEST)
        ctx.disable(ctx.CULL_FACE)
        vp = proj @ view
        for pr in (self.prog, self.prog_t):
            pr["u_cam"].value = tuple(float(x) for x in eye)
            pr["u_fog"].value = 0.0
        opaque = [p for p in parts if p.alpha >= 0.999]
        clear = [p for p in parts if p.alpha < 0.999]
        for group, blend in ((opaque, False), (clear, True)):
            if blend:
                ctx.enable(ctx.BLEND)
                ctx.blend_func = (1, ctx.ONE_MINUS_SRC_ALPHA)  # premultiplied
                ctx.depth_mask = False
            for p in group:
                if p.alpha <= 0.002:
                    continue
                mvp = vp @ p.model
                nrm = np.linalg.inv(p.model[:3, :3]).T
                pr = self.prog_t if len(p.mesh) > 2 else self.prog
                if len(p.mesh) > 2 and p.tex:
                    self._tex(p.tex).use(0)
                    pr["u_tex"].value = 0
                pr["u_mvp"].write(mvp.T.astype("f4").tobytes())
                pr["u_model"].write(p.model.T.astype("f4").tobytes())
                pr["u_nrm"].write(nrm.T.astype("f4").tobytes())
                pr["u_color"].value = p.color
                pr["u_metal"].value = float(p.metal)
                pr["u_rough"].value = float(p.rough)
                pr["u_emit"].value = p.emit
                pr["u_alpha"].value = float(p.alpha)
                pr["u_dim"].value = float(p.dim)
                self._vao(p.mesh).render()
            if blend:
                ctx.disable(ctx.BLEND)
                ctx.depth_mask = True
        ctx.copy_framebuffer(self.out, self.ms)
        raw = self.out.read(components=4, alignment=1)
        img = np.frombuffer(raw, dtype=np.uint8).reshape(self.h, self.w, 4)[::-1]
        return img


def available() -> bool:
    try:
        import moderngl  # noqa: F401
        import shapely  # noqa: F401
        import trimesh  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- helpers for models
def ease_out_quint(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 5


def ease_in_cubic(x):
    x = min(1.0, max(0.0, x))
    return x ** 3


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def prog(t, a, d):
    return min(1.0, max(0.0, (t - a) / max(d, 1e-6)))


AX_X = RZ(-math.pi / 2)   # turns a Y-axis mesh to lie along X
AX_Z = RX(math.pi / 2)    # turns a Y-axis mesh to point along Z

BLUE = "#2F6FD6"
RED = "#E2453A"
STEEL = "#9AA5B4"
DARK = "#3A4350"
COPPER = "#D07A35"
GOLD = "#F2A21E"
TEAL = "#19A287"
WATER = "#3FA9F5"


def label(anchor, title, sub="", at=0.0, side=1):
    return {"p": anchor, "title": title, "sub": sub, "at": at, "side": side}


# ---------------------------------------------------------------- models: each returns (parts, labels) in local space
def model_pump_set(tl, prm):
    parts = []
    hl = prm.get("highlight", "")
    ex = smooth(prog(tl, prm.get("explode_at", 99), 0.8)) * 0.9
    dm = 0.7 if hl == "pump" else 0.0
    dp = 0.7 if hl == "motor" else 0.0
    # motor (along X)
    mx = -0.95
    parts.append(Part(M("cyl:1.0:2.8:72"), chain(T(mx, 0, 0), AX_X), BLUE, 0.55, 0.32, dim=dm))
    for k in range(12):
        x = mx - 1.25 + k * 2.5 / 11
        parts.append(Part(M("ring:1.085:0.98:0.07"), chain(T(x, 0, 0), AX_X), BLUE, 0.6, 0.3, dim=dm))
    parts.append(Part(M("dome:0.92:0.42"), chain(T(mx - 1.4, 0, 0), RZ(math.pi / 2)), "#44546A", 0.6, 0.35, dim=dm))
    parts.append(Part(M("ring:1.1:0.9:0.14"), chain(T(mx + 1.42, 0, 0), AX_X), "#2A5DB8", 0.6, 0.3, dim=dm))
    parts.append(Part(M("box:0.8:0.42:0.7"), T(mx, 1.18, 0), GOLD, 0.2, 0.35, dim=dm))
    parts.append(Part(M("box:0.86:0.08:0.76"), T(mx, 1.42, 0), "#C9801A", 0.2, 0.35, dim=dm))
    for fx in (-1.9, 0.0):
        parts.append(Part(M("box:0.55:0.55:1.5"), T(mx + fx * 0.6 + 0.2, -0.95, 0), "#24303D", 0.4, 0.5, dim=dm))
    parts.append(Part(M("box:5.9:0.16:1.9"), T(0.25, -1.3, 0), "#4A5563", 0.5, 0.45))
    # shaft
    parts.append(Part(M("cyl:0.12:0.9:32"), chain(T(0.85 + ex / 2, 0, 0), S(1, 1 + ex * 1.2, 1), AX_X), "#D9DEE5", 1.0, 0.18))
    # pump group
    px = 1.95 + ex
    parts.append(Part(M("cyl:1.12:0.9:72"), chain(T(px, 0, 0), AX_X), RED, 0.25, 0.22, dim=dp))
    parts.append(Part(M("ring:1.18:1.0:0.12"), chain(T(px - 0.47, 0, 0), AX_X), "#B8322A", 0.3, 0.25, dim=dp))
    parts.append(Part(M("cyl:0.98:0.1:72"), chain(T(px + 0.5, 0, 0), AX_X), "#C93A30", 0.3, 0.2, dim=dp))
    for k in range(8):
        a = k * math.pi / 4
        parts.append(Part(M("cyl:0.07:0.12:16"), chain(T(px + 0.57, 0.8 * math.sin(a), 0.8 * math.cos(a)), AX_X), "#E5E8EC", 1.0, 0.2, dim=dp))
    parts.append(Part(M("cyl:0.34:0.55:48"), chain(T(px + 0.8, 0, 0), AX_X), STEEL, 0.9, 0.25, dim=dp))
    parts.append(Part(M("cyl:0.5:0.1:48"), chain(T(px + 1.08, 0, 0), AX_X), STEEL, 0.9, 0.25, dim=dp))
    parts.append(Part(M("cyl:0.3:1.3:48"), T(px, 1.55, 0), STEEL, 0.9, 0.25, dim=dp))
    parts.append(Part(M("cyl:0.46:0.12:48"), T(px, 2.2, 0), STEEL, 0.9, 0.25, dim=dp))
    parts.append(Part(M("box:0.9:0.3:1.2"), T(px, -1.07, 0), "#24303D", 0.4, 0.5, dim=dp))
    lt = prm.get("label_times", {})
    labels = [label((mx, 1.45, 0.4), "Motor", prm.get("motor_sub", "the driver"), lt.get("motor", 99), -1),
              label((px, 0.75, 0.75), "Pump", prm.get("pump_sub", "the delivery system"), lt.get("pump", 99), 1)]
    return parts, labels


def _stator_mesh():
    from shapely.geometry import Point, Polygon
    from shapely import affinity
    ring = Point(0, 0).buffer(2.3, 96).difference(Point(0, 0).buffer(1.62, 96))
    teeth = []
    for k in range(12):
        tooth = Polygon([(-0.17, 1.2), (0.17, 1.2), (0.17, 1.7), (-0.17, 1.7)])
        shoe = Polygon([(-0.3, 1.18), (0.3, 1.18), (0.3, 1.27), (-0.3, 1.27)])
        teeth.append(affinity.rotate(tooth.union(shoe), k * 30, origin=(0, 0)))
    shape = ring
    for t_ in teeth:
        shape = shape.union(t_)
    return extrude(shape, 1.5)


def model_stator_rotor(tl, prm):
    parts = []
    en = smooth(prog(tl, prm.get("energize_at", 99), 0.8))
    spin = 0.0
    e0 = prm.get("energize_at", 99)
    if tl > e0:
        dt = tl - e0
        spin = 2.2 * (dt - 0.6 * (1 - math.exp(-dt / 0.6)))  # ramps up to 2.2 rad/s
    parts.append(Part(custom("stator", _stator_mesh), np.eye(4, dtype=np.float32), STEEL, 0.75, 0.33))
    for k in range(12):
        a = k * math.pi / 6
        for z in (0.82, -0.82):
            m = chain(RZ(a), T(0, 1.45, z), S(1, 1, 1))
            parts.append(Part(M("ring:0.29:0.17:0.42"), m, COPPER, 0.9, 0.28, emit=0.25 * en * (0.6 + 0.4 * math.sin(tl * 6 + k)), emit_color="#FF9A3C"))
    rot = RZ(-spin)
    parts.append(Part(M("cyl:1.02:1.6:72"), chain(rot, AX_Z), "#C3CAD3", 0.85, 0.22))
    for k in range(16):
        a = k * math.pi / 8
        parts.append(Part(M("box:0.1:0.06:1.62"), chain(rot, RZ(a), T(0, 1.0, 0)), "#8D97A4", 0.9, 0.3))
    parts.append(Part(M("cyl:0.2:3.4:40"), AX_Z, "#E6EAEE", 1.0, 0.15))
    fa = smooth(prog(tl, prm.get("label_times", {}).get("field", 99), 0.6)) * max(en, 0.0)
    if fa > 0:
        for k in range(4):
            a = -spin * 0.9 + k * math.pi / 2
            parts.append(Part(M("torus:0.42:0.045:3.1416"), chain(RZ(a), T(0, 1.32, 0.0), RY(math.pi / 2), RZ(0)),
                              "#5FE3FF", 0.0, 0.3, emit=1.4, alpha=0.85 * fa * (0.75 + 0.25 * math.sin(tl * 8 + k))))
    lt = prm.get("label_times", {})
    labels = [label((1.6, 1.7, 0.8), "Stator", "copper winding", lt.get("stator", 99), 1),
              label((-0.5, 0.6, 0.85), "Rotor", "steel", lt.get("rotor", 99), -1),
              label((1.1, -1.15, 0.8), "Magnetic field", "spins the rotor", lt.get("field", 99), 1)]
    return parts, labels


def _blade_mesh():
    from shapely.geometry import LineString
    pts = []
    for k in range(24):
        t = k / 23
        r = 0.42 + 1.22 * t
        a = -1.25 * t
        pts.append((r * math.cos(a), r * math.sin(a)))
    return extrude(LineString(pts).buffer(0.075, cap_style=1), 0.5)


def _volute_mesh():
    from shapely.geometry import LineString
    pts = []
    for k in range(90):
        a = 2 * math.pi * k / 89
        r = 1.95 + 0.42 * a / (2 * math.pi)
        pts.append((r * math.cos(a), r * math.sin(a)))
    end = pts[-1]
    pts.append((end[0], end[1] + 0.0))
    return extrude(LineString(pts).buffer(0.09), 0.95)


def _flow_path():
    pts = []
    for k in range(60):
        a = 2 * math.pi * k / 59
        r = 1.95 + 0.42 * a / (2 * math.pi) - 0.22
        pts.append((r * math.cos(a), r * math.sin(a), 0.0))
    return pts


def model_impeller(tl, prm):
    parts = []
    lt = prm.get("label_times", {})
    spin = tl * 3.2
    ro = prm.get("rotor_only", False)
    if not ro:
        parts.append(Part(M("cyl:2.35:0.16:96"), chain(T(0, 0, -0.55), AX_Z), "#5B6675", 0.7, 0.4))
        parts.append(Part(custom("volute", _volute_mesh), np.eye(4, dtype=np.float32), "#8C97A6", 0.8, 0.32))
        # outlet pipe: tangent at the end of the spiral, going up
        parts.append(Part(M("cyl:0.36:2.2:48"), T(2.37, 1.1, 0), STEEL, 0.85, 0.25))
        parts.append(Part(M("cyl:0.52:0.14:48"), T(2.37, 2.25, 0), STEEL, 0.85, 0.25))
    rot = RZ(spin)
    parts.append(Part(M("cyl:1.72:0.12:96"), chain(rot, T(0, 0, -0.3), AX_Z), GOLD, 0.85, 0.25))
    blade = custom("blade", _blade_mesh)
    for k in range(7):
        parts.append(Part(blade, chain(rot, RZ(k * 2 * math.pi / 7)), GOLD, 0.85, 0.22))
    parts.append(Part(M("cyl:0.36:0.7:48"), chain(T(0, 0, 0.05), AX_Z), "#E6EAEE", 1.0, 0.15))
    parts.append(Part(M("cyl:0.16:0.2:32"), chain(T(0, 0, 0.45), AX_Z), "#2A3442", 0.8, 0.3))
    # water droplets
    drop = M("sphere:0.085:2")
    wa = smooth(prog(tl, lt.get("water", 99), 0.5))
    if wa > 0:
        for i in range(26):
            s = ((tl * 0.55) + i / 26) % 1.0
            a = i * 2.4 - spin * 0.35 - 2.2 * s
            r = 0.45 + 1.5 * s
            parts.append(Part(drop, T(r * math.cos(a), r * math.sin(a), 0.1), WATER, 0.1, 0.08, emit=0.25, alpha=wa * min(1.0, 3 * (1 - s))))
    sa = 0.0 if ro else smooth(prog(tl, lt.get("suction", 99), 0.5))
    if sa > 0:
        for i in range(10):
            s = ((tl * 0.9) + i / 10) % 1.0
            parts.append(Part(drop, T(0.25 * math.cos(i * 2.1), 0.25 * math.sin(i * 2.1), 3.0 - 2.7 * s), WATER, 0.1, 0.08, emit=0.25, alpha=sa * min(1.0, 4 * s)))
    da = 0.0 if ro else smooth(prog(tl, lt.get("delivery", 99), 0.5))
    if da > 0:
        parts.append(Part(M("cyl:0.37:2.2:48"), T(2.37, 1.1, 0), "#BFE6FF", 0.0, 0.05, alpha=0.0))
        for i in range(10):
            s = ((tl * 0.8) + i / 10) % 1.0
            parts.append(Part(drop, T(2.37 + 0.12 * math.sin(i * 3.1), 2.35 + 1.1 * s, 0.12 * math.cos(i * 2.3)), WATER, 0.1, 0.08, emit=0.25, alpha=da * (1 - s)))
    labels = [label((1.05, 1.0, 0.35), "Impeller", "spins with the shaft", lt.get("impeller", 99), -1),
              label((1.85, -1.2, 0.4), "Centrifugal force", "throws water outwards", lt.get("centrifugal", 99), 1),
              label((0.0, 0.0, 2.2), "Suction", "water drawn in", lt.get("suction", 99), -1),
              label((2.37, 2.9, 0.0), "Delivery pipe", "water pushed out", lt.get("delivery", 99), 1)]
    return parts, labels


def _bolt_mesh():
    from shapely.geometry import Polygon
    pts = [(0.25, 1.35), (-0.75, -0.1), (-0.05, -0.1), (-0.35, -1.35), (0.8, 0.25), (0.08, 0.25), (0.45, 1.35)]
    return extrude(Polygon(pts), 0.42)


def model_energy(tl, prm):
    parts, labels = [], []
    mech = prm.get("mech_at", 1.2)
    pulse = 0.5 + 0.5 * math.sin(tl * 7)
    bolt_x = -2.2
    parts.append(Part(custom("bolt", _bolt_mesh), chain(T(bolt_x, 0.1, 0), RY(0.25 * math.sin(tl * 0.8))), "#FFC21A", 0.6, 0.25, emit=0.35 + 0.25 * pulse, emit_color="#FFB000"))
    parts.append(Part(M("torus:1.55:0.05"), chain(T(bolt_x, 0.1, 0), RX(math.pi / 2)), "#FFD25A", 0.2, 0.3, emit=0.9, alpha=0.65))
    g = smooth(prog(tl, mech - 0.35, 0.6))
    rot = max(0.0, tl - mech) * 1.6
    if g > 0:
        sc = 0.2 + 0.8 * g
        parts.append(Part(M("gear:14:1.35:1.12:0.38:0.5"), chain(T(2.0, 0.25, 0), S(sc), RZ(rot)), STEEL, 0.9, 0.22))
        parts.append(Part(M("cyl:0.38:0.62:40"), chain(T(2.0, 0.25, 0), S(sc), AX_Z), "#525D6B", 0.8, 0.3))
        parts.append(Part(M("gear:9:0.8:0.62:0.2:0.42"), chain(T(3.08, -0.95, 0.05), S(sc), RZ(-rot * 14 / 9 + 0.2)), TEAL, 0.7, 0.25))
    fa = smooth(prog(tl, mech - 0.6, 0.4))
    if fa > 0:
        for i in range(7):
            s = (tl * 0.9 + i / 7) % 1.0
            parts.append(Part(M("sphere:0.07:2"), T(lerp(bolt_x + 1.1, 0.5, s), 0.1 + 0.15 * math.sin(s * 6 + i), 0), "#FFD25A", 0.0, 0.3, emit=1.3, alpha=fa * math.sin(math.pi * s)))
    labels = [label((bolt_x, -1.45, 0.3), "Electrical", "energy in", prm.get("elec_at", 0.3), -1),
              label((2.2, -1.4, 0.3), "Mechanical", "energy out", mech, 1)]
    return parts, labels


def lerp(a, b, t):
    return a + (b - a) * t


PIPE = [(-2.4, -0.2, 0), (-2.4, 0.35, 0), (-0.2, 0.35, 0), (1.55, 0.35, 0), (1.55, 2.85, 0), (2.35, 2.85, 0), (2.35, 2.55, 0)]


def _pipe_path():
    return round_path(PIPE, 0.3)


def model_lift(tl, prm):
    parts = []
    t0 = prm.get("offset", 0.0)
    flow = smooth(prog(tl, 0.4, 0.6))
    parts.append(Part(M("box:6.6:0.22:2.0"), T(0, -0.6, 0), "#59636F", 0.4, 0.55))
    # sump (low)
    parts.append(Part(M("ring:0.85:0.75:1.2"), T(-2.4, -0.95, 0), "#9AA4B0", 0.6, 0.35))
    parts.append(Part(M("cyl:0.76:0.9:64"), T(-2.4, -1.12, 0), WATER, 0.1, 0.08, alpha=0.85))
    # pipe (glass so the water is visible) and water inside
    path = custom("pipe_path", _pipe_path)
    parts.append(Part(custom("pipe", lambda: sweep(path, 0.13, 20)), np.eye(4, dtype=np.float32), "#DCEFFF", 0.0, 0.05, alpha=0.38))
    if flow > 0:
        n = len(path)
        for i in range(22):
            s = (tl * 0.35 + i / 22) % 1.0
            idx = s * (n - 1)
            a, b = path[int(idx)], path[min(n - 1, int(idx) + 1)]
            p = a + (b - a) * (idx - int(idx))
            parts.append(Part(M("sphere:0.075:2"), T(*p), WATER, 0.1, 0.06, emit=0.3, alpha=flow))
    # small motor on the line
    mm = chain(T(-0.35, -0.12, 0), S(0.26))
    sub, _ = model_pump_set(99, {})
    for p in sub:
        parts.append(Part(p.mesh, mm @ p.model, "#888888", p.metal, p.rough))
        parts[-1].color = p.color
    # tank (high) on a stand
    for dx, dz in ((-0.55, -0.55), (0.55, -0.55), (-0.55, 0.55), (0.55, 0.55)):
        parts.append(Part(M("cyl:0.05:2.1:16"), T(2.35 + dx, 0.55, dz), "#C7CDD5", 0.9, 0.3))
    parts.append(Part(M("box:1.4:0.08:1.4"), T(2.35, 1.62, 0), "#C7CDD5", 0.8, 0.35))
    fill = smooth(prog(tl, 1.0, 3.0))
    lvl = 0.15 + 0.75 * fill
    parts.append(Part(M("cyl:0.74:1.0:64"), chain(T(2.35, 1.68 + lvl / 2, 0), S(1, lvl, 1)), WATER, 0.1, 0.06, emit=0.1))
    parts.append(Part(M("ring:0.8:0.76:1.1"), T(2.35, 2.22, 0), "#F1F4F7", 0.0, 0.1, alpha=0.4))
    parts.append(Part(M("ring:0.82:0.7:0.05"), T(2.35, 2.78, 0), "#F1F4F7", 0.2, 0.2))
    labels = [label((-2.4, -0.3, 0.9), "Sump", "low", 0.5, -1), label((2.35, 2.9, 0.8), "Tank", "high", 1.2, 1)]
    return parts, labels


def model_text(tl, prm):
    text = str(prm.get("text", ""))
    if "count_to" in prm:
        p = ease_out_quint(prog(tl, 0.1, prm.get("count_time", 0.8)))
        dec = int(prm.get("decimals", 0))
        text = f"{prm.get('prefix', '')}{prm['count_to'] * p:.{dec}f}{prm.get('suffix', '')}"
    size = prm.get("size3d", 1.9)
    mesh = TM(text, size, 0.55)
    parts = [Part(mesh, np.eye(4, dtype=np.float32), prm.get("color3d", TEAL), 0.65, 0.22)]
    labels = []
    if prm.get("sub"):
        labels.append({"p": (0, -size * 0.85, 0.3), "title": prm["sub"], "sub": "", "at": 0.25, "side": 0, "style": "caption"})
    return parts, labels


def _logo_parts():
    from shapely.geometry import Polygon
    from . import draw as D  # noqa: F401
    path = os.path.join(os.path.dirname(__file__), "assets", "brand", "logo_vector.json")
    vec = json.load(open(path, encoding="utf-8"))
    cols = vec["colors"]
    x0, y0, x1, y1 = vec["viewbox"]
    cx, cy = (24 + 196) / 2, (2 + 196) / 2
    s = 192 / 3.6
    def P3(p, z=0.0):
        return ((p[0] - cx) / s, -(p[1] - cy) / s, z)
    out = []
    for sh in vec["shapes"]:
        order = sh.get("order", 0)
        if sh["kind"] in ("line", "poly") and "stroke" in sh:
            pts = [sh["a"], sh["b"]] if sh["kind"] == "line" else sh["points"] + ([sh["points"][0]] if sh.get("closed") else [])
            r = sh.get("width", 1.5) * 1.6 / s
            col = cols.get(sh["stroke"], "#888888")
            for a, b in zip(pts, pts[1:]):
                A, B = np.array(P3(a)), np.array(P3(b))
                d = B - A
                L = float(np.linalg.norm(d))
                ang = math.atan2(d[1], d[0])
                m = chain(T(*((A + B) / 2)), RZ(ang - math.pi / 2), S(1, L, 1))
                out.append((order, M(f"cyl:{r:.4f}:1.0:20"), m, col, 0.5, 0.3))
                out.append((order, M(f"sphere:{r:.4f}:2"), T(*A), col, 0.5, 0.3))
        elif sh["kind"] == "poly":
            poly = Polygon([P3(p)[:2] for p in sh["points"]])
            out.append((order, custom(f"logo_poly_{order}", lambda poly=poly: extrude(poly, 0.18)), np.eye(4, dtype=np.float32), cols.get(sh["fill"], "#888"), 0.3, 0.3))
        elif sh["kind"] == "circle":
            out.append((order, M(f"sphere:{sh['r'] / s:.4f}:3"), T(*P3(sh["c"])), cols.get(sh["fill"], "#888"), 0.35, 0.25))
        elif sh["kind"] == "ring":
            out.append((order, M(f"torus:{sh['r'] / s:.4f}:{sh['width'] * 1.3 / s / 2:.4f}"), chain(T(*P3(sh["c"])), RX(math.pi / 2)), cols.get(sh["stroke"], "#888"), 0.5, 0.25))
    return out


def model_brand(tl, prm):
    parts = []
    lp = custom("logo_parts", _logo_parts)
    max_order = max(o for o, *_ in lp) or 1
    for i, (order, mesh, m, col, metal, rough) in enumerate(lp):
        # the logo assembles itself: every piece flies in from its own direction and locks into place
        p = ease_out_quint(prog(tl, 0.05 + 0.6 * order / max_order + 0.01 * (i % 5), 0.7))
        if p <= 0:
            continue
        pos = m[:3, 3]
        d = np.array([pos[0], pos[1]], dtype=np.float32)
        nd = float(np.linalg.norm(d))
        d = d / nd if nd > 1e-3 else np.array([math.cos(i * 2.3), math.sin(i * 2.3)], dtype=np.float32)
        off = T(d[0] * 4.0 * (1 - p), d[1] * 4.0 * (1 - p), 3.0 * (1 - p))
        spin = RZ((1 - p) * (1.5 if i % 2 else -1.5))
        parts.append(Part(mesh, chain(T(0, 0.75, 0), S(0.62), off, T(*pos), spin, T(*(-pos)), m), col, metal, rough, alpha=min(1.0, p * 3)))
    name = prm.get("name") or "BridgeThings"
    w = ease_out_quint(prog(tl, 0.45, 0.6))
    if w > 0:
        parts.append(Part(TM(name, 0.62, 0.3), chain(T(0, -0.95 - (1 - w) * 0.6, 0), RX((1 - w) * 1.2)), "#2D4053", 0.35, 0.3))
    labels = []
    if prm.get("role"):
        labels.append({"p": (0, -1.65, 0.2), "title": prm["role"], "sub": "", "at": 0.9, "side": 0, "style": "pill"})
    return parts, labels


_MACH: dict = {}


def _machine_mesh(meta):
    path = meta["mesh"]
    if path not in _MACH:
        d = np.load(path)
        _MACH[path] = (d["pos"], d["nrm"], d["uv"]) if "uv" in d and meta.get("texture") else (d["pos"], d["nrm"])
    return _MACH[path]


def model_machine(tl, prm):
    """The user's own machine (built from their photos by studio.machine)."""
    meta = prm.get("machine") or {}
    if meta.get("kit"):      # built by Claude from the photos with the building kit
        from . import kit
        parts, labels = kit.pose(kit.built(dict(meta["kit"], photos=meta.get("cutouts") or meta["kit"].get("photos") or [])), tl, prm.get("actions") or [])
        if prm.get("name"):
            labels.append(label((0.6, float(meta.get("height", 3.0)) * 0.42, 0.5), prm["name"], prm.get("sub", ""), prm.get("label_at", 0.9), 1))
        if prm.get("yaw"):
            for p in parts:
                p.model = RY(prm["yaw"]) @ p.model
        return parts, labels
    if not meta.get("mesh") or not os.path.exists(meta["mesh"]):
        return model_pump_set(tl, prm)
    mesh = _machine_mesh(meta)
    yaw = prm.get("yaw", 0.0)
    parts = [Part(mesh, RY(yaw), "#FFFFFF" if meta.get("texture") else "#8A96A6", 0.0 if meta.get("texture") else 0.7, 0.82 if meta.get("texture") else 0.45, tex=meta.get("texture"))]
    h = float(meta.get("height", 3.0))
    labels = []
    if prm.get("name"):
        labels.append(label((0.6, h * 0.42, 0.5), prm["name"], prm.get("sub", ""), prm.get("label_at", 0.9), 1))
    return parts, labels


def render_machine_still(prm, w, h):
    R = Renderer.get(w, h)
    meta = prm["machine"]
    hh = float(meta.get("height", 3.0))
    ww = float(meta.get("width", 5.0))
    dist = max(ww / (2 * math.tan(math.radians(15))), hh / (2 * math.tan(math.radians(15)))) * 1.15
    parts, _ = model_machine(0, prm)
    eye = (0.0, hh * 0.08, dist)
    return R.render(parts, look_at(eye, (0, 0, 0)), perspective(math.radians(30), w / h), eye)


MODELS = {"machine": model_machine, "pump_set": model_pump_set, "stator_rotor": model_stator_rotor, "impeller": model_impeller, "energy": model_energy,
          "lift": model_lift, "text": model_text, "brand": model_brand}
BASE_POSE = {"machine": (0.38, 0.1, 0.0), "pump_set": (0.55, 0.28, 0.0), "stator_rotor": (0.5, 0.32, 0.0), "impeller": (0.42, 0.36, 0.0), "energy": (0.2, 0.12, 0.0),
             "lift": (0.32, 0.2, -0.4), "text": (0.0, 0.08, 0.0), "brand": (0.0, 0.05, 0.0)}
SCALE = {"pump_set": 1.0, "stator_rotor": 1.05, "impeller": 1.0, "energy": 0.98, "lift": 0.95, "text": 1.0, "brand": 1.0}


def object_matrix(model, tl, dur, direction=1, enter="far"):
    """How an object arrives over the live shot.
    far:   travels in from far away (with a turn), settles, very slow product-shot turn, travels out.
    rise:  comes up from behind the speaker's shoulders, settles, sinks back behind him.
    still: already in place (the object animates itself, e.g. the logo assembling), fades at the end."""
    yaw0, pitch0, y0 = BASE_POSE.get(model, (0.3, 0.2, 0.0))
    if enter == "still":
        e_out = ease_in_cubic(prog(tl, dur - 0.45, 0.45))
        return chain(T(0, y0 + 0.4 * e_out, -6.0 * e_out), RX(pitch0), RY(yaw0 + 0.12 * math.sin(tl * 0.4)), S(SCALE.get(model, 1.0)))
    if enter == "rise":
        e_in = ease_out_quint(prog(tl, 0.0, 1.0))
        e_out = ease_in_cubic(prog(tl, dur - 0.55, 0.55))
        y = y0 - 7.5 * (1 - e_in) - 7.5 * e_out
        x = direction * 1.2 * (1 - e_in) + direction * 0.8 * e_out
        z = -3.0 * (1 - e_in) - 2.0 * e_out
        yaw = yaw0 - direction * 1.2 * (1 - e_in) + direction * 0.7 * e_out + 0.10 * math.sin(tl * 0.32)
        pitch = pitch0 - 0.25 * (1 - e_in)
        return chain(T(x, y, z), RX(pitch), RY(yaw), S(SCALE.get(model, 1.0)))
    e_in = ease_out_quint(prog(tl, 0.0, 0.95))
    e_out = ease_in_cubic(prog(tl, dur - 0.5, 0.5))
    z = -38.0 * (1 - e_in) - 26.0 * e_out
    x = direction * 7.5 * (1 - e_in) ** 1.4 - direction * 9.0 * e_out
    y = y0 + 2.2 * (1 - e_in) ** 1.6 + 0.6 * e_out
    yaw = yaw0 + direction * 1.9 * (1 - e_in) - direction * 1.1 * e_out + 0.10 * math.sin(tl * 0.32)
    pitch = pitch0 + 0.35 * (1 - e_in)
    return chain(T(x, y, z), RX(pitch), RY(yaw), S(SCALE.get(model, 1.0)))


def speed(model, tl, dur, direction=1, enter="far"):
    a = object_matrix(model, tl, dur, direction, enter)[:3, 3]
    b = object_matrix(model, tl + 1 / 30, dur, direction, enter)[:3, 3]
    return float(np.linalg.norm(a - b))


CAM_EYE = (0.0, 0.0, 13.5)


def render_object(model: str, prm: dict, tl: float, dur: float, w: int, h: int, direction: int = 1, fps: int = 30):
    """Returns (premultiplied RGBA image, projected labels, alpha) for local time tl."""
    fn = MODELS[model]
    R = Renderer.get(w, h)
    view = look_at(CAM_EYE, (0, 0, 0))
    proj = perspective(math.radians(30), w / h)
    enter = prm.get("enter", "still" if model == "brand" else "far")
    v = speed(model, tl, dur, direction, enter)
    n_sub = 1 if v < 0.05 else (3 if v < 0.25 else 5)
    if model == "brand" and tl < 1.4:
        n_sub = 3
    acc = None
    for k in range(n_sub):
        ts = tl + (k / max(1, n_sub - 1) - 0.5) * (0.55 / fps) if n_sub > 1 else tl
        om = object_matrix(model, ts, dur, direction, enter)
        parts, labels = fn(ts, prm)
        for p in parts:
            p.model = om @ p.model
        img = R.render(parts, view, proj, CAM_EYE)
        acc = img.astype(np.float32) if acc is None else acc + img
    img = (acc / n_sub).astype(np.uint8) if n_sub > 1 else acc.astype(np.uint8)
    om = object_matrix(model, tl, dur, direction, enter)
    _, labels = fn(tl, prm)
    vp = proj @ view
    out_labels = []
    for lb in labels:
        p = np.array(list(lb["p"]) + [1.0], dtype=np.float32)
        c = vp @ (om @ p)
        if c[3] <= 0:
            continue
        nd = c[:3] / c[3]
        out_labels.append(dict(lb, x=(nd[0] * 0.5 + 0.5) * w, y=(1 - (nd[1] * 0.5 + 0.5)) * h))
    settled = (1.0 if enter == "still" else ease_out_quint(prog(tl, 0.0, 0.95))) * (1 - ease_in_cubic(prog(tl, dur - 0.5, 0.5)))
    return img, out_labels, settled


# ================================================================ full-screen 3D stages (voice-over explainers)
# The camera moves through a dark studio around the machine; the story is told by what happens to the object
# (a bolt of electricity strikes the motor, the casing opens to show the stator, the pump cover comes off, the
# camera follows the water up from the sump to the tank).
def perspective_shift(fovy, aspect, shift_y=0.0, near=0.1, far=300.0):
    m = perspective(fovy, aspect, near, far)
    m[1, 2] = -shift_y
    return m


def ease_io(x):
    x = min(1.0, max(0.0, x))
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def cam_at(keys, t):
    """keys: [(time, eye, target, fov_deg)] -> eye, target, fov, interpolated with ease-in-out."""
    if t <= keys[0][0]:
        k = keys[0]
        return np.array(k[1], np.float32), np.array(k[2], np.float32), k[3]
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            u = ease_io((t - a[0]) / max(1e-6, b[0] - a[0]))
            lerp3 = lambda p, q: np.array(p, np.float32) * (1 - u) + np.array(q, np.float32) * u
            return lerp3(a[1], b[1]), lerp3(a[2], b[2]), a[3] + (b[3] - a[3]) * u
    k = keys[-1]
    return np.array(k[1], np.float32), np.array(k[2], np.float32), k[3]


def _xf(parts, m):
    for p in parts:
        p.model = m @ p.model
    return parts


def _xl(labels, m):
    out = []
    for lb in labels:
        p = m @ np.array(list(lb["p"]) + [1.0], np.float32)
        out.append(dict(lb, p=tuple(p[:3])))
    return out


MX = -0.95     # motor centre in the pump set
PX = 1.95      # pump centre


def _is_casing(i, p):
    return True


def stage_energy(tl, dur, prm):
    strike = prm.get("strike_at", 0.6)
    mech = prm.get("mech_at", 2.2)
    parts, _ = model_pump_set(99, {})
    flash = math.exp(-max(0.0, tl - strike) * 2.5) if tl > strike else 0.0
    for p in parts[:17]:   # motor body, fins, cap, flange, terminal box
        p.emit = tuple(min(1.0, e + flash * c) for e, c in zip(p.emit, (0.08, 0.22, 0.5)))
    # the bolt drops onto the terminal box
    bp = prog(tl, strike - 0.35, 0.35)
    if tl < strike + 0.7 and bp > 0:
        y = 6.0 - (6.0 - 1.95) * ease_in_cubic(bp)
        sc = 0.55 * (1 - smooth(prog(tl, strike + 0.25, 0.45)))
        if sc > 0.01:
            parts.append(Part(custom("bolt", _bolt_mesh), chain(T(MX, y + 1.3 * sc, 0), S(sc)), "#FFC21A", 0.4, 0.25, emit=0.9, emit_color="#FFB000"))
    # energy rings travel along the motor
    if strike < tl < mech + 0.8:
        for k in range(3):
            s = ((tl - strike) * 0.9 + k / 3) % 1.0
            parts.append(Part(M("torus:1.13:0.035"), chain(T(MX - 1.35 + 2.7 * s, 0, 0), RZ(math.pi / 2)), "#6FE4FF", 0.0, 0.3, emit=1.3, alpha=0.8 * math.sin(math.pi * s)))
    # mechanical: the coupling and shaft turn, a ring of motion around the shaft
    w = max(0.0, tl - mech)
    ang = 5.0 * (w - 0.5 * (1 - math.exp(-w / 0.5)))
    parts.append(Part(M("cyl:0.3:0.26:48"), chain(T(0.85, 0, 0), RX(ang), AX_X), "#E6EAEE", 1.0, 0.18))
    for k in range(4):
        parts.append(Part(M("box:0.27:0.12:0.12"), chain(T(0.85, 0, 0), RX(ang + k * math.pi / 2), T(0, 0.3, 0)), GOLD, 0.6, 0.3))
    ma = smooth(prog(tl, mech, 0.4))
    if ma > 0:
        parts.append(Part(M("torus:0.62:0.04:4.6"), chain(T(0.85, 0, 0), RX(ang * 0.6), RZ(math.pi / 2)), "#FFD25A", 0.0, 0.3, emit=1.2, alpha=0.9 * ma))
    labels = [label((MX, 1.5, 0.35), "Electrical energy", "flows into the motor", strike + 0.1, -1),
              label((0.85, 0.35, 0.3), "Mechanical energy", "the shaft turns", mech + 0.1, 1)]
    keys = [(0.0, (MX + 0.7, 2.5, 7.8), (MX, 1.15, 0), 30), (max(0.9, mech - 0.3), (7.0, 4.0, 17.5), (0.4, 0.2, 0), 30), (dur, (8.4, 3.3, 16.4), (0.4, 0.15, 0), 30)]
    return parts, labels, keys, -1.4


def stage_lift(tl, dur, prm):
    parts, labels = model_lift(tl + 0.8, {})
    for lb in labels:
        lb["at"] = {"Sump": 0.35, "Tank": dur * 0.55}[lb["title"]]
    keys = [(0.0, (-2.4, 0.7, 6.8), (-2.4, -0.6, 0), 30), (dur * 0.30, (-0.6, 1.3, 12.5), (-0.4, 0.4, 0), 30),
            (dur * 0.62, (3.0, 3.9, 8.4), (2.35, 2.3, 0), 30), (dur, (2.4, 3.2, 22.5), (0.2, 1.3, 0), 30)]
    return parts, labels, keys, -1.2


def stage_motor_inside(tl, dur, prm):
    """The motor casing opens up to show the stator and rotor working inside."""
    op = smooth(prog(tl, 0.5, 0.8))
    parts, _ = model_pump_set(99, {})
    casing, rest = parts[:17], parts[17:]
    for k, p in enumerate(casing):
        pos = p.model[:3, 3].copy()
        d = np.array([0.0, 1.0 if (pos[1] > 0.3 or k % 2) else -1.0, -0.4], np.float32)
        p.model = T(*(d * 0.9 * op)) @ p.model
        p.alpha = 1.0 - smooth(prog(tl, 0.55, 0.45))
    for p in rest:
        p.model = T(0, -0.0, -3.5 * op) @ p.model
        p.alpha = 1.0 - smooth(prog(tl, 0.6, 0.7))
    sub = dict(prm)
    sp, sl = model_stator_rotor(tl, sub)
    m = chain(T(MX, 0, 0), RY(math.pi / 2), S(0.40))
    parts = casing + rest + _xf(sp, m)
    labels = _xl(sl, m)
    keys = [(0.0, (5.5, 3.2, 18.5), (0.2, 0.1, 0), 30), (1.3, (MX + 3.8, 1.8, 8.0), (MX, 0.0, 0), 30),
            (2.6, (MX + 7.2, 1.2, 2.9), (MX, 0.0, 0), 30), (dur, (MX + 7.0, 2.0, 1.4), (MX, 0.0, 0), 30)]
    return parts, labels, keys, -0.2


def stage_pump_inside(tl, dur, prm):
    """The pump cover comes off and the impeller is spinning inside."""
    parts, _ = model_pump_set(99, {})
    op = smooth(prog(tl, 0.5, 0.9))
    cover_idx = list(range(len(parts)))[-12:]   # bolts, cover, suction stub, flange ... (last pieces of the pump)
    for i, p in enumerate(parts):
        pos = p.model[:3, 3]
        if pos[0] > PX + 0.45 and abs(pos[1]) < 1.2:   # front cover, bolts, suction stub
            p.model = chain(T(1.8 * op, 0.6 * op, 2.2 * op), T(*pos), RY(-1.2 * op), T(*(-pos))) @ p.model
            p.alpha = 1.0 - smooth(prog(tl, 0.9, 0.6))
    sub = dict(prm, rotor_only=True)
    ip, il = model_impeller(tl, sub)
    m = chain(T(PX + 0.5, 0, 0), RY(math.pi / 2), S(0.52))
    parts += _xf(ip, m)
    labels = _xl(il, m)
    keys = [(0.0, (5.5, 3.0, 18.0), (0.4, 0.1, 0), 30), (1.2, (PX + 5.8, 1.7, 6.5), (PX + 0.3, 0.1, 0), 30), (dur, (PX + 8.2, 1.0, 2.4), (PX + 0.4, 0.15, 0), 30)]
    return parts, labels, keys, -1.3


def stage_pump_flow(tl, dur, prm):
    parts, labels = model_impeller(tl + 3.0, prm)
    m = chain(RX(0.0))
    keys = [(0.0, (0.6, 0.6, 15.5), (0.6, 0.6, 0), 30), (dur, (8.2, 3.4, 12.5), (0.8, 0.7, 0), 30)]
    return parts, labels, keys, -2.6


def stage_head(tl, dur, prm):
    """Camera rises with the water from the motor to a tank 20 m up."""
    H_ = 8.0
    parts = []
    parts.append(Part(M("box:7.0:0.2:3.0"), T(0, -0.1, 0), "#59636F", 0.4, 0.55))
    sub, _ = model_pump_set(99, {})
    _xf(sub, chain(T(-1.4, 0.55, 0), S(0.4)))
    parts += sub
    path = [(-0.62, 1.4, 0), (-0.62, H_ + 0.2, 0), (0.9, H_ + 0.2, 0)]
    pipe = custom("head_pipe", lambda: sweep(round_path(path, 0.35), 0.13, 20))
    parts.append(Part(pipe, np.eye(4, dtype=np.float32), "#DCEFFF", 0.0, 0.05, alpha=0.38))
    pts = custom("head_path", lambda: round_path(path, 0.35))
    for i in range(30):
        s = (tl * 0.45 + i / 30) % 1.0
        idx = s * (len(pts) - 1)
        a, b = pts[int(idx)], pts[min(len(pts) - 1, int(idx) + 1)]
        parts.append(Part(M("sphere:0.075:2"), T(*(a + (b - a) * (idx - int(idx)))), WATER, 0.1, 0.06, emit=0.3))
    for dx, dz in ((-0.55, -0.55), (0.55, -0.55), (-0.55, 0.55), (0.55, 0.55)):
        parts.append(Part(M(f"cyl:0.06:{H_ - 0.9:.2f}:16"), T(1.55 + dx, (H_ - 0.9) / 2, dz), "#C7CDD5", 0.9, 0.3))
    parts.append(Part(M("cyl:0.82:1.2:64"), T(1.55, H_ - 0.3, 0), "#E8EDF2", 0.3, 0.25))
    p = ease_io(prog(tl, 0.2, max(0.6, dur - 0.9)))
    LX = -1.85
    parts.append(Part(M("box:0.06:1.0:0.06"), chain(T(LX, 0.3 + (H_ - 0.3) * p / 2, 0.6), S(1, max(0.01, (H_ - 0.3) * p), 1)), "#FFD25A", 0.0, 0.3, emit=1.2))
    parts.append(Part(M("box:0.4:0.05:0.05"), T(LX, 0.3, 0.6), "#FFD25A", 0.0, 0.3, emit=1.2))
    parts.append(Part(M("box:0.4:0.05:0.05"), T(LX, 0.3 + (H_ - 0.3) * p, 0.6), "#FFD25A", 0.0, 0.3, emit=1.2))
    val = int(round(20 * p))
    labels = [label((1.55, H_ + 0.4, 0.7), "Tank", "up to 20 m above", dur * 0.7, 1),
              {"p": (LX, 0.3 + (H_ - 0.3) * p, 0.6), "title": f"{val} m", "sub": "", "at": 0.0, "side": -1, "style": "counter"}]
    cy = lambda u_: 0.8 + (H_ - 1.6) * u_
    keys = [(0.0, (4.0, 1.9, 11.5), (-0.4, 1.3, 0), 32), (dur * 0.72, (4.0, H_ + 0.6, 12.5), (-0.4, H_ - 0.6, 0), 32), (dur, (7.0, 5.6, 27.0), (0.0, 4.4, 0), 32)]
    return parts, labels, keys, -0.15


def stage_machine(tl, dur, prm):
    """Full-screen turn-table of the user's machine with its name."""
    parts, labels = model_machine(tl, prm)
    meta = prm.get("machine") or {}
    hh = float(meta.get("height", 3.0))
    sweep = 0.55 * math.sin(min(1.0, tl / max(dur, 0.1)) * math.pi - math.pi / 2)
    for p in parts:
        p.model = RY(sweep) @ p.model
    labels = _xl(labels, RY(sweep))
    keys = [(0.0, (0.0, hh * 0.2, 14.0), (0, 0.1, 0), 30), (dur, (0.0, hh * 0.05, 10.5), (0, 0.0, 0), 30)]
    return parts, labels, keys, -hh / 2


STAGES = {"machine": stage_machine, "energy": stage_energy, "lift": stage_lift, "motor_inside": stage_motor_inside, "pump_inside": stage_pump_inside,
          "pump_flow": stage_pump_flow, "head": stage_head}


def render_stage(stage: str, prm: dict, tl: float, dur: float, w: int, h: int, fps: int = 30):
    """Full-frame render of a stage. Returns (image, labels with screen x/y, floor point on screen or None)."""
    fn = STAGES[stage]
    R = Renderer.get(w, h)
    def frame(ts):
        parts, labels, keys, floor_y = fn(ts, dur, prm)
        eye, tgt, fov = cam_at(keys, ts)
        view = look_at(tuple(eye), tuple(tgt))
        proj = perspective_shift(math.radians(fov), w / h, 0.16)
        return parts, labels, view, proj, eye, floor_y
    e1 = cam_at(fn(tl, dur, prm)[2], tl)[0]
    e2 = cam_at(fn(tl, dur, prm)[2], tl + 1 / fps)[0]
    n_sub = 1 if np.linalg.norm(e1 - e2) < 0.06 else 3
    acc = None
    for k in range(n_sub):
        ts = tl + (k / max(1, n_sub - 1) - 0.5) * (0.5 / fps) if n_sub > 1 else tl
        parts, labels, view, proj, eye, floor_y = frame(ts)
        img = R.render(parts, view, proj, eye)
        acc = img.astype(np.float32) if acc is None else acc + img
    img = (acc / n_sub).astype(np.uint8) if n_sub > 1 else acc.astype(np.uint8)
    parts, labels, view, proj, eye, floor_y = frame(tl)
    vp = proj @ view
    out = []
    for lb in labels:
        c = vp @ np.array(list(lb["p"]) + [1.0], np.float32)
        if c[3] <= 0:
            continue
        nd = c[:3] / c[3]
        out.append(dict(lb, x=(nd[0] * 0.5 + 0.5) * w, y=(1 - (nd[1] * 0.5 + 0.5)) * h))
    return img, out


from . import kit as _kit  # noqa: E402,F401  (registers the 'kit' model and stage)
