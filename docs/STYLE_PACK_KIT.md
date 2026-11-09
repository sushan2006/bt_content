# Style Pack Kit: make a new Content Studio style from a video

**Kit version: 8 Nov 2026.** It matches the checks the dashboard runs when a style pack is added.

## For the person: how to use this file

1. Open a Claude chat that can **run code and create files** (Claude Code, or a Claude chat with code execution and file creation turned on). A chat that can only read text cannot analyse a video.
2. Attach **this file** and the **video** whose style you want. Download the video first: Claude needs the file itself, not a link. Use a clean video of 30 to 90 seconds; trim or compress a long one, because chat attachments have size limits.
3. Write something like:

   > Follow the Style Pack Kit. Make a style pack from the attached video. Style name: *Your Name Here*. What I like about it: *the fast captions, how the graphics pop in, the colours…*

4. Claude gives you **four files**: `style.json`, `template.md`, `thumbnail.png` and `README.md`. Put them together in one folder and unzip first if you were given a `.zip` (the dashboard does not read zip files).
5. In the dashboard: **Styles & music → Add a style pack → Choose the pack folder → Add this style**. The new style appears with its picture and can be chosen for any new video. Only an Admin can add styles.
6. To change the style, tell Claude what to change and add the new files again. A pack with the same name **replaces** the old one.

Only use videos whose style you have the right to follow. A pack copies the *look*, never the footage, music, voice or text of the video.

---

# Instructions for Claude (start here)

You are making a **style pack** for the Content Studio: a small folder that adds a new editing style to a company's video dashboard. Later, a Claude Code chat will receive a prompt built from your `template.md` and will make real videos in this style, so your template is the whole style specification. The dashboard people only add your four files; nobody changes any code.

## 1. What you deliver

A folder with exactly these files:

| File | Required | What it is |
| --- | --- | --- |
| `style.json` | yes | The card text and options (section 5.1) |
| `template.md` | yes | The full prompt template for Claude Code (section 5.2) |
| `thumbnail.png` | yes | The picture on the style card (section 5.3). `.jpg`, `.webp` or `.gif` also work, but the name must be `thumbnail` |
| `README.md` | no, but include it | Notes for people (section 5.4) |

## 2. What you need from the person

You need the **video file** and the **style name**. If either is missing, ask one short question and wait. Everything else, including what the person likes about the video, is optional: if it is missing, take the most reasonable reading of what defines the style and say which traits you took.

If you cannot run code or cannot open the video, say so in one sentence and stop. Do not invent a style from a description alone.

## 3. Rules that always hold

- **Copy the style, never the content.** No footage, music, voice, text, logo, character or specific scene of the video goes into any file. The thumbnail is drawn fresh; it is not a frame of the video.
- **Measure, do not guess.** Use the numbers you measured (cuts per minute, hold times, hex colours, loudness). Write "about" when a value is an estimate. Never state something about the video you did not see or measure.
- **No paid services.** The template must describe building everything with code (FFmpeg, Python, Node, headless Chromium). No AI video or image generator, no third-party editing app, no paid API.
- **Only the four file names above.** Do not change any dashboard or project code.
- **Plain language on the card.** `about`, `looks` and `best_for` are read by non-technical people.

## 4. Step 1: analyse the video

Work in a folder next to the video. The commands below were tested with FFmpeg 6 and Python 3. Check the tools first with `ffmpeg -version`. If FFmpeg is missing and cannot be installed, try `pip install imageio-ffmpeg` and use the path from `python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`; then say that `ffprobe` was not available and read the duration from FFmpeg's own output.

**1. Basics, frames and contact sheets.** Then open the sheets and frames as images and look at them.

```bash
VIDEO="input.mp4"                       # change to the real file name
mkdir -p work/frames work/early
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of default=nw=1 "$VIDEO"
ffmpeg -y -loglevel error -i "$VIDEO" -vf "fps=2,scale=240:-2" work/frames/f_%04d.jpg
ffmpeg -y -loglevel error -i "$VIDEO" -vf "fps=1,scale=240:-2,tile=6x5" work/sheet_%02d.jpg
ffmpeg -y -loglevel error -i "$VIDEO" -t 3 -vf "fps=6,scale=240:-2,tile=6x3" work/early/sheet_%02d.jpg
ls work/frames | wc -l
```

