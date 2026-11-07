"""Easing and timing helpers. All take a progress value 0..1 and return 0..1 (back/spring may overshoot)."""
from __future__ import annotations

import math


def clamp(x: float, a: float = 0.0, b: float = 1.0) -> float:
    return a if x < a else b if x > b else x


def progress(t: float, start: float, dur: float) -> float:
    if dur <= 0:
        return 1.0 if t >= start else 0.0
    return clamp((t - start) / dur)


def ease_out_cubic(p: float) -> float:
    p = clamp(p)
    return 1 - (1 - p) ** 3


def ease_in_cubic(p: float) -> float:
    p = clamp(p)
    return p ** 3


def ease_in_out(p: float) -> float:
    p = clamp(p)
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def ease_out_back(p: float, s: float = 1.70158) -> float:
    p = clamp(p)
    c3 = s + 1
    return 1 + c3 * (p - 1) ** 3 + s * (p - 1) ** 2


def spring(p: float, damping: float = 6.5, freq: float = 2.4) -> float:
    """Critically-damped-ish spring 0 -> 1 with a small overshoot."""
    p = clamp(p)
    if p >= 1:
        return 1.0
    return 1 - math.exp(-damping * p) * math.cos(freq * math.pi * p)


def lerp(a: float, b: float, p: float) -> float:
    return a + (b - a) * p


def envelope(t: float, start: float, end: float, t_in: float = 0.3, t_out: float = 0.25) -> tuple[float, float]:
    """Returns (in_progress, out_progress) for an element visible from start to end."""
    pin = progress(t, start, t_in)
    pout = progress(t, end - t_out, t_out)
    return pin, pout


def visible(t: float, start: float, end: float) -> bool:
    return start <= t < end
