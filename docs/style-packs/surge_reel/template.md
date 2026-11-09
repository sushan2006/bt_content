# TASK

Create a cinematic, rhythm-driven video in a **surge-reel** style, using the single project configuration below.

The video has three clearly different speeds. It opens with a burst of flash cuts (about ten cuts a second) that grabs attention. It then drops into one slow, unbroken, glowing scene where elements arrive one at a time on the beat of the music. It finishes with a shorter, quicker montage and a clean, quiet end. The contrast between the fast start and the slow middle is the whole point of the style. Everything is dark, high-contrast and soft-glowing, with small uppercase labels in the corners like a film-lab HUD.

Build the video as one self-contained HTML page with a deterministic `renderAt(seconds)` function and render the final video from it frame by frame. Create original shapes, silhouettes and diagrams for the topic; do not copy any particular creator's work, footage, music or text.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Surge reel / flash-cut hook, slow glow build, quick finish
{{AUDIO_SETTINGS}}

**This is the only configuration block and the single source of truth.** Every later instruction obeys it. Derive every shape, word and label from the topic and from any attached narration or footage. Do not reuse a topic-specific story from anywhere else in this prompt.

---

# 2. HOW THE CONFIGURATION CHANGES THE WORK

- **Storyboard enabled:** first show 6 to 10 still frames in this style as one contact sheet: 2 or 3 from the flash hook (with the colour of each), 2 or 3 from the slow scene (first element, middle, full), 2 or 3 from the finish, each with its time and words under it. Wait for approval before animating.
- **Voiceover or narration:** the voice is the master clock. The hook may run up to 4 seconds so that it ends on a spoken phrase boundary, never in the middle of a word. The slow scene carries the main explanation, one idea per beat. The finish carries the closing line.
- **Length and format:** follow the configured length (within about 10 percent) and aspect ratio. In 9:16 keep text out of the top 220 px, the bottom 420 px and 60 px at the sides, and put the corner labels just inside those limits.
- **Subtitles:** only when enabled. Use 1 to 2 short lines in the HUD typeface, uppercase, centred in the lower safe area, the spoken word brighter than the rest.
- **Music and sound effects:** only when enabled (see section 7).
- **Facts:** every fact, number and name on screen must come from the topic, the narration, the footage or the notes. Never invent a measurement, a claim or a feature.

---

# 3. THE THREE KINDS OF MATERIAL

This style is made entirely of motion graphics drawn with code. It never relies on full-frame camera video.

