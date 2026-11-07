"""Caption chunking and drawing: bold white words, the spoken word in yellow, inside the platform safe zone."""
from __future__ import annotations

import re

import skia

from . import draw as D
from .motion import clamp, ease_out_back, ease_out_cubic

FILLERS = {"um", "uh", "erm", "er", "ah", "uhm", "hmm", "mm", "umm", "uhh"}
_PUNCT_END = re.compile(r"[.!?]$")
_PUNCT_SOFT = re.compile(r"[,;:]$")


def clean_word(w: str, uppercase: bool) -> str:
    w = w.strip()
    w = re.sub(r"^[\"'(\[]+|[\"')\]]+$", "", w)
    return w.upper() if uppercase else w


def chunk_words(words: list[dict], max_words: int = 4, max_gap: float = 0.45) -> list[dict]:
    """Groups words into short caption chunks. Each chunk is shown until the next one starts."""
    ws = [w for w in words if re.sub(r"[^\w]", "", w["text"].lower()) not in FILLERS and w["text"].strip()]
    chunks: list[dict] = []
    cur: list[dict] = []
    for i, w in enumerate(ws):
        if cur:
            gap = w["start"] - cur[-1]["end"]
            prev = cur[-1]["text"]
            if len(cur) >= max_words or gap > max_gap or _PUNCT_END.search(prev) or (_PUNCT_SOFT.search(prev) and len(cur) >= 2):
                chunks.append({"words": cur})
                cur = []
        cur.append(w)
    if cur:
        chunks.append({"words": cur})
    for i, c in enumerate(chunks):
        c["start"] = c["words"][0]["start"]
        nxt = chunks[i + 1]["words"][0]["start"] if i + 1 < len(chunks) else None
        end = c["words"][-1]["end"] + 0.5
        c["end"] = min(end, nxt) if nxt is not None else end
        # avoid flicker: short holes between chunks are bridged
        if nxt is not None and nxt - c["end"] < 0.25:
            c["end"] = nxt
    return chunks


class CaptionRenderer:
    def __init__(self, style, W: int, H: int, vertical: bool):
        self.s, self.W, self.H, self.vertical = style, W, H, vertical
        unit = W if vertical else H * 1.0
        self.size = style.size * unit if vertical else style.size * unit * 0.95
        self.font = D.font(style.font, self.size)
        self.max_w = W * (0.80 if vertical else 0.70)
        self._layout_cache: dict[int, list] = {}

    def _layout(self, idx: int, chunk: dict):
        if idx in self._layout_cache:
            return self._layout_cache[idx]
        f = self.font
        words = [clean_word(w["text"], self.s.uppercase) for w in chunk["words"]]
        space = D.text_width(" ", f)
        lines: list[list[int]] = [[]]
        width = 0.0
        for i, w in enumerate(words):
            ww = D.text_width(w, f)
            if lines[-1] and width + space + ww > self.max_w and len(lines) < self.s.max_lines:
                lines.append([])
                width = 0.0
            width += (space if lines[-1] else 0) + ww
            lines[-1].append(i)
        out = []
        for ln in lines:
            ws = [words[i] for i in ln]
            widths = [D.text_width(w, f) for w in ws]
            total = sum(widths) + space * (len(ws) - 1)
            out.append({"idx": ln, "words": ws, "widths": widths, "total": total})
        self._layout_cache[idx] = out
        return out

    def draw(self, canvas: skia.Canvas, chunks: list[dict], t: float, center_y_frac: float, alpha: float = 1.0) -> None:
        if not self.s.enabled:
            return
        idx = next((i for i, c in enumerate(chunks) if c["start"] <= t < c["end"]), None)
        if idx is None:
            return
        chunk = chunks[idx]
        lines = self._layout(idx, chunk)
        f = self.font
        space = D.text_width(" ", f)
        line_h = self.size * 1.12
        block_h = line_h * len(lines)
        cy = self.H * center_y_frac
        cx = self.W * (0.47 if self.vertical else 0.5)  # vertical: leave room for the right-hand buttons
        p = clamp((t - chunk["start"]) / 0.14)
        sc = 0.86 + 0.14 * ease_out_back(p)
        a = alpha * ease_out_cubic(clamp(p * 1.6))
        canvas.save()
        canvas.translate(cx, cy)
        canvas.scale(sc, sc)
        canvas.translate(-cx, -cy)
        y = cy - block_h / 2 + line_h * 0.80
        stroke_w = self.size * self.s.stroke_width
        # exactly one highlighted word: the latest one that has started (none during a pause)
        started = [k for k, w in enumerate(chunk["words"]) if w["start"] - 0.03 <= t]
        active_k = started[-1] if started else None
        if active_k is not None and t > chunk["words"][active_k]["end"] + 0.35:
            active_k = None
        for ln in lines:
            x = cx - ln["total"] / 2
            for k, w in zip(ln["idx"], ln["words"]):
                col = self.s.highlight if k == active_k else self.s.color
                D.draw_text(canvas, w, x, y, f, D.color(col, a), stroke_c=D.color(self.s.stroke, a * 0.95),
                            stroke_w=stroke_w, shadow=self.size * 0.10)
                x += D.text_width(w, f) + space
            y += line_h
        canvas.restore()
