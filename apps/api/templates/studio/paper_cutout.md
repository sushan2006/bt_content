# TASK

Create a warm, exceptionally crafted **paper cut-out animated explainer**, using the single project configuration below.

Build a connected visual story in which layered construction paper, torn and cut shapes, paper banners, pinned tags and handmade infographic pieces slide, fold, flip and settle into clear explanations of the configured topic. The result should feel like a skilled stop-motion studio built an editorial infographic out of real paper, not like flat vector icons with a paper texture laid on top.

Create the animation as a playable **HTML Artifact** using JavaScript, and deliver a genuine downloadable video in the configured format.

Read the configuration before proceeding. If a storyboard is enabled, render genuine visual previews and stop for approval. If it is disabled, produce the finished animation directly. Keep the same quality standard in either mode.

Use original artwork, compositions and code. Do not copy another creator's paper animation, characters or sequence. Do not require Remotion, Hyperframes, Claude Motion, `/motion`, an AI video generator or desktop animation software.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Cinematic paper cut-out / handmade editorial infographic
{{AUDIO_SETTINGS}}

**This is the only configuration block and the single source of truth.** Every later instruction must use these values. Derive every subject-specific object, mechanism, label and fact from the topic and any supplied narration; do not assume a topic, script, runtime or approval step anywhere else.

---

# 2. CONFIGURATION-DRIVEN WORKFLOW

## Storyboard

- **Enabled:** Write a concise scene table and build an HTML Artifact with real JavaScript-rendered preview frames in the paper style (contact sheet plus an enlarged selected frame). Stop and ask for approval. Animate only after explicit approval, reusing the approved artwork.
- **Disabled:** Plan internally and deliver the complete animation directly, with no storyboard or approval stop.

## Voiceover and duration

- **Enabled:** The recording is the master clock. Read its decoded duration, align the main visual changes to the spoken phrases, and never stretch, clip or replace the narration. Use a transcript or SRT only as a timing aid, and label estimated timings honestly.
- **Disabled:** Use the configured fixed duration. Make the explanation fully understandable from the paper illustrations, moving diagrams and short labels. Do not invent narration.

## Subtitles, music and sound

- Create subtitles and an SRT only when subtitles are enabled. Without narration, use timed explanatory captions rather than invented speech.
- Generate music only when enabled, and sound effects only when enabled. Mix everything enabled into both the preview and the exported video.

## Real brands and products

When the topic involves a real company or product, use its authentic logo and accurate product details. You may place a genuine logo on a paper card or reveal it under a lifting paper flap, but never redraw, recolour or tear the mark itself. If an authentic asset is unavailable, offer an upload control rather than inventing one.

Never invent statistics, measurements, prices or performance claims. Mark schematic values as illustrative.

---

# 3. QUALITY TARGET

The piece must succeed in three ways at once:

- **Craft:** Every piece looks cut from real paper, with torn or knife-cut edges, fibre texture, believable thickness, layered depth and soft contact shadows. The compositions are balanced, with clear focal points and generous negative space.
- **Motion:** Paper moves like paper: it slides in and settles with a tiny overshoot, flips over to reveal its back, folds along creases, lifts as a flap and drops onto the stack. Camera moves and transitions stay smooth. Small parts may move on twos (each pose held two frames) for a handmade stop-motion feel, but the camera and major moves are never jerky.
- **Teaching:** The paper pieces assemble into a real explanation: the components of the subject, how they relate, what happens step by step, and the result. A viewer learns the mechanism, not just its name.

For a short runtime, aim for about 12–18 meaningful visual developments scaled to the resolved length. Each one should reveal a part, change a state, move something along a path, or hand the composition to the next idea. Avoid long title cards, static holds and decorative motion that teaches nothing.

---

# 4. THE PAPER VISUAL LANGUAGE

## Palette (construction paper)

- Warm cream base: `#EFE6D6`
- Terracotta: `#C9623F`
- Mustard: `#E3A83B`
- Slate blue: `#6D93A8`
- Dark ink: `#22313F`
- Sage: `#8AA17A`
- Off-white card: `#F8F1E4`

Use a disciplined subset per scene. Brand colours may replace an accent when they suit paper.

## Material

- **Edges:** Torn edges get a slightly irregular contour with a lighter fibrous rim (1–2 px). Cut edges stay clean and straight.
- **Texture:** Generate a subtle fibre/noise texture once per paper colour and cache it; keep it stable and attached to its piece.
- **Thickness and depth:** Every piece casts a soft shadow offset by 3–6 px at about 25% opacity. Stacked layers deepen the shadow. A lifted piece gets a larger, softer shadow.
- **Details:** Use paper tags with a strip of masking tape, paper pins, punched holes, folded corners, dashed paper-strip arrows, paper rings and paper bar charts that grow up from a base.
- **Type:** Bold rounded sans (Montserrat ExtraBold / Inter Black). White on paper banners, or dark ink on cream tags. Small labels stay crisp and readable.

