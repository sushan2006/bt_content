# Editing guide — how Claude Code builds a Content Studio video

Read this when a chat starts with a prompt copied from the Content Studio ("# 0. CONTENT STUDIO JOB JOB-…" for a preset style, "# Video edit — JOB-…" for a reference style). With a preset, the style template inside the prompt leads on look and workflow; this guide fills in the rest. The prompt says *what* to make; this guide says *how*, so every edit has the same quality whoever starts the chat.

No paid API is used. Everything is built here with code: FFmpeg, Python, Node and a headless browser.

## 1. Get set up (first 5 minutes)

1. **Read the whole prompt.** Note the job code, kind (footage / voiceover / animation), length, format, style, storyboard-first, music, sound effects and the delivery file names.
2. **Get the material.**
   - Attachments in the chat come first.
   - Otherwise use the Drive links in the prompt (the Google Drive connector can read and download them). If a file cannot be reached, ask for it. Never guess what is in it.
   - Reference style: watch the reference video (sample frames every 0.5 s and look at them) before planning.
   - Machines: open the photos and draw the machine faithfully: shape, colour, logo position, the parts that matter.
3. **Tools** (install what is missing):
   - `ffmpeg` / `ffprobe`
   - `pip install faster-whisper numpy pillow` (the "small" model with word timestamps is enough)
   - Node + `playwright` with Chromium, or the system Chrome (`channel="chrome"`)
4. **Work folder:** `/tmp/JOB-xxx/` with `src/` (material), `build/` (frames, audio) and `out/` (drafts `v1.mp4`, `v2.mp4`…). Keep every draft, so you can go back.

## 2. Plan

1. **Transcript.** Transcribe every take with word timestamps (`word_timestamps=True`, `vad_filter=True`). Give Whisper the brand words as `initial_prompt` (company, product names, glossary, machine names). Then apply the spelling fixes from the prompt.
2. **Best take per line** (footage). Line the takes up sentence by sentence and, for each line, pick the take with:
   - no stumble, restart or filler
   - the clearest audio and steady framing
   - eyes on the camera

   Cut false starts (a sentence abandoned and said again: keep the complete one), filler ("uh", "um", "you know") and pauses longer than about 0.35 s. Never cut inside a word, a number or a name, and never change what is meant.
3. **Beat sheet.** A table of beats: start/end word → what is on screen → motion → sound. Rules:
   - **One idea per beat.** A beat starts on the first word of its idea and ends on its last word.
   - **Back and forth (footage).** Leave the speaker when he explains *how* something works, come back for opinions, transitions, strong numbers and the closing line. Hold a full-screen graphic at least 2.5 s and the speaker at least 2 s between them.
   - **Every graphic means something.** It shows what the viewer cannot see on the speaker: a mechanism, a flow, a number that was said, the company's machine. Opinions and stories stay on the speaker.
   - **Budget.** For 60 s: 4–8 graphic moments, at most about half the time full-screen. Exactly **one wow moment** on the key idea: the most complete animation (cut-away, exploded view, the machine coming alive).
   - **Opening.** The first word is heard immediately. One hook device in the first 3 s: the headline from the brief, a bold statement, or the product in action.
   - **Ending.** The call to action comes before most viewers leave (by about 85 % of the length), then the end card with the logo.
4. **Storyboard first** (when the prompt asks for it). Render 6–10 still frames in the real style, at real resolution, with the time and the words under each. Show them as one contact sheet and **wait for the OK** before animating.

## 3. Build

### Motion graphics as code
Build the graphics in the technique the style names: Canvas 2D, SVG, Three.js or WebGL in an HTML page.

- **Deterministic.** The page exposes `window.renderAt(t)`, which draws the frame for time `t` (seconds). It uses no `requestAnimationFrame` clock and no `Math.random()` without a seed. Everything is a pure function of `t` and the beat sheet (word times as JSON).
- **Render frame by frame** with headless Chromium at the output size:

  ```
  for each frame n: await page.evaluate(t => renderAt(t), n / 30); await page.screenshot({ path, omitBackground: true })
  ```

  Use `omitBackground` for overlays that sit on top of the speaker. Or stream PNGs into `ffmpeg -f image2pipe -framerate 30 -i - …`.
- **Fonts:** load local font files (Montserrat, Inter, Anton, Press Start 2P… all OFL) with `@font-face`. Wait for `document.fonts.ready` before the first frame.
- **Motion quality:**
  - Ease everything (cubic or expo in and out, springs for things that land) and give it a small overshoot where the style allows.
  - Nothing just appears. No dead frames: something moves in every graphic from its first frame.
  - Time actions to words: a label on the word it names, a rotor spinning on "spins", a number counting up as it is said.