`work/frames/f_0001.jpg` is a frame every 0.5 s. `work/sheet_01.jpg`, `sheet_02.jpg`… show one frame per second, 30 to a sheet. `work/early/sheet_01.jpg` is the first 3 seconds in detail: look at how the video **opens**.

**2. Cut rhythm.** Scene detection finds hard cuts; it can miss soft transitions, morphs and wipes, so check against the frames and try thresholds from 0.15 to 0.4.

```bash
VIDEO="input.mp4"
ffmpeg -hide_banner -i "$VIDEO" -vf "select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*" | cut -d: -f2 > work/cuts.txt
wc -l < work/cuts.txt
```

```python
import statistics, subprocess
VIDEO = "input.mp4"
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", VIDEO]))
cuts = [float(x) for x in open("work/cuts.txt").read().split()]
edges = [0.0] + cuts + [dur]
shots = [b - a for a, b in zip(edges, edges[1:]) if b - a > 0.05]
print(len(cuts), "cuts;", round(len(cuts) / dur * 60, 1), "cuts per minute; shot length min/median/max:",
      round(min(shots), 2), round(statistics.median(shots), 2), round(max(shots), 2), "seconds")
```

**3. Colour.** Dominant colours as hex, with their share of the picture (needs Pillow: `pip install pillow` if it is missing). Also look at the frames for the background, the accent colours and any texture or grain.

```python
import glob
from PIL import Image
files = sorted(glob.glob("work/frames/f_*.jpg"))[::4]
tiles = [Image.open(f).convert("RGB").resize((64, 64)) for f in files]
sheet = Image.new("RGB", (64 * len(tiles), 64))
for i, t in enumerate(tiles):
    sheet.paste(t, (64 * i, 0))
q = sheet.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette()[:24]
total = 64 * 64 * len(tiles)
for n, idx in sorted(q.getcolors(), reverse=True):
    r, g, b = pal[idx * 3: idx * 3 + 3]
    print("#%02x%02x%02x" % (r, g, b), "%d%%" % round(100 * n / total))
```

**4. Sound.** Skip this step if the video has no audio stream.

```bash
VIDEO="input.mp4"
ffmpeg -hide_banner -i "$VIDEO" -af loudnorm=print_format=json -vn -f null - 2>&1 | sed -n '/^{/,/^}/p'
ffmpeg -hide_banner -ss 0 -t 2 -i "$VIDEO" -vn -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

The first command gives the overall loudness (`input_i` in LUFS) and the true peak. The second measures one stretch: run it on a stretch with speech and on a stretch with music alone (change `-ss` and `-t`); the difference is roughly how far the music sits under the voice. Listen for sound effects and note where they fall (on text, on graphics, on cuts).

**5. Speech and story (optional).** If `faster-whisper` is installed, transcribe to see the structure (hook, build, key moment, call to action) and when each arrives. If it is not installed and cannot be, skip this and say so.

```python
from faster_whisper import WhisperModel
VIDEO = "input.mp4"
model = WhisperModel("small", compute_type="int8")
segments, _ = model.transcribe(VIDEO, word_timestamps=True, vad_filter=True)
for s in segments:
    print("%6.2f-%6.2f  %s" % (s.start, s.end, s.text.strip()))