## Illustrating the subject

Build the subject's real objects out of separable paper parts (body, panels, moving parts, connectors), so they can assemble, open up and move. A cutaway is a paper flap folding back to show the inside. A flow is a dashed paper strip or a stream of small paper pieces travelling along a path. Objects must be recognisable before their labels appear.

---

# 5. MOTION VOCABULARY

- **Slide and settle:** Ease out with a small overshoot (about 4–8 px), then a ±1° resting wobble that stops.
- **Drop onto the stack:** Comes from slightly above, its shadow shrinking as it lands, with one small bounce.
- **Flip:** A scaleX through 0 that shows the back of the card (a different colour or text), with the shadow following.
- **Fold / unfold:** A flap rotates around its crease (simulated by scaling across the crease axis plus a shading change).
- **Tear reveal:** A torn strip pulls away to reveal the next layer.
- **Paper wipe:** A large sheet slides over the frame and carries the next composition with it.
- **Mechanisms:** Rotating parts turn on real pivots and moving parts stay connected. Cause and effect is staged in order: this moves, so that moves.

Overlap the actions: a part is still settling while the next label arrives. Keep short reading holds at key moments.

---

# 6. INFORMATION DESIGN

Choose the diagrams the subject needs: an annotated cutaway, a step loop, a flow path, a before/after, a comparison or a cause-and-effect chain. Labels appear on the word or moment they describe and point at their part with a paper leader strip. Numbers appear only when they are true. The ending resolves the explanation with a complete, labelled picture of the system working.

---

# 7. TECHNICAL IMPLEMENTATION

- Use Canvas 2D (or SVG composited into the capture canvas) for the main rendering. Build reusable functions for: torn-edge polygons (seeded jitter), cached paper textures, shadows, tags with tape, paper arrows, rings and bars.
- Expose a deterministic `renderAt(seconds)` that computes every position, rotation, flap angle, label and camera value from the timestamp alone. Use seeded randomness only.
- Use `requestAnimationFrame()` for preview playback. Cache textures and path geometry; never rebuild them every frame.
- Draw everything that should appear in the video into the single capture canvas. No essential content may live only in DOM overlays.

---

# 8. STORYBOARD STAGE — ONLY WHEN ENABLED

Present this table:

| Scene | Time | What the viewer learns | Paper composition | Motion beats | Transition | On-screen text | Sound |
|---|---|---|---|---|---|---|---|

Then show an Artifact with real rendered preview frames from the same drawing code, with a contact sheet plus an enlarged view. Do one brief check for clipping and readability, then say:

**"Storyboard ready. Review the previews and reply APPROVED to generate the animation, or tell me what to change."**

Stop until the user approves.

---

# 9. FULL ANIMATION

Build the complete sequence in the playable Artifact: continuous paper choreography, a working mechanism, labelled explanations and connected transitions. Add playback controls:

- play / pause
- restart
- seekable timeline
- current time and resolved duration
- toggles only for the enabled audio
- Export Video

---

# 10. MUSIC — ONLY WHEN ENABLED

Compose an original, warm, light instrumental with the Web Audio API, such as soft plucked or mallet notes over gentle chords and a light pulse. It should have a clear key, a beginning and an ending inside the runtime. When narration is present, keep the music well below the voice and duck it gently.

# 11. SOUND EFFECTS — ONLY WHEN ENABLED

Generate subtle procedural paper sounds:

- a soft slide/swish for sheets
- a tap when a piece lands
- a crisp flick on a flip
- a gentle rustle on a tear reveal
- one warmer accent on the key reveal

Schedule them against the timeline. Seeking never replays past sounds. Keep them quieter than the narration.

# 12. EXPORT

Deliver a real MP4 at the configured resolution, frame rate and duration, containing the complete picture and every enabled audio track. Never rename a WebM to `.mp4` or claim an MP4 exists before one has been encoded.

# 13. LIGHTWEIGHT VERIFICATION

Check that:

- it plays
- the paper looks like layered paper, not a texture filter
- one mechanism or flip transition is smooth
- labels are readable
- the audio matches the configuration
- the MP4 is valid

Fix major problems only; avoid long QA loops.

**START NOW.** Follow the configuration and the storyboard setting, and make an original, warm, informative paper cut-out explainer.
