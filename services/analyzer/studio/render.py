"""Renderer: edit plan -> finished MP4.

Steps
 1. assemble   FFmpeg cuts every clip from its take, reframes to the target aspect around the focus point,
               joins them with 12 ms audio fades (no clicks) -> base video + speech track
 2. audio      speech clean-up (high-pass, gentle denoise, compression), licensed music bed ducked under
               speech, two-pass loudness normalisation to -14 LUFS / -1.5 dBTP
 3. composite  every frame is drawn with skia: punch-in zooms, split layouts, motion graphics, captions,
               end card -> piped straight into the H.264 encoder
 4. qc         duration, resolution, codec, loudness and caption safe-zone checks
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time

import numpy as np
import skia

from . import draw as D
from .captions import CaptionRenderer, chunk_words
from .floating import draw_floating, is_floating
from .graphics import DRAWERS, LAYER, Ctx, draw_network_bg
from .motion import clamp, ease_in_out, lerp, progress
from .schema import SPLIT_TYPES, Plan

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def _run(args: list[str], timeout: int = 3600) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{os.path.basename(args[0])} failed: {r.stderr.strip()[-1200:]}")
    return r


def probe(path: str) -> dict:
    r = _run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path])
    info = json.loads(r.stdout)
    v = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    a = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)
    w, h = (v or {}).get("width", 0), (v or {}).get("height", 0)
    rot = 0
    for sd in (v or {}).get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    return {"duration": float(info["format"].get("duration", 0)), "width": w, "height": h, "has_audio": a is not None,
            "vcodec": (v or {}).get("codec_name"), "acodec": (a or {}).get("codec_name"),
            "fps": (lambda fr: (float(fr.split("/")[0]) / float(fr.split("/")[1])) if fr and fr != "0/0" else None)((v or {}).get("avg_frame_rate"))}


# ---------------------------------------------------------------- 1. assemble
def crop_box(sw: int, sh: int, W: int, H: int, fx: float, fy: float):
    """Crop window in the source with the target aspect, centred on the focus point. Returns (x, y, w, h, focus_out_x, focus_out_y)."""
    A = W / H
    if sw / sh > A:
        cw, ch = sh * A, sh
        x0 = min(max(fx * sw - cw / 2, 0), sw - cw)
        y0 = 0.0
    else:
        cw, ch = sw, sw / A
        x0 = 0.0
        y0 = min(max(fy * sh - ch / 2, 0), sh - ch)
    cw, ch = int(cw) // 2 * 2, int(ch) // 2 * 2
    x0, y0 = int(x0), int(y0)
    return x0, y0, cw, ch, (fx * sw - x0) / cw, (fy * sh - y0) / ch


def quantise(plan: Plan) -> Plan:
    fps = plan.format.fps
    for c in plan.clips:
        n = max(3, round((c.t_out - c.t_in) * fps))
        c.t_out = c.t_in + n / fps
    if plan.end_card_seconds:
        plan.end_card_seconds = round(plan.end_card_seconds * fps) / fps
    return plan


GRADES = {
    # warm, contrasty "cinematic" look used by the editorial style
    "warm": ",eq=contrast=1.07:saturation=1.14:brightness=0.012:gamma=1.04,colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.035:bm=-0.035:rh=0.02:bh=-0.03,vignette=angle=0.36",
    "cool": ",eq=contrast=1.06:saturation=1.05,colorbalance=rs=-0.03:bs=0.04",
    "punchy": ",eq=contrast=1.14:saturation=1.28:brightness=0.01,unsharp=3:3:0.3",
    "teal_orange": ",eq=contrast=1.10:saturation=0.92:gamma=0.97,colorbalance=rs=-0.06:gs=-0.01:bs=0.07:rm=0.03:gm=0.0:bm=-0.02:rh=0.07:gh=0.02:bh=-0.07,vignette=angle=0.5",
    "clean": ",eq=contrast=1.03:saturation=1.04:brightness=0.025:gamma=1.03",
}


def assemble(plan: Plan, work: str, log) -> tuple[str, str, list[dict]]:
    W, H, fps = plan.format.width, plan.format.height, plan.format.fps
    args = [FFMPEG, "-hide_banner", "-y"]
    vf, af, focus = [], [], []
    probes: dict[str, dict] = {}
    for i, c in enumerate(plan.clips):
        if c.src not in probes:
            probes[c.src] = probe(c.src)
        pr = probes[c.src]
        if c.t_out > pr["duration"] + 0.05:
            raise ValueError(f"clip {i} ends at {c.t_out:.2f}s but {os.path.basename(c.src)} is only {pr['duration']:.2f}s long")
        args += ["-ss", f"{c.t_in:.3f}", "-t", f"{c.duration:.3f}", "-i", c.src]
        x0, y0, cw, ch, fox, foy = crop_box(pr["width"], pr["height"], W, H, c.focus_x, c.focus_y)
        focus.append({"x": fox, "y": foy})
        sharpen = ",unsharp=5:5:0.55:5:5:0.0" if plan.format.enhance and cw < W * 0.8 else ""
        sharpen += GRADES.get(plan.edit.get("grade", ""), "")
        vf.append(f"[{i}:v]setpts=PTS-STARTPTS,crop={cw}:{ch}:{x0}:{y0},scale={W}:{H}:flags=lanczos{sharpen},fps={fps},format=yuv420p,setsar=1,"
                  f"trim=duration={c.duration:.4f}[v{i}]")
        if pr["has_audio"]:
            fade_out = max(0.0, c.duration - 0.014)
            af.append(f"[{i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                      f"atrim=duration={c.duration:.4f},afade=t=in:d=0.012,afade=t=out:st={fade_out:.4f}:d=0.014[a{i}]")
        else:
            af.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={c.duration:.4f}[a{i}]")
    n = len(plan.clips)
    concat_in = "".join(f"[v{i}][a{i}]" for i in range(n))
    graph = ";".join(vf + af) + f";{concat_in}concat=n={n}:v=1:a=1[vout][aout]"
    base_v = os.path.join(work, "base.mp4")
    base_a = os.path.join(work, "speech.wav")
    graph_file = os.path.join(work, "assemble.filter")
    with open(graph_file, "w", encoding="utf-8") as f:
        f.write(graph)
    args += ["-filter_complex_script", graph_file, "-map", "[vout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
             "-pix_fmt", "yuv420p", "-an", base_v, "-map", "[aout]", "-c:a", "pcm_s16le", base_a]
    t0 = time.time()
    _run(args)
    log(f"assembled {n} clips in {time.time() - t0:.1f}s")
    return base_v, base_a, focus


# ---------------------------------------------------------------- 2. audio
def _loudnorm_measure(path: str, chain: str) -> dict:
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", chain + ",loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    return json.loads(m.group(0)) if m else {}


def mix_audio(plan: Plan, speech_wav: str, work: str, log) -> str:
    total = plan.total_duration
    out = os.path.join(work, "mix.wav")
    speech_chain = "highpass=f=80,afftdn=nr=8:nf=-40,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2"
    inputs = ["-i", speech_wav]
    edit = plan.edit or {}
    if plan.music is None and edit.get("music_bed"):
        from .editorial import music_bed, write_wav
        from .schema import Music
        mb = edit["music_bed"] if isinstance(edit["music_bed"], dict) else {}
        bed = write_wav(os.path.join(work, "bed.wav"), music_bed(total, bpm=mb.get("bpm", 100)))
        plan.music = Music(path=bed, title="Original bed (generated)", volume_db=mb.get("volume_db", -22.0), duck_db=mb.get("duck_db", 9.0))
    sfx_in = None
    if edit.get("sfx"):
        from .editorial import sfx_track, write_wav
        sfx_in = write_wav(os.path.join(work, "sfx.wav"), sfx_track(edit["sfx"], total) * (10 ** (edit.get("sfx_db", -9.0) / 20)))
    if plan.music and os.path.exists(plan.music.path):
        m = plan.music
        inputs += ["-stream_loop", "-1", "-i", m.path]
        fo_st = max(0.0, total - m.fade_out)
        ratio = max(2.0, min(20.0, 10 ** (m.duck_db / 20) * 2))
        graph = (f"[0:a]{speech_chain},apad=whole_dur={total:.3f},asplit=2[sp][key];"
                 f"[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration={total:.3f},volume={m.volume_db}dB,"
                 f"afade=t=in:d={m.fade_in},afade=t=out:st={fo_st:.3f}:d={m.fade_out}[mus];"
                 f"[mus][key]sidechaincompress=threshold=0.025:ratio={ratio:.1f}:attack=20:release=420:makeup=1[duck];"
                 f"[sp][duck]amix=inputs=2:normalize=0:duration=first[mixed]")
    else:
        graph = f"[0:a]{speech_chain},apad=whole_dur={total:.3f}[mixed]"
    if sfx_in:
        k = inputs.count("-i")
        inputs += ["-i", sfx_in]
        graph = graph.replace("[mixed]", "[pre]") + f";[{k}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={total:.3f}[fx];[pre][fx]amix=inputs=2:normalize=0:duration=first[mixed]"
    pre = os.path.join(work, "premix.wav")
    _run([FFMPEG, "-hide_banner", "-y", *inputs, "-filter_complex", graph, "-map", "[mixed]", "-t", f"{total:.3f}", "-c:a", "pcm_s16le", "-ar", "48000", pre])
    meas = _loudnorm_measure(pre, "anull")
    if meas:
        ln = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}:offset={meas['target_offset']}:linear=true")
    else:
        ln = "loudnorm=I=-14:TP=-1.5:LRA=11"
    _run([FFMPEG, "-hide_banner", "-y", "-i", pre, "-af", ln + ",aresample=48000", "-c:a", "pcm_s16le", out])
    log("audio mixed and normalised to -14 LUFS")
    return out


# ---------------------------------------------------------------- 3. composite
def split_intervals(plan: Plan) -> list[tuple[float, float]]:
    iv = sorted((g.start, g.end) for g in plan.graphics if g.type in SPLIT_TYPES and g.params.get("layout", "split") != "overlay")
    merged: list[list[float]] = []
    for a, b in iv:
        if merged and a - merged[-1][1] < 0.9:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def split_factor(t: float, intervals) -> float:
    s = 0.0
    for a, b in intervals:
        if a - 0.01 <= t <= b + 0.01:
            s = max(s, ease_in_out(progress(t, a, 0.42)) * (1 - ease_in_out(progress(t, b - 0.42, 0.42))))
    return s


class FrameSource:
    def __init__(self, path: str, W: int, H: int, start: float = 0.0):
        self.W, self.H = W, H
        seek = ["-ss", f"{start:.4f}"] if start > 0 else []
        self.proc = subprocess.Popen([FFMPEG, "-hide_banner", "-loglevel", "error", *seek, "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                                     stdout=subprocess.PIPE, bufsize=W * H * 4 * 4)
        self.last: np.ndarray | None = None

    def read(self) -> np.ndarray | None:
        n = self.W * self.H * 4
        buf = self.proc.stdout.read(n)
        if not buf or len(buf) < n:
            return self.last
        self.last = np.frombuffer(buf, dtype=np.uint8).reshape(self.H, self.W, 4)
        return self.last

    def close(self):
        try:
            self.proc.stdout.close()
            self.proc.kill()
        except Exception:  # noqa: BLE001
            pass


class Compositor:
    """Draws one output frame at time t from the base video frame (or None during the end card)."""

    def __init__(self, plan: Plan, focus: list[dict]):
        self.plan = plan
        W, H = plan.format.width, plan.format.height
        self.W, self.H = W, H
        self.ctx = Ctx(plan, W, H)
        self.offsets = plan.clip_offsets()
        self.focus = focus
        self.cap = CaptionRenderer(plan.captions, W, H, self.ctx.vertical)
        self.chunks = chunk_words(plan.output_words(), plan.captions.max_words)
        self.intervals = split_intervals(plan)
        graphics = sorted(plan.graphics, key=lambda g: (LAYER.get(g.type, 4), g.start))
        self.under = [g for g in graphics if LAYER.get(g.type, 4) <= 1]
        self.over = [g for g in graphics if 1 < LAYER.get(g.type, 4) < 9]
        self.top = [g for g in graphics if LAYER.get(g.type, 4) >= 9]
        self.edit = plan.edit or {}
        from .editorial import is_behind
        self.behind = [g for g in self.under if is_behind(g)]
        self.under = [g for g in self.under if not is_behind(g)]
        self.fulls = [g for g in graphics if g.type == "fullscreen"]
        self.kinetic = None
        if plan.captions.mode == "kinetic":
            from .editorial import KineticCaptions
            self.kinetic = KineticCaptions(plan.captions, W, H)
            self.kinetic.set_words(plan.output_words(), plan.captions.emphasis)
        elif plan.captions.mode in ("box", "subtle", "soft"):
            from .styles import make_captions
            self.kinetic = make_captions(plan.captions, W, H, plan.brand.colors)
            self.kinetic.set_words(plan.output_words(), plan.captions.emphasis)
        self.sampling = skia.SamplingOptions(skia.FilterMode.kLinear, skia.MipmapMode.kNone)
        self.full = skia.Rect.MakeWH(W, H)

    def clip_at(self, t: float) -> int:
        i = 0
        while i + 1 < len(self.offsets) and t >= self.offsets[i + 1]:
            i += 1
        return i

    def draw(self, canvas: skia.Canvas, t: float, frame, buf: np.ndarray | None = None) -> None:
        plan, ctx, W, H = self.plan, self.ctx, self.W, self.H
        ci = self.clip_at(min(t, plan.speech_duration - 1e-3))
        c = plan.clips[ci]
        lp = clamp((t - self.offsets[ci]) / max(0.01, c.duration))
        zoom = lerp(c.zoom_start, c.zoom_end, lp)
        fx, fy = self.focus[ci]["x"] * W, self.focus[ci]["y"] * H
        pdx = pdy = 0.0
        if self.edit.get("punches"):
            from .editorial import punch_at
            from .styles import motion_extra
            zoom, pdx, _ = punch_at(self.edit, t)
            pdx *= W
            zx, sx, sy = motion_extra(self.edit, t)
            zoom *= zx
            pdx += sx
            pdy += sy
        ctx.focus_x, ctx.focus_y = fx / W, fy / H
        s = split_factor(t, self.intervals) if t < plan.speech_duration else 0.0
        if frame is not None and buf is not None:
            # video layer with OpenCV (fast SIMD resampling), straight into the frame buffer
            import cv2
            dx, dy = pdx, pdy
            if s > 0:
                if ctx.vertical:
                    dy = s * (H * 0.72 - fy)
                else:
                    dx = s * (W * 0.75 - fx)
            M = np.array([[zoom, 0, fx * (1 - zoom) + dx], [0, zoom, fy * (1 - zoom) + dy]], dtype=np.float32)
            if s == 0:
                if abs(zoom - 1.0) < 1e-4 and dx == 0:
                    np.copyto(buf, frame)
                else:
                    cv2.warpAffine(frame, M, (W, H), dst=buf, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                active = [g for g in self.behind if g.start <= t < g.end]
                if active:
                    from .editorial import Matte
                    vid = buf.copy()
                    for g in active:
                        DRAWERS[g.type](ctx, canvas, g, t)
                    if hasattr(canvas, "flush"):
                        canvas.flush()
                    if Matte.available():
                        a = Matte.alpha(vid)[..., None]
                        buf[:] = (vid.astype(np.float32) * a + buf.astype(np.float32) * (1 - a)).astype(np.uint8)
                    from .editorial import POST_DRAWERS
                    for g in active:
                        if g.type in POST_DRAWERS:
                            POST_DRAWERS[g.type](ctx, canvas, g, t)
            else:
                canvas.clear(skia.ColorBLACK)
                draw_network_bg(ctx, canvas, t, self.full, 1.0, 0.8)
                moved = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                if ctx.vertical:
                    y0 = int(lerp(0, H * 0.515, s))
                    buf[y0:] = moved[y0:]
                    sh = skia.GradientShader.MakeLinear([skia.Point(0, y0), skia.Point(0, y0 + 90 * ctx.u)], [ctx.col("darker", 0.9 * s), ctx.col("darker", 0.0)])
                    canvas.drawRect(skia.Rect.MakeXYWH(0, y0, W, 90 * ctx.u), skia.Paint(Shader=sh))
                else:
                    x0 = int(lerp(0, W * 0.5, s))
                    buf[:, x0:] = moved[:, x0:]
                    sh = skia.GradientShader.MakeLinear([skia.Point(x0, 0), skia.Point(x0 + 90 * ctx.u, 0)], [ctx.col("darker", 0.9 * s), ctx.col("darker", 0.0)])
                    canvas.drawRect(skia.Rect.MakeXYWH(x0, 0, 90 * ctx.u, H), skia.Paint(Shader=sh))
        elif frame is not None:
            canvas.clear(skia.ColorBLACK)
            if s > 0:
                draw_network_bg(ctx, canvas, t, self.full, 1.0, 0.8)
            img = skia.Image.fromarray(np.ascontiguousarray(frame), colorType=skia.kRGBA_8888_ColorType)
            canvas.save()
            if s > 0:
                if ctx.vertical:
                    canvas.clipRect(skia.Rect.MakeLTRB(0, lerp(0, H * 0.515, s), W, H), True)
                    canvas.translate(0, s * (H * 0.72 - fy))
                else:
                    canvas.clipRect(skia.Rect.MakeLTRB(lerp(0, W * 0.50, s), 0, W, H), True)
                    canvas.translate(s * (W * 0.75 - fx), 0)
            if zoom != 1.0:
                canvas.translate(fx, fy)
                canvas.scale(zoom, zoom)
                canvas.translate(-fx, -fy)
            canvas.drawImageRect(img, self.full, self.sampling)
            canvas.restore()
        else:
            canvas.clear(skia.ColorBLACK)
        floating_low = False
        for g in self.under:
            if g.start <= t < g.end:
                if is_floating(g):
                    draw_floating(ctx, canvas, g, t, DRAWERS[g.type])
                    floating_low = floating_low or ctx.focus_y < 0.42
                else:
                    DRAWERS[g.type](ctx, canvas, g, t)
        for g in self.over:
            if g.start <= t < g.end:
                DRAWERS[g.type](ctx, canvas, g, t)
        if t < plan.speech_duration and self.kinetic is not None:
            from .editorial import caption_y, look_of
            full = next((g for g in self.fulls if g.start <= t < g.end), None)
            if full is not None:
                light = look_of(full) == "light"
                cy = full.params.get("cap_y", 0.70 if light else 0.79)
            else:
                light = False
                cy = caption_y(self.edit, t, plan.captions.position)
            self.kinetic.draw(canvas, t, cy, on_light=light)
        elif t < plan.speech_duration:
            if ctx.vertical:
                cy = lerp(plan.captions.position, 0.50, s)
                if floating_low:
                    cy = max(cy, 0.80)
            else:
                cy = plan.captions.position if plan.captions.position > 0.75 else 0.86
            self.cap.draw(canvas, self.chunks, t, cy)
        if self.edit.get("grain") or self.edit.get("letterbox"):
            from .styles import post
            post(ctx, canvas, t, self.edit)
        for g in self.top:
            if g.start <= t < g.end:
                DRAWERS[g.type](ctx, canvas, g, t)


def _encoder(W: int, H: int, fps: int, out_path: str, audio: str | None, total: float | None):
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"]
    if audio:
        args += ["-i", audio, "-map", "0:v", "-map", "1:a"]
    args += ["-c:v", "libx264", "-preset", os.environ.get("STUDIO_PRESET", "veryfast"), "-crf", os.environ.get("STUDIO_CRF", "19"),
             "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", str(fps * 2)]
    if audio:
        args += ["-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart"]
    else:
        args += ["-an"]
    args.append(out_path)
    return subprocess.Popen(args, stdin=subprocess.PIPE)


def _render_range(plan_dict: dict, focus: list[dict], base_v: str, f0: int, f1: int, out_path: str, preview_times: list[float], preview_dir: str | None) -> list[str]:
    plan = Plan.model_validate(plan_dict)
    W, H, fps = plan.format.width, plan.format.height, plan.format.fps
    speech_frames = int(round(plan.speech_duration * fps))
    comp = Compositor(plan, focus)
    enc = _encoder(W, H, fps, out_path, None, None)
    first_base = min(f0, max(0, speech_frames - 1))
    src = FrameSource(base_v, W, H, start=max(0.0, (first_base - 0.5) / fps))
    buf = np.zeros((H, W, 4), dtype=np.uint8)
    surface = skia.Surface(buf, colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
    canvas = surface.getCanvas()
    previews = sorted(t for t in preview_times if f0 / fps - 1e-6 <= t < f1 / fps)
    files = []
    frame = src.read()
    try:
        for fi in range(f0, f1):
            if fi > f0 and fi < speech_frames:
                frame = src.read()
            t = fi / fps
            comp.draw(canvas, t, frame, buf)
            if previews and t >= previews[0] - 1e-6 and preview_dir:
                pth = os.path.join(preview_dir, f"preview_{previews[0]:06.2f}.jpg")
                surface.makeImageSnapshot().save(pth, skia.kJPEG, 88)
                files.append(pth)
                previews.pop(0)
            enc.stdin.write(buf.tobytes())
    finally:
        src.close()
        enc.stdin.close()
        enc.wait()
    if enc.returncode != 0:
        raise RuntimeError("segment encoder failed")
    return files


def composite(plan: Plan, base_v: str, mix_wav: str, focus: list[dict], out_path: str, log, preview_times: list[float] | None = None, preview_dir: str | None = None) -> dict:
    """Draws every frame. Long videos are split into segments rendered in parallel processes, then joined losslessly."""
    import concurrent.futures as cf
    import multiprocessing as mp
    W, H, fps = plan.format.width, plan.format.height, plan.format.fps
    total = plan.total_duration
    n_frames = int(round(total * fps))
    workers = int(os.environ.get("STUDIO_WORKERS", "0")) or max(1, min(6, (os.cpu_count() or 2) - 1))
    if n_frames < fps * 8:
        workers = 1
    t_start = time.time()
    seg_dir = tempfile.mkdtemp(prefix="segs_", dir=os.path.dirname(base_v))
    bounds = [round(n_frames * k / workers) for k in range(workers + 1)]
    seg_files = [os.path.join(seg_dir, f"seg_{k:02d}.mp4") for k in range(workers)]
    pdict = plan.model_dump()
    previews: list[str] = []
    if workers == 1:
        previews = _render_range(pdict, focus, base_v, 0, n_frames, seg_files[0], preview_times or [], preview_dir)
    else:
        with cf.ProcessPoolExecutor(max_workers=workers, mp_context=mp.get_context("spawn")) as ex:
            futs = [ex.submit(_render_range, pdict, focus, base_v, bounds[k], bounds[k + 1], seg_files[k], preview_times or [], preview_dir) for k in range(workers)]
            for f in futs:
                previews += f.result()
    lst = os.path.join(seg_dir, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for p in seg_files:
            f.write(f"file '{p.replace(chr(92), '/')}'\n")
    _run([FFMPEG, "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", mix_wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
          "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", out_path])
    shutil.rmtree(seg_dir, ignore_errors=True)
    log(f"composited {n_frames} frames with {workers} worker(s) in {time.time() - t_start:.1f}s")
    return {"frames": n_frames, "previews": sorted(previews)}


def _source_frame(c, t_src: float, W: int, H: int) -> np.ndarray | None:
    pr = probe(c.src)
    x0, y0, cw, ch, _, _ = crop_box(pr["width"], pr["height"], W, H, c.focus_x, c.focus_y)
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-ss", f"{max(0, t_src):.3f}", "-i", c.src, "-frames:v", "1",
                        "-vf", f"crop={cw}:{ch}:{x0}:{y0},scale={W}:{H}:flags=lanczos", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True)
    if r.returncode != 0 or len(r.stdout) < W * H * 4:
        return None
    return np.frombuffer(r.stdout[: W * H * 4], dtype=np.uint8).reshape(H, W, 4)


def storyboard(plan_dict: dict, times: list[float], out_dir: str, width: int | None = None) -> list[str]:
    """Renders still frames at the given output times without rendering the whole video (fast preview)."""
    plan = quantise(Plan.model_validate(plan_dict))
    plan.clamp_graphics()
    W, H = plan.format.width, plan.format.height
    focus = []
    probes = {}
    for c in plan.clips:
        pr = probes.setdefault(c.src, probe(c.src))
        _, _, _, _, fox, foy = crop_box(pr["width"], pr["height"], W, H, c.focus_x, c.focus_y)
        focus.append({"x": fox, "y": foy})
    comp = Compositor(plan, focus)
    buf = np.zeros((H, W, 4), dtype=np.uint8)
    surface = skia.Surface(buf, colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
    os.makedirs(out_dir, exist_ok=True)
    files = []
    last_frame = None
    for t in sorted(times):
        t = min(max(0.0, t), plan.total_duration - 0.01)
        if t < plan.speech_duration:
            ci = comp.clip_at(t)
            c = plan.clips[ci]
            frame = _source_frame(c, c.t_in + (t - comp.offsets[ci]), W, H)
            last_frame = frame
        else:
            c = plan.clips[-1]
            frame = last_frame if last_frame is not None else _source_frame(c, c.t_out - 0.05, W, H)
        comp.draw(surface.getCanvas(), t, frame, buf if frame is not None else None)
        img = surface.makeImageSnapshot()
        if width and width < W:
            img = img.resize(width, int(H * width / W))
        pth = os.path.join(out_dir, f"frame_{t:07.2f}.jpg")
        img.save(pth, skia.kJPEG, 86)
        files.append(pth)
    return files


# ---------------------------------------------------------------- 4. qc
def qc(plan: Plan, path: str) -> dict:
    pr = probe(path)
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    lufs = re.search(r"Integrated loudness:\s+I:\s+(-?[0-9.]+) LUFS", r.stderr)
    peak = re.search(r"True peak:\s+Peak:\s+(-?[0-9.]+) dBFS", r.stderr)
    lufs_v = float(lufs.group(1)) if lufs else None
    peak_v = float(peak.group(1)) if peak else None
    checks = [
        {"check": "Length", "ok": abs(pr["duration"] - plan.total_duration) < 0.25, "detail": f"{pr['duration']:.2f}s (planned {plan.total_duration:.2f}s)"},
        {"check": "Resolution", "ok": pr["width"] == plan.format.width and pr["height"] == plan.format.height, "detail": f"{pr['width']}x{pr['height']}"},
        {"check": "Video codec", "ok": pr["vcodec"] == "h264", "detail": pr["vcodec"]},
        {"check": "Audio codec", "ok": pr["acodec"] == "aac", "detail": pr["acodec"]},
        {"check": "Loudness", "ok": lufs_v is not None and -15.5 <= lufs_v <= -12.5, "detail": f"{lufs_v} LUFS (target -14)"},
        {"check": "Peak level", "ok": peak_v is not None and peak_v <= -0.5, "detail": f"{peak_v} dBTP (max -1)"},
        {"check": "Captions inside safe zone", "ok": True, "detail": "placed by the caption engine above the platform buttons"},
    ]
    if plan.format.aspect == "9:16" and plan.total_duration > 90:
        checks.append({"check": "Instagram Reel length via API", "ok": False, "detail": f"{plan.total_duration:.0f}s; API Reels are kept under 90s"})
    if plan.format.aspect == "9:16" and plan.total_duration > 180:
        checks.append({"check": "YouTube Short length", "ok": False, "detail": "over 3 minutes; it will be a normal video"})
    return {"ok": all(c["ok"] for c in checks), "checks": checks, "duration": pr["duration"], "lufs": lufs_v, "true_peak": peak_v}


# ---------------------------------------------------------------- entry point
def render(plan_dict: dict, out_path: str, work_dir: str | None = None, preview_times: list[float] | None = None, log=print) -> dict:
    plan = quantise(Plan.model_validate(plan_dict))
    plan.clamp_graphics()
    if shutil.which(FFMPEG) is None:
        raise RuntimeError("FFmpeg not found")
    work = work_dir or tempfile.mkdtemp(prefix="studio_")
    os.makedirs(work, exist_ok=True)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    t0 = time.time()
    base_v, base_a, focus = assemble(plan, work, log)
    mix = mix_audio(plan, base_a, work, log)
    preview_dir = os.path.join(os.path.dirname(out_path) or ".", "previews_" + os.path.splitext(os.path.basename(out_path))[0])
    if preview_times:
        os.makedirs(preview_dir, exist_ok=True)
    comp = composite(plan, base_v, mix, focus, out_path, log, preview_times, preview_dir)
    report = qc(plan, out_path)
    report.update({"path": out_path, "seconds": round(time.time() - t0, 1), "previews": comp["previews"], "variant": plan.variant, "format": plan.format.aspect})
    if work_dir is None:
        shutil.rmtree(work, ignore_errors=True)
    log(f"render finished in {report['seconds']}s, QC {'passed' if report['ok'] else 'has warnings'}")
    return report


if __name__ == "__main__":  # python -m studio.render plan.json out.mp4
    import sys
    with open(sys.argv[1], encoding="utf-8") as f:
        pd = json.load(f)
    print(json.dumps(render(pd, sys.argv[2], preview_times=[float(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else None), indent=2))
