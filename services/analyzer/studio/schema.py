"""Edit plan schema. A plan fully describes one rendered video; the renderer never improvises."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Variant = Literal["clean", "branded", "motion", "overlay", "editorial", "hype", "cinematic", "minimal", "profile"]

GRAPHIC_TYPES = (
    "hook_title", "logo_bug", "lower_third", "keyword_pop", "icon_callout", "stat_counter",
    "bullet_list", "process_flow", "image_card", "broll_full", "progress_bar", "intro_wipe",
    "cta_banner", "end_card", "illustration", "fullscreen", "text_behind", "pop3d", "model3d",
)
GraphicType = Literal[
    "hook_title", "logo_bug", "lower_third", "keyword_pop", "icon_callout", "stat_counter",
    "bullet_list", "process_flow", "image_card", "broll_full", "progress_bar", "intro_wipe",
    "cta_banner", "end_card", "illustration", "fullscreen", "text_behind", "pop3d", "model3d",
]
# Graphics that switch the frame into the split layout (panel + video card)
SPLIT_TYPES = {"bullet_list", "process_flow", "image_card", "illustration"}


class Word(BaseModel):
    start: float
    end: float
    text: str


class Clip(BaseModel):
    take_id: str
    src: str
    t_in: float
    t_out: float
    zoom_start: float = 1.0
    zoom_end: float = 1.0
    focus_x: float = 0.5
    focus_y: float = 0.42
    words: list[Word] = Field(default_factory=list)  # source-time words inside the clip, for captions
    line: Optional[int] = None
    reason: str = ""

    @model_validator(mode="after")
    def _check(self):
        if self.t_out - self.t_in < 0.08:
            raise ValueError(f"clip {self.take_id} {self.t_in}-{self.t_out} is too short")
        for z in (self.zoom_start, self.zoom_end):
            if not 1.0 <= z <= 1.6:
                raise ValueError("zoom must be between 1.0 and 1.6")
        self.focus_x = min(1.0, max(0.0, self.focus_x))
        self.focus_y = min(1.0, max(0.0, self.focus_y))
        return self

    @property
    def duration(self) -> float:
        return self.t_out - self.t_in


class Graphic(BaseModel):
    type: GraphicType
    start: float
    end: float
    params: dict[str, Any] = Field(default_factory=dict)
    reason: str = ""

    @model_validator(mode="after")
    def _check(self):
        if self.end <= self.start:
            raise ValueError(f"graphic {self.type} ends before it starts")
        return self


class CaptionStyle(BaseModel):
    enabled: bool = True
    font: str = "Montserrat-ExtraBold"
    size: float = 0.066          # fraction of frame width
    color: str = "#FFFFFF"
    highlight: str = "#FFD60A"   # word being spoken
    stroke: str = "#000000"
    stroke_width: float = 0.16   # fraction of font size
    uppercase: bool = True
    position: float = 0.70       # vertical centre of the caption block, fraction of height
    max_words: int = 4
    max_lines: int = 2
    mode: Literal["classic", "kinetic", "box", "subtle", "soft"] = "classic"   # kinetic: 1-3 words, each pops in, key words large
    emphasis: list[str] = Field(default_factory=list)  # words drawn large in kinetic mode


class Music(BaseModel):
    path: str
    license_path: Optional[str] = None
    title: str = ""
    volume_db: float = -17.0     # music level before ducking
    duck_db: float = 11.0        # how far it drops under speech
    fade_in: float = 0.6
    fade_out: float = 1.6


class Brand(BaseModel):
    company_name: str = ""
    handle: str = ""
    logo_path: Optional[str] = None
    logo_light_path: Optional[str] = None   # version for dark backgrounds
    logo_vector_path: Optional[str] = None  # optional vector redraw (JSON shapes) for crisp animated builds
    colors: dict[str, str] = Field(default_factory=lambda: {
        "primary": "#18A689", "accent": "#F39C1A", "alert": "#E8453C",
        "dark": "#1E2E40", "darker": "#111B27", "light": "#FFFFFF",
    })
    heading_font: str = "Montserrat-ExtraBold"
    body_font: str = "Inter-SemiBold"


class Format(BaseModel):
    aspect: Literal["9:16", "16:9"] = "9:16"
    enhance: bool = False         # sharpen low-resolution footage while upscaling
    width: int = 1080
    height: int = 1920
    fps: int = 30

    @model_validator(mode="after")
    def _dims(self):
        if self.aspect == "9:16" and self.width > self.height:
            self.width, self.height = self.height, self.width
        if self.aspect == "16:9" and self.height > self.width:
            self.width, self.height = self.height, self.width
        return self


class RuleUse(BaseModel):
    code: str
    applied: bool
    how: str = ""
    source: str = "engine"       # engine | suggestion | house


class Plan(BaseModel):
    version: int = 1
    variant: Variant = "clean"
    title: str = ""
    format: Format = Field(default_factory=Format)
    clips: list[Clip]
    graphics: list[Graphic] = Field(default_factory=list)
    captions: CaptionStyle = Field(default_factory=CaptionStyle)
    music: Optional[Music] = None
    brand: Brand = Field(default_factory=Brand)
    end_card_seconds: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    rules: list[RuleUse] = Field(default_factory=list)
    # editorial controls: punches [{t, zoom, dx, cap_y}], sfx [{t, kind, gain_db}], grade, music_bed
    edit: dict[str, Any] = Field(default_factory=dict)

    @field_validator("clips")
    @classmethod
    def _has_clips(cls, v):
        if not v:
            raise ValueError("a plan needs at least one clip")
        return v

    @property
    def speech_duration(self) -> float:
        return sum(c.duration for c in self.clips)

    @property
    def total_duration(self) -> float:
        return self.speech_duration + self.end_card_seconds

    def clip_offsets(self) -> list[float]:
        out, t = [], 0.0
        for c in self.clips:
            out.append(t)
            t += c.duration
        return out

    def output_words(self) -> list[dict]:
        """All words mapped to output time."""
        words = []
        for off, c in zip(self.clip_offsets(), self.clips):
            for w in c.words:
                a = max(w.start, c.t_in)
                b = min(w.end, c.t_out)
                if b <= a:
                    continue
                words.append({"start": off + a - c.t_in, "end": off + b - c.t_in, "text": w.text, "line": c.line})
        return words

    def clamp_graphics(self) -> "Plan":
        """Keeps every graphic inside the video and drops ones that become too short."""
        total = self.total_duration
        keep = []
        for g in self.graphics:
            g.start = max(0.0, g.start)
            g.end = min(total, g.end)
            if g.end - g.start >= 0.3 or g.type in ("intro_wipe",):
                keep.append(g)
        self.graphics = sorted(keep, key=lambda g: g.start)
        return self
