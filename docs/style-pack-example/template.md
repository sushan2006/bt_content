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