```

**6. What to write down.** Look for each of these and keep the numbers:

| Area | What to find |
| --- | --- |
| Opening | What is on screen in the first 3 seconds; how soon the first word is heard; the hook device |
| Structure | Hook, build, key moment, call to action, and the time each one arrives (as a share of the length too) |
| Cuts | Cuts per minute; shortest, median and longest shot; hard cuts or soft transitions |
| Picture | Full-screen graphics or b-roll versus the speaker or main footage, as a share of the time |
| Graphics | How they enter, hold and leave (slide, pop, morph, wipe, draw-on); hold times; easing; whether they sit beside or in front of a person; line weight, shapes, textures |
| Text | Caption or title position, size, font style, case, highlight colour, words per line, animation; lower thirds |
| Colour | Hex palette with roles (background, main, accent, highlight), contrast, saturation, grain, vignette |
| Camera | Punch-ins, pans, zooms, reframing, how much per beat |
| Sound | Loudness, music level under the voice, kind of music, sound effects and where they fall, silence |

Add what the person said they like. **What the person likes wins** over your own reading.

## 5. Step 2: write the four files

### 5.1 `style.json`

One JSON object. Text must be in double quotes, `true` and `false` have no quotes, and the file must be valid JSON (no comments, no trailing commas). Lengths are counted in characters after trimming spaces.

| Field | Required | Limit | What it is |
| --- | --- | --- | --- |
| `name` | yes | 40 | The style's name on the card. The style's id is made from it (`Blueprint Lines` becomes `pack_blueprint_lines`) |
| `tagline` | yes | 40 | Two or three words under the name |
| `technique` | yes | 80 | How the style is built, for example `Canvas 2D · line draw-on` |
| `about` | yes | 160 | One plain line on the card |
| `looks` | yes | 700 | What it looks like, in plain words |
| `best_for` | yes | 400 | What kinds of videos it suits |
| `example_topic` | yes | 160 | A sample topic that fits the style |
| `good_to_know` | no | 500 | A limit or tip. Shown in a red box and also sent to Claude |
| `storyboard_first` | no | true/false | `true` if scenes are detail-heavy and the person should approve still frames first. Default `false` |
| `footage_only` | no | true/false | `true` only if the style edits real camera footage and has no animation or graphics (like a clean-cut edit). Default `false` |
| `defaults` | no | object | Starting choices when the style is picked: `{"music": true, "sfx": true, "subtitles": false}`. Each is optional. Set `subtitles` to `true` if burned-in captions are the style's signature |
| `key` | no | | Leave it out. Without it the id comes from the name. Adding a pack with the same id replaces the old pack |

### 5.2 `template.md`

This is the style specification Claude Code will follow for every video in this style. It is plain Markdown (UTF-8), at least 300 characters and at most 150 KB. A good one is 4 to 40 KB.

**How it is used.** For each video the dashboard writes a prompt in three parts: (1) a **section 0** about this job, how to build it in the chat and what material and logo are available; (2) **your template**, with section 1 filled in; (3) a **hand-off** with the material links, brand, wording, suggestions, the files to deliver and their file names. Where section 0 or the hand-off differ from your template, they win. So your template does not repeat delivery instructions.

**Section 1 must look exactly like this** (the heading text may stay as shown; the three placeholders must be there, each **once**, spelled exactly, and nowhere else in the file):

```
# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: <one line naming this style>
{{AUDIO_SETTINGS}}
```

The dashboard replaces them with:

| Placeholder | Becomes |
| --- | --- |
| `{{TOPIC}}` | The video's topic, and the opening headline when there is one |
| `{{SETTINGS}}` | These lines: Storyboard (Enabled or Disabled); Voiceover (Enabled or Disabled, with how it is supplied); Voiceover transcript (optional); Subtitles (Enabled or Disabled); Duration without voiceover (seconds, or "as long as the footage needs"); Format (Vertical 9:16 or Horizontal 16:9); Native resolution; Target export frame rate (30 fps); Preview |
| `{{AUDIO_SETTINGS}}` | These lines: Sound effects (Enabled or Disabled); Background music (Enabled or Disabled); Final video format (MP4) |

**Start the file with `# TASK`:** one or two paragraphs on the look and what it is for, then the sections below. The order after section 1 may differ from the example in section 11, but cover all of this:

1. **How the configuration changes the work.** Storyboard enabled (show 6 to 10 still frames in this style as one contact sheet and wait for approval); voiceover or narration (the voice is the master clock; graphics appear as the idea is spoken); length and format (safe areas for 9:16: keep text out of the top 220 px, the bottom 420 px and 60 px at the sides); subtitles only when enabled; music and sound effects only when enabled; every fact on screen comes from the brief, the footage or the notes.
2. **The three kinds of material.** The dashboard may supply **camera footage** (a speaker's takes), a **voiceover** audio file, or **nothing**. Say what the style does in each case. For example: with footage the speaker stays the backbone and the style's graphics carry explanation beats; with a voiceover the graphics follow the voice; with nothing the animation carries the whole video, with on-screen text.
3. **Visual direction.** Hex colours with their roles, shapes, line weights, textures, type (font families that are free to use, such as OFL fonts), how brand colours and the logo are used.
4. **Motion.** Timings in seconds, easing, how things enter, hold and leave, transitions, camera movement. Use your measured numbers.
5. **Pacing and structure.** Cuts per minute, beat length, when the hook, the key moment and the call to action arrive.
6. **Text on screen**, if the style has captions or titles: position, size, case, highlight, words per line.
7. **Sound.** Voice loudest; music level under the voice; kinds of effects and where they fall; silence.
8. **Build method.** For an **animated style**: one self-contained HTML page with a deterministic `renderAt(seconds)` that draws the frame for time `seconds` as a pure function of time (seeded randomness only, local fonts, wait for `document.fonts.ready`), with simple playback controls (play, pause, restart, a time scrubber) so it can be previewed. The MP4 is rendered from it frame by frame at 30 fps in headless Chromium and encoded with FFmpeg. For a **footage-only style** (`footage_only` is `true`): cutting, trimming, reframing, stabilising, colour matching and sound cleanup with FFmpeg and Python only, and no graphics or captions unless subtitles are enabled.
9. **Checks before showing a draft.** Watch the whole draft; look at frames at every beat start and at 25, 50 and 75 percent; no overlap, nothing outside the safe zone, no frozen or empty frames; names spelled exactly; length within about 10 percent; first idea within 2 seconds; call to action before 85 percent of the length. Send the draft with 3 to 4 frames and a short list of what each beat does.
10. **What is not copied.** One sentence: the style is copied, never any reference footage, music or text.

**Never put these in the template:**

- Any sentence telling Claude not to use Claude Code, a terminal, a local server or a package install. Claude Code is the tool that makes the video, and the dashboard's prompt tells it to render the MP4 with the shell.
- A way of exporting that depends on the browser recording itself (`MediaRecorder`). The export is rendered frame by frame.
- Output file names, folders or "upload to…" instructions. The hand-off adds them.
- A statement that camera footage does not exist. The dashboard may supply it.
- Secrets, links, passwords or paths on any computer.
- Any other `{{ }}` placeholder.

### 5.3 `thumbnail.png`

- Name it `thumbnail.png` (or `.jpg`, `.jpeg`, `.webp`, `.gif`). It must be a real picture of that type and **under 2 MB**.
- **1280 × 720 pixels** (16:9): that is the shape of the card.
- An **original picture drawn in the new style** with code (Pillow, or an HTML canvas screenshotted with headless Chromium): one clear subject in the style's palette and line or texture language, with the **style name in large type**. Not a frame of the reference video.
- It must read well small. Resize a copy to 320 pixels wide and look at it; text should still be readable.
- Open the finished picture and look at it before delivering.

### 5.4 `README.md`

Notes for people, in plain language: what the style looks like; what it is best for; what you measured (cuts per minute, hold times, palette, loudness); what is **not** copied; limits or tips. Keep it to one screen. It is shown on the style's detail page.

## 6. Step 3: check the pack

Save the script in section 10 exactly as it is, as `check_style_pack.py`, and run it on your folder:

```bash
python3 check_style_pack.py path/to/your_pack_folder
```

It checks what the dashboard checks. Fix every `ERROR`. Read every `WARNING` and fix the ones that apply. Run it again until it prints `RESULT: OK`. Then read the template once more against the "Never put these in the template" list, because the script catches only some of them.

## 7. Step 4: deliver

- Put the four files in a folder named after the style id without `pack_` (for example `blueprint_lines`).
- Give the person the **four files themselves**. If the chat can only give one download, give a `.zip` and tell the person to unzip it before adding it.
- Finish with a short message in this shape:
  1. One or two lines on what the style is.
  2. The three or four measured facts that drive it (for example cuts per minute, hold time, palette, music level).
  3. Anything you could not measure or were unsure about.
  4. How to add it: *Dashboard → Styles & music → Add a style pack → Choose the pack folder → Add this style.* Mention that it appears with its picture and can be chosen in New video.
  5. How to change it: tell Claude what to change and add the new files again. A pack with the same name replaces the old one.

## 8. When the person asks for changes

Change what is asked and keep the rest. Re-run the check. Deliver all four files again, with the same `name` in `style.json` so the dashboard replaces the old pack.

## 9. The dashboard's limits at a glance

| Item | Limit |
| --- | --- |
| Each uploaded file | 2.5 MB (larger files are skipped) |
| `style.json` | 20 KB |
| `template.md` | 300 characters to 150 KB |
| `README.md` | 60 KB |
| `thumbnail.*` | Under 2 MB, a real png, jpg, webp or gif |
| Text fields | `name` 40, `tagline` 40, `technique` 80, `about` 160, `looks` 700, `best_for` 400, `example_topic` 160, `good_to_know` 500 characters |

## 10. The pack checker (`check_style_pack.py`)

Save this exactly as `check_style_pack.py`. It needs Python 3.8 or newer and nothing else.

<!-- BEGIN check_style_pack.py -->
````python
#!/usr/bin/env python3
"""Checks a Content Studio style pack folder the same way the dashboard does, before you add it.

Usage:   python check_style_pack.py <folder>
Needs:   Python 3.8 or newer. Nothing to install (Pillow is used only if present, to read the picture size).
Exit:    0 = the dashboard will accept the pack, 1 = fix the errors first.

The pack is these files in one folder: style.json, template.md, thumbnail.png (or .jpg/.jpeg/.webp/.gif) and, optionally, README.md.
This script mirrors apps/api/src/studio/packFormat.ts. If you change one, change the other.
"""
import json
import os
import re
import struct
import sys

LIMITS = {"json": 20000, "template": 150000, "readme": 60000, "thumbnail": 2 * 1024 * 1024, "each": int(2.5 * 1024 * 1024)}
PLACEHOLDERS = ["{{TOPIC}}", "{{SETTINGS}}", "{{AUDIO_SETTINGS}}"]
MIN_TEMPLATE_CHARS = 300
REQUIRED_TEXT = {"name": 40, "tagline": 40, "technique": 80, "about": 160, "looks": 700, "best_for": 400, "example_topic": 160}
OPTIONAL_TEXT = {"good_to_know": 500}
BOOL_FIELDS = ["storyboard_first", "footage_only"]


def length(s):
    """Length as the dashboard counts it (Unicode characters, so an emoji counts as one)."""
    return len(s)


def pack_key(s):
    slug = re.sub(r"^pack_", "", s.lower())
    slug = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")[:30].rstrip("_")
    return "pack_" + slug


def sniff_image(b):
    if len(b) > 8 and b[0] == 0x89 and b[1:4] == b"PNG":
        return "image/png"
    if len(b) > 3 and b[0] == 0xFF and b[1] == 0xD8 and b[2] == 0xFF:
        return "image/jpeg"
    if len(b) > 6 and b[:4] == b"GIF8":
        return "image/gif"
    if len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_size(path, b, kind):
    if kind == "image/png" and len(b) >= 24:
        return struct.unpack(">II", b[16:24])
    try:
        from PIL import Image  # optional
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def read_folder(folder):
    files = {}
    for root, _dirs, names in os.walk(folder):
        for n in names:
            files[n.lower()] = (n, os.path.join(root, n))
    return files


def check(folder):
    errors, warnings, info = [], [], []
    if not os.path.isdir(folder):
        return ["Folder not found: " + folder], [], [], None
    files = read_folder(folder)
    thumb_key = next((k for k in files if re.match(r"^thumbnail\.(png|jpe?g|webp|gif)$", k)), None)
    used = {"style.json", "template.md", "readme.md"} | ({thumb_key} if thumb_key else set())
    ignored = [files[k][0] for k in files if k not in used]
    if ignored:
        info.append("Ignored files (the dashboard does not use them): " + ", ".join(sorted(ignored)))

    def data(key):
        with open(files[key][1], "rb") as f:
            return f.read()

    for k in [k for k in used if k in files]:
        if os.path.getsize(files[k][1]) > LIMITS["each"]:
            errors.append("%s is larger than 2.5 MB; the dashboard skips files this large." % files[k][0])

    meta = None
    key = ""
    if "style.json" not in files:
        errors.append("style.json is missing (the style name, tagline, what it looks like, and so on).")
    else:
        raw = data("style.json")
        if len(raw) > LIMITS["json"]:
            errors.append("style.json is too large.")
        else:
            try:
                parsed = json.loads(raw.decode("utf-8-sig"))
                ok = True
            except Exception as e:  # invalid JSON or bad encoding
                errors.append("style.json is not valid JSON (%s)." % e)
                ok = False
            if ok:
                if not isinstance(parsed, dict):
                    errors.append('style.json: "file" is missing or not the right type (it must be one JSON object between { and }).')
                else:
                    for f, mx in REQUIRED_TEXT.items():
                        v = parsed.get(f)
                        if not isinstance(v, str):
                            errors.append('style.json: "%s" is missing or not the right type (text in quotes).' % f)
                        elif length(v.strip()) < 1:
                            errors.append('style.json: "%s" is empty.' % f)
                        elif length(v.strip()) > mx:
                            errors.append('style.json: "%s" is %d characters; the limit is %d.' % (f, length(v.strip()), mx))
                    for f, mx in OPTIONAL_TEXT.items():
                        if f in parsed:
                            v = parsed[f]
                            if not isinstance(v, str):
                                errors.append('style.json: "%s" is not the right type (text in quotes).' % f)
                            elif length(v.strip()) > mx:
                                errors.append('style.json: "%s" is %d characters; the limit is %d.' % (f, length(v.strip()), mx))
                    if "key" in parsed and not isinstance(parsed["key"], str):
                        errors.append('style.json: "key" is not the right type (text in quotes).')
                    for f in BOOL_FIELDS:
                        if f in parsed and not isinstance(parsed[f], bool):
                            errors.append('style.json: "%s" must be true or false (no quotes).' % f)
                    if "defaults" in parsed:
                        d = parsed["defaults"]
                        if not isinstance(d, dict):
                            errors.append('style.json: "defaults" must be an object like {"music": true, "sfx": true, "subtitles": false}.')
                        else:
                            for f in ("music", "sfx", "subtitles"):
                                if f in d and not isinstance(d[f], bool):
                                    errors.append('style.json: "defaults.%s" must be true or false (no quotes).' % f)
                    if not errors:
                        meta = parsed
    template = ""
    if "template.md" not in files:
        errors.append("template.md is missing (the full prompt template for this style).")
    else:
        raw = data("template.md")
        if len(raw) > LIMITS["template"]:
            errors.append("template.md is too large (limit 150 KB).")
        else:
            template = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").strip()
            if length(template) < MIN_TEMPLATE_CHARS:
                errors.append("template.md is too short to be a full style template.")
            missing = [p for p in PLACEHOLDERS if p not in template]
            if missing:
                errors.append("template.md must contain %s (the dashboard fills in these placeholders for each video)." % ", ".join(missing))
            for p in PLACEHOLDERS:
                if template.count(p) > 1:
                    warnings.append("%s appears %d times. The dashboard fills in only the first one, so use each placeholder once." % (p, template.count(p)))
            unknown = sorted(set(re.findall(r"\{\{[^}]*\}\}", template)) - set(PLACEHOLDERS))
            if unknown:
                warnings.append("Unknown placeholders will stay as they are in the prompt: " + ", ".join(unknown))
            if re.search(r"do not use claude code|don't use claude code", template, re.I):
                warnings.append('The template tells Claude not to use Claude Code. Claude Code is the tool that makes the video, so remove that sentence.')
            if re.search(r"MediaRecorder", template):
                warnings.append("The template relies on MediaRecorder for the export. The dashboard renders the MP4 frame by frame instead; remove or replace that part.")
    if not thumb_key:
        errors.append('thumbnail.png is missing (a picture of the style: png, jpg, webp or gif, named "thumbnail").')
    else:
        b = data(thumb_key)
        kind = sniff_image(b)
        name = files[thumb_key][0]
        if not kind:
            errors.append("%s is not a real png, jpg, webp or gif picture." % name)
        elif len(b) > LIMITS["thumbnail"]:
            errors.append("%s is larger than 2 MB." % name)
        else:
            size = image_size(files[thumb_key][1], b, kind)
            if size and abs(size[0] / size[1] - 16 / 9) > 0.02:
                warnings.append("%s is %dx%d. A 16:9 picture such as 1280x720 fits the style card best." % (name, size[0], size[1]))
            if size:
                info.append("Thumbnail: %s, %dx%d, %d KB" % (kind, size[0], size[1], len(b) // 1024))
    if "readme.md" in files:
        if os.path.getsize(files["readme.md"][1]) > LIMITS["readme"]:
            errors.append("README.md is too large.")
    else:
        info.append("README.md is optional and not included.")
    if meta is not None:
        k = (meta.get("key") or "").strip() if isinstance(meta.get("key"), str) else ""
        key = pack_key(k) if k else pack_key(meta["name"].strip())
        if not re.match(r"^pack_[a-z0-9_]{2,30}$", key):
            errors.append("The style needs a name with at least two letters or numbers.")
        else:
            info.append("Style: %s (id %s)" % (meta["name"].strip(), key))
    return errors, warnings, info, key


def main(argv):
    if len(argv) != 2:
        print("Usage: python check_style_pack.py <folder>")
        return 2
    errors, warnings, info, key = check(argv[1])
    print("Checking: " + argv[1])
    for m in info:
        print("  info:    " + m)
    for m in warnings:
        print("  WARNING: " + m)
    for m in errors:
        print("  ERROR:   " + m)
    if errors:
        print("RESULT: NOT READY. Fix the errors above, then run this check again.")
        return 1
    print("RESULT: OK. The dashboard will accept this pack (style id %s)." % key)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
````
<!-- END check_style_pack.py -->

## 11. A complete example pack ("Blueprint Lines")

Use it to see the **shape** of the files. Do not copy its look. The example's thumbnail is a 1280 × 720 PNG: the style name in large white type at the top left, and an original blueprint-style line drawing of a pump with cyan vanes, yellow flow arrows and numbered callouts on a blue grid.

**`style.json`**

<!-- BEGIN example/style.json -->
````json
{
  "name": "Blueprint Lines",
  "tagline": "technical drawing",
  "technique": "Canvas 2D · line draw-on",
  "about": "White technical line drawings that draw themselves on a blueprint grid.",
  "looks": "A deep blue blueprint sheet with a faint grid. Machines and ideas are drawn as clean white and cyan outlines that trace on stroke by stroke, with dimension lines, numbered callouts and small handwritten-style notes.",
  "best_for": "How a machine or process works, factory and product explainers, anything that should feel precise and engineered.",
  "good_to_know": "Line drawings stay readable only when they are large and uncluttered. Claude keeps one drawing per idea and holds each finished drawing for at least 2 seconds.",
  "example_topic": "How a centrifugal water pump moves water",
  "storyboard_first": false,
  "footage_only": false,
  "defaults": { "music": true, "sfx": true, "subtitles": false }
}
````
<!-- END example/style.json -->

**`template.md`**

<!-- BEGIN example/template.md -->
````markdown
# TASK

Create a polished, precise animated explainer in a **blueprint line-drawing** style, using the single project configuration below.

Everything on screen is drawn as clean outlines on a blueprint sheet: machines, flows, parts and diagrams trace on stroke by stroke, then get dimension lines, numbered callouts and short labels. The result should feel like an engineer sketching the idea live, not like icons sliding around a slide.

Build the animation as one self-contained HTML page with a deterministic `renderAt(seconds)` function and render the final video from it frame by frame. Create original drawings for the topic; do not copy any particular creator's work.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Blueprint line drawing / technical draw-on animation
{{AUDIO_SETTINGS}}

**This is the only configuration block and the single source of truth.** Every later instruction obeys it. Derive every drawing, label and explanation from the topic and from any attached narration or footage. Do not reuse a topic-specific story from anywhere else in this prompt.

---

# 2. HOW THE CONFIGURATION CHANGES THE WORK

- **Storyboard enabled:** first show 6 to 10 still frames in this style (one per main idea, with the time and the words under each) as one contact sheet, and wait for approval before animating.
- **Voiceover or narration:** the voice is the spine of the video. Every drawing appears as its idea is spoken: a label on the word it names, a part drawn as it is described.
- **Length and format:** follow the configured length (within about 10 percent) and aspect ratio. In 9:16 keep text out of the top 220 px, the bottom 420 px and 60 px at the sides.
- **Subtitles:** only when enabled. Use 1 to 2 short lines in the technical typeface, the spoken word highlighted.
- **Music and sound effects:** only when enabled (see section 7).
- **Facts:** every fact, number and name on screen must come from the topic, the narration, the footage or the notes. Never invent a measurement, a claim or a feature.

---

# 3. VISUAL DIRECTION

- **Sheet:** deep blueprint blue (#0b3d91 to #082a66, a soft radial gradient), a faint grid of 40 px squares at 8 percent white with a stronger line every fifth square, and a light paper-grain noise.
- **Lines:** white (#f4f8ff) for the main object, cyan (#6fe3ff) for what moves or matters, pale yellow (#ffe08a) for one highlight per scene. Stroke width 3 to 5 px, round caps and joins. No fills except a very light 10 percent white tint inside closed shapes.
- **Drawing quality:** build each object from simple, accurate geometry (circles, arcs, rectangles, polylines) so it reads as a real machine: correct proportions, the parts that matter shown, hidden parts as dashed lines.
- **Annotation:** thin dimension lines with end ticks, numbered callouts (a small circle with a number and a leader line), and short labels in a monospace or technical sans (JetBrains Mono or Inter), uppercase, letter-spaced. Keep labels to 1 to 4 words.
- **Branding:** use the brand colours only as the cyan accent or the highlight, and the logo in a title-block box in a corner of the sheet, like a drawing's title block.

---

# 4. MOTION

- **Draw-on:** outlines trace on with a stroke-dashoffset animation (0.6 to 1.5 s, ease-in-out), the pen tip shown as a small glowing dot. Draw the outline first, then the details.
- **Moving parts:** once drawn, parts that move do so in simple mechanical motion (rotation, sliding, flow arrows travelling along dashed paths). Time each motion to the word that describes it.
- **Transitions:** a finished drawing slides or scales into a corner as a small inset while the next drawing starts, or the sheet "re-draws" by erasing the old lines along their path. Never a hard cut to a blank sheet.
- **Camera:** slow pan and push-in (at most 8 percent scale change per beat) over the sheet.
- **Rhythm:** one idea per beat. Hold every finished drawing at least 2 seconds. Something moves in every frame; nothing just appears.

---

# 5. BUILD METHOD

1. Plan the beats first: a table of start/end word, what is drawn, which motion, which label.
2. Build the HTML page: Canvas 2D, a seeded random generator only (no `Math.random()` without a seed), all drawing a pure function of time `t`. Load local font files and wait for `document.fonts.ready` before the first frame.
3. Render frame by frame at the output size and 30 fps with headless Chromium, then encode with FFmpeg (H.264, yuv420p, AAC, `-movflags +faststart`). Do not rely on in-browser recording.
4. Mix the sound (section 7) and normalise the final mix to about −14 LUFS.

---

# 6. QUALITY CHECKS BEFORE SHOWING A DRAFT

- Watch the whole draft, then check frames at every beat start and at 25, 50 and 75 percent.
- No overlapping text, nothing outside the safe zone, no label covering a drawing's key part, no frozen or empty frames.
- Every label spelled exactly as in the configuration and notes; captions, if any, match the voice.
- Length within about 10 percent of the target; the first idea starts within the first 2 seconds; the call to action comes before 85 percent of the length.
- Send the draft with 3 to 4 frames and a short list of what each beat shows. Change what is asked, keep the rest.

---

# 7. SOUND

- The voice is always the loudest element.
- **Music (when enabled):** a calm, precise bed (soft pads and a light pulse), ducked about 18 dB under speech.
- **Sound effects (when enabled):** a soft pen-scratch on draw-on, a small tick on each callout, one slightly stronger accent on the key moment. Silence on small moves and serious lines.
````
<!-- END example/template.md -->

**`README.md`**

<!-- BEGIN example/README.md -->
````markdown
# Blueprint Lines (example style pack)

A technical-drawing look: a deep blue blueprint sheet with a faint grid, and machines drawn as clean white and cyan
line art that traces on stroke by stroke, with dimension lines, numbered callouts and short labels.

**Best for:** how a machine or process works, factory and product explainers, anything precise and engineered.
**Good to know:** keep one drawing per idea; each finished drawing stays on screen for at least 2 seconds.

This folder is an example of a style pack. To use it: Studio → Styles & music → **Add a style pack** → choose this folder.
To make a pack from a video you like, give the Style Pack Kit (`docs/STYLE_PACK_KIT.md`) and the video to Claude.
````
<!-- END example/README.md -->