### Compositing (FFmpeg)
- **Speaker cut:** trim each chosen line from its take (`-ss/-to` on the exact word times, with 2–3 frames of handle) and join the lines with `concat`. Add a 1-frame audio crossfade to avoid clicks.
- **Reframe** to the output format (crop around the face for 9:16). Punch-ins of 5–12 % on emphasis words keep long speaker shots alive.
- **Graphics:** full-screen beats replace the picture while the voice continues. Overlays use the alpha PNG sequence with `overlay`. Put objects "behind the speaker" only when you have a person matte; otherwise keep them beside him.
- **Captions:** ASS subtitles burned in with libass. Use 1–2 short lines, the spoken word highlighted (`\k` karaoke timing or one ASS event per word), and a font that suits the style. In 9:16 keep text out of the top 220 px, the bottom 420 px and 60 px at the sides. Spell names exactly as in the prompt.
- **Export:** `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart -c:a aac -b:a 192k -ar 48000`

### Sound
- **The voice is always the loudest thing.** Normalise the final mix to −14 LUFS, true peak ≤ −1 dB (`loudnorm` in two passes).
- **Music:** a licensed track from the prompt, or an original bed generated in code (numpy: a soft chord pad plus a simple pulse, in a key and tempo that suit the style). Duck it about 18 dB under speech (`sidechaincompress`, or volume automation from the word times).
- **Sound effects** (only when asked), generated in code or CC0:
  - A soft whoosh or pop on the key motions; one stronger accent on the wow moment.
  - Silence on small moves and on serious lines.
  - Never on top of a key word.

## 4. Check before showing anything
1. Watch the draft at full length. Then extract frames at every beat start and at 25 / 50 / 75 % and look at them.
2. Lip sync, no cut inside a word, no clicks, no black or frozen frames.
3. Every name spelled right, captions matching the voice, nothing outside the safe zone, nothing covering the face.
4. Every fact on screen is in the footage, script or brief. No invented numbers, claims or features.
5. Length within about 10 % of the target; first word within 0.3 s; call to action before 85 %.
6. `ffprobe`: right resolution, 30 fps, H.264 + AAC. Loudness measured at −14 ±1 LUFS.

Then send the draft with 3–4 frames and a short list of what each beat does. Change what is asked, keep the rest, and send the next version.

## 5. Deliver (after "approved")
- `JOB-xxx <Title>.mp4`: exactly the name in the prompt. The dashboard finds the video by the job code at the start.
- `JOB-xxx thumbnail.jpg`: a JPEG under 2 MB, 1080 × 1920 for vertical videos (keep the subject and title in the centre square: Instagram crops the grid to it) or 1280 × 720 for horizontal. A designed frame in the video's style: the clearest picture of the subject and a 2–5 word title readable on a phone. No small text, no claims that are not in the video.
- `JOB-xxx captions.txt` in the format from the prompt (INSTAGRAM CAPTION / FACEBOOK DESCRIPTION / YOUTUBE TITLE / YOUTUBE DESCRIPTION / YOUTUBE TAGS). Captions are short and specific, with 3–6 relevant hashtags, and contain no claims that are not in the video.
- Put all three in Google Drive › `content_final` when the Drive connector can write there. Otherwise send them in the chat; the person puts them in content_final or uses *Upload final video* on the video page.

## 6. Notes per style
- **Paper Cut-Out:** draw each piece as a polygon with a jittered edge, a paper-noise texture (pre-render it once), and `shadowBlur` + offset. Animate on twos (hold each pose 2 frames) for the stop-motion feel.
- **Generative Particles:** Three.js `Points` with additive blending. Sample target positions from text drawn on an offscreen canvas or from SVG paths. Tween with a seeded curl noise. Keep word shapes fully formed about 1.5 s.
- **Liquid Glass:** render the scene to a texture, then draw lenses with a fragment shader: offset UVs by a bevel normal, add a rim light, a slight chromatic split and a soft shadow.
- **Kinetic Typography:** a text layout engine on Canvas. Every word gets the time of its spoken word. Reveals with clip masks. One highlighter colour.
- **Isometric Line Art:** orthographic camera, line geometry, draw-on with dash offset. One accent colour for what moves.
- **Flat Vector:** SVG shapes with path morphing (same number of points per shape), dashed flow lines with moving dash offset, numbered steps. The best fit for machine explainers.
- **Risograph Print:** two or three ink layers composited with `multiply`, halftone dot screens per layer, 2–4 px misregistration drifting slowly, grain on top.
- **8-Bit Pixel Art:** draw on a 270×480 (or 480×270) canvas and scale 4× with `imageSmoothingEnabled = false`. Move in whole pixels at 12–15 fps steps, use a 16-colour palette, and add blip sounds.
- **Simple Edit:** footage only. Cut, trim, reorder, stabilise, match colour and clean the sound with FFmpeg. No graphics, animated text, titles or captions (subtitles only when enabled). A short crossfade only where a cut jars.
- **Reference style:** match its measured cut rhythm, how graphics enter and leave, caption position and size, colour grade and sound levels. Copy the style only, never its footage, music or text.