- **Camera footage (a speaker's takes):** if the dashboard supplies footage, use it only as source material: its audio may carry the narration, and a few frames may be turned into a flat black silhouette or a single glowing cut-out. Never show full-frame camera video. The shapes and glow carry the picture.
- **A voiceover audio file:** the graphics follow the voice. The flash hook uses 6 to 12 very short shapes or one-word flashes on the opening words. The slow scene adds one glowing element for each idea as it is spoken.
- **Nothing:** the animation carries the whole video. Use shapes, silhouettes, technical line diagrams and large short on-screen words. Never leave a frame empty.

---

# 4. VISUAL DIRECTION

- **Palette:** near-black (#050403) is the main ground, with white (#ffffff) as the second ground for the flash frames. Warm amber (#ffb347 to #ff7a00) is the light: a single lamp, a glow, the soft haze around it. Hot yellow (#fff1a0) is the core of every glowing figure. Colour flips for the flash hook: red (#e01b1b), signal green (#19d44b), pale mint (#bfe3d6), orange (#ff6a00). One cool accent (cold blue #3b6dff) may appear once, on one small group, in the finish. Brand colours replace the amber or the green accent, never the black or white grounds.
- **Silhouettes and figures:** simple, readable shapes (a head and shoulders in profile, a standing figure, a small object) built from a few filled paths. For a glowing figure, draw the shape in hot yellow, then add two blurred copies behind it (about 6 px and 28 px radius, amber, additive blending) so the edge glows. Add a faint soft shadow of haze below the main light.
- **Diagram frames:** for the hook and the finish, a few frames may be white-on-black or black-on-white technical drawings with thin lines (1.5 to 2 px), tiny uppercase labels and dimension ticks, kept simple and exact. They are original drawings of the topic.
- **Texture:** a very light film grain (about 3 percent) and a slight vignette. Soft bokeh circles and cloud-like blur are allowed in the middle of the video.
- **Inversion pairs:** the same shape appears once as a bright glow on black and once as a soft black shape on white. Use this once or twice as a visual rhyme, never more.
- **HUD labels (always on screen):** top-left two short lines (the brand or channel name, and the month and year); top-right two short lines (a project name and a part number); bottom-centre one short caption line. Uppercase, a condensed technical sans (Barlow Semi Condensed, an open-licence font, loaded from a local file), about 2.2 percent of the frame height in size, letter spacing 0.04 em, white at 90 percent. The labels never move, never fade, and stay the same across every cut, so they hold the fast section together. Use the topic's own words for the labels; never copy another creator's name.
- **Branding:** the logo, if any, replaces the top-left label or sits small next to it, in white. Brand colours follow the palette rules above.

---

# 5. MOTION AND TRANSITIONS

The video is built from three phases. Times below are for a video of about 12 seconds; scale **phase lengths** by the configured length as shown, but **keep the cut rhythm in absolute time** (cut lengths stay in frames, not in percent).

**Phase A: the flash hook.**
- Length: the smaller of 3.2 seconds and 25 percent of the video (up to 4 seconds when a voiceover needs it, see section 2).
- About 10 cuts per second: each cut 1 to 6 frames at 30 fps (average 3 frames, about 0.1 s). Roughly 30 cuts in 3 seconds. A few shapes may repeat for 2 frames, so the eye catches them.
- Every cut is a hard cut with no cross-dissolve. Alternate between dark frames and bright frames so average brightness swings strongly from one cut to the next (very dark about 10 percent, very bright about 85 to 90 percent).
- Smoothness comes from continuity, not from fading: the same shape in a new colour (red disc, then green disc, then white), the same subject as a drawing and then as a photo-like silhouette, or the same position of the subject across several cuts, so cuts feel like one shape changing.
- Use only 4 to 6 different subjects in the hook, each seen 2 to 6 times, instead of 30 different pictures.
- Each cut falls on a sound hit (see section 7).

**Phase B: the slow glow.**
- Length: 35 to 45 percent of the video, and at least 4 seconds. About 4.1 s in a 12 s video.
- One continuous scene, no cuts. Fixed camera or a push-in of at most 4 percent over the whole phase.
- It starts nearly empty: the lamp or light source and its haze, with a short quiet beat of about 0.7 s.
- Then one glowing element appears every beat (about 0.64 s, about 94 beats per minute): it fades in over 6 to 8 frames and then drifts very slowly, in a gentle sine float of 4 to 8 px, with a slight rotation of 2 to 5 degrees. 5 or 6 elements in total. The first one is the largest and sits near the middle, under the light; later ones are smaller and sit around it, so the picture builds toward a balanced group.
- No element leaves before the end of the phase.

**Phase C: the quick finish.**
- Length: the rest of the video, minus a final hold.
- Cuts of 0.1 to 0.7 seconds (about 14 cuts in 4 seconds, with a few holds of 0.5 to 0.7 s so it is not frantic). The subjects return from phase B in new treatments: out-of-focus bokeh, soft cloud-like haze, a heat-map colour look (deep violet, magenta, orange, yellow), a pale off-white look with soft black shapes, a line-drawn sketch with labels.
- Hard cuts and quick 3-frame blur dissolves are both allowed here; one cut in four may be a short blur dissolve.
- A small corner marker or thin frame (a rectangle with tiny tick marks) may track the main shape in one or two shots.
- **Last shot:** a minimal line shape (a thin green arc or spiral, or a small geometric glyph) drawn on black over about 1 second, then a final black hold of about 0.5 seconds. Music goes quiet here (section 7).

**Overall rhythm.** Fast, then slow, then medium-fast, then quiet. Something is always changing in the fast phases; in the slow phase the change is only the arrival of the next element. The first cut is on frame 0 to 6: no black intro, no logo intro.

---

# 6. TEXT ON SCREEN

- The corner labels in section 4 stay on for the whole video.
- Optional **flash words**, in the hook only: one word of 1 to 3 syllables, huge (about 18 percent of the frame height), uppercase, white on black or black on white, for 2 to 4 frames each, at most 4 in the hook.
- In the slow scene a **single short line** (4 words at most) may appear at the lower third as an element arrives, in the HUD typeface at about 3 percent of the frame height, fading in over 6 frames and holding. At most 3 such lines.
- No other text. Labels never cover the main shape.

---

# 7. SOUND

- The voice, when there is one, is always the loudest element. Duck music about 14 to 18 dB under speech. Without voice, aim for the whole video at about −14 LUFS and a true peak below −3 dBFS.
- **Music (when enabled):** three zones that match the three phases. A: tight, percussive, bright, with short hits and glitch-like ticks; every cut lands on a hit; no sustained bass. B: a clear step up in level (about +6 to +10 dB against A) as the slow scene begins, with a warm, low bed and a steady pulse of about 94 beats per minute; each new element lands on a pulse. C: the pulse continues, with fewer, bigger hits on the cuts. The last second drops to a quiet tail (about −8 dB or more against C) under the final shape.
- **Sound effects (when enabled):** a very short click or tick on each flash cut in A, a soft airy swell as each element appears in B, one low accent where the slow scene begins, and a soft end tick on the last shape. Silence on small moves.
- Cuts and sound hits line up within 1 frame. When in doubt, put the sound 1 to 2 frames before the picture.

---

# 8. BUILD METHOD

1. Plan the beats first: a table with start time, end time, phase (A, B or C), the subject, the treatment (colour, inversion, blur), the sound hit and the label.
2. Build the HTML page: Canvas 2D, a seeded random generator only (no `Math.random()` without a seed), all drawing a pure function of the time `seconds`. Load local font files and wait for `document.fonts.ready` before the first frame. Include simple playback controls (play, pause, restart and a time scrubber) so the page can be previewed.
3. Cuts are placed from a cut list (start frames), so every cut is exact to the frame. Build the glow with canvas shadow blur or with blurred copies in additive blending, and cache the shapes so frames render quickly.
4. Render frame by frame at the output size and 30 fps with headless Chromium, then encode with FFmpeg (H.264, yuv420p, AAC, `-movflags +faststart`). Do not rely on in-browser recording.
5. Build the sound (section 7), place the hits from the same cut list, mix it and normalise the final mix to about −14 LUFS.

---

# 9. QUALITY CHECKS BEFORE SHOWING A DRAFT

- Watch the whole draft, then check frames at every phase start, at the first, middle and last cut of phase A, at each new element of phase B, and at 25, 50 and 75 percent.
- Count the cuts in phase A (about 10 per second) and confirm the slow scene really has none. Confirm the brightness swings between consecutive hook frames.
- No overlapping text, nothing outside the safe zone, no label covering the main shape, no frozen or empty frames, and the corner labels identical on every frame.
- Cuts and sound hits line up. The level steps up where phase B begins and drops at the end.
- Every label spelled exactly as in the configuration and notes; captions, if any, match the voice.
- Length within about 10 percent of the target; the hook starts on frame 0 to 6; the closing line or shape comes before 92 percent of the length.
- Send the draft with 3 to 4 frames and a short list of what each phase does. Change what is asked, keep the rest.

---

# 10. WHAT IS NOT COPIED

The style (its three speeds, glow, colours and rhythm) is copied from a reference; none of the reference's footage, shapes, music, names or text is ever reused.
