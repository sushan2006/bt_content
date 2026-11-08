# TASK

Create an exceptionally polished, fast-paced animated explainer in a **cinematic kinetic typography** style, following the single project configuration below.

Make typography the main visual material. Design a flowing sequence of precise, expressive letterforms; dramatic shifts in scale and composition; intelligent text-to-diagram transformations; moving information; and exceptionally smooth transitions. Use JavaScript in a playable **HTML Artifact directly inside this Claude conversation**.

This should look like professional title-sequence and editorial motion design, not a slideshow of words flying in, a standard text-animation template, or subtitles over generic shapes. The movement must **explain the selected subject**, not merely display its keywords.

Use the configured storyboard setting to decide whether to present visual previews and stop for approval or to build the final animation directly. Produce a **real downloadable finished video** in the configured output format, with all visual layers and enabled audio included.

Do not use Remotion, Hyperframes, Claude Motion, `/motion`, AI video generators, or a local development setup. Focus work on outstanding typography, impactful timing, substantial educational content, precise composition, and practical delivery.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Cinematic kinetic typography / editorial information design
{{AUDIO_SETTINGS}}

**This is the only editable project-input section.** Treat these values as the single source of truth. Do not interpret later design examples as hidden topic instructions, alternate settings, or a predetermined script. Derive the actual subject matter, labels, factual claims, images, and scene content only from this configuration and any narration provided.

The topic is a free-text field that may be one sentence or a long paragraph. The same instructions must work with completely different educational subjects without editing anything outside this section.

---

# 2. CONFIGURATION BEHAVIOR

Read the project configuration first. Determine the required runtime, output aspect ratio, recording settings, storyboard behavior, audio options, subtitle behavior, and actual content before generating anything.

## Storyboard control

- **If storyboard is enabled:** Produce a concise scene table and an interactive HTML Artifact with real rendered visual previews. Stop and request explicit approval. Only after approval, create the complete animated video.
- **If storyboard is disabled:** Do not display storyboards, approval requests, planning documents, wireframes, or alternate concepts. Plan the motion sequence internally and generate the final playable animation directly.

The presence or absence of a storyboard must never reduce the visual quality or explanatory ambition of the result.

## Narration and duration control

- **If voiceover is enabled:** The uploaded audio recording determines the precise logical video duration and provides the master playback clock. Read its decoded duration rather than assuming a fixed length. Use any provided transcript or SRT as a reference for phrase timing and story. If the attachment is inaccessible inside the Artifact, provide a straightforward audio-file input. Never invent confirmed word-level timestamps without audio alignment.
- **If voiceover is disabled:** Use the configured fixed duration, and make the explanation fully understandable using motion, typography, visual comparisons, diagrams, and concise supporting text. Do not generate a voiceover.

All animation times must derive from the resolved runtime. Do not hardcode an alternate duration into scene code, audio, subtitles, or export logic.

## Optional features

- **Subtitles:** Generate synchronized cues and SRT controls only when enabled. If narration is available, prefer real audio-based timing and flag estimated timing as provisional. With no narration, timed editorial captions can be used if this option is enabled; never fabricate speech.
- **Background music:** Generate, mix, and expose controls for music only when enabled.
- **Sound effects:** Generate, mix, and expose controls for effects only when enabled.
- **Brands or real products:** When the topic genuinely requires real company or product identity, obtain authentic logos, use their approved colors and accurate visual/product details, and preserve the original shape and proportions of each mark. Integrate brand elements into the choreography without modifying the logo itself. For unrelated subjects, create original graphics rather than injecting brands. Never fabricate an official logo or product screenshot. If a verified asset cannot be obtained, request or provide an asset-upload control rather than silently replacing it with an invented one.

Do not add any topic-specific company name, object, example script, or fixed educational sequence elsewhere in the prompt.

---

# 3. CREATIVE QUALITY STANDARD

The finished video must be impressive as a standalone motion graphic **and** worthwhile as a short educational explainer.

## Three equally important outcomes

**Outstanding typography:** Words, letters, spacing, masks, and compositions are beautifully art-directed. Every screen should feel designed rather than automatically filled.

**Exceptionally fluid motion:** The typography progresses continuously with deliberate acceleration, overlaps, reveals, transformation, and coordinated scene transitions. No generic preset slide-in repetition.

**Real educational value:** The visual sequence demonstrates an actual mechanism, comparison, process, relationship, or useful lesson. The audience should learn something rather than watch a string of buzzwords.

Avoid overly abstract animation that obscures meaning. Avoid a list of static cards, one headline every few seconds, or a visually exciting title sequence with no substantial content.

For a short runtime, aim for several meaningful learning points expressed through approximately 12–18 purposeful visual beats, scaled to the resolved length. This is a planning guide, not a rigid quota. A beat reveals something new, changes a relationship, changes a value or condition, clarifies a comparison, or moves the explanation forward. Motion that adds no meaning does not count.

Never invent statistics, performance claims, product capabilities, prices, or citations. If a factual claim requires current verification, use reliable sources when available; otherwise make an accurate qualitative explanation or label a visual as illustrative.

## Meaning and hierarchy

Use meaningful content hierarchy: an immediate point of attention, a dominant message or word group, and secondary micro-labels or explanatory graphics where useful.

Animate relationships rather than merely words. A concept can be crossed out, decomposed, compared, recombined, sequenced, rearranged, or emphasized to show how it works.

With narration off, choose words that carry the argument clearly, at a pace that can be read by a person watching on a phone or laptop. Fast animation does not justify microscopic text or continuous unreadable flashes.

---

# 4. VISUAL DIRECTION — CINEMATIC KINETIC TYPOGRAPHY

Create an original typographic design language inspired by high-end motion identity work, editorial headlines, film titles, and modern information graphics. Do not duplicate any existing creator's template, prompt, title sequence, or demo source.

The text itself is the protagonist. Treat each word as material capable of moving, stretching, clipping, rearranging, interlocking, and changing hierarchy while retaining readability at important moments.

## Palette and editorial character

Suggested stylistic foundation:

- Deep ink: `#10131C`
- Off-white: `#F5F2EB`
- Electric cobalt: `#485FFF`
- Acid yellow: `#E8F54D`
- Coral accent: `#FF715B`
- Cool gray: `#A7ADBE`
- Pure white: `#FFFFFF`

Choose a coherent subset rather than using every color at all times. Make the contrast intentional. Alternate dark and light editorial compositions only when the change advances the story.

Use bold modern typography, carefully aligned grids, oversized display words, crisp rule lines, solid shapes, meaningful numeric elements, and deliberate negative space. A small amount of subtle grain or depth is acceptable, but never allow texture to soften the letterforms.

Use the configured subject to guide emphasis and mood. Do not force every topic into a generic technology palette or visual metaphor.

## Typographic hierarchy

Create visually distinct levels:

- **Hero typography:** Enormous, commanding words or concise phrases; may occupy much of the frame and crop artfully at the edges.
- **Explanatory typography:** Readable sentence fragments, key relationships, short labels, or steps placed strategically.
- **Micro-detail:** Small annotations, indexes, arrows, delimiters, supporting metrics, and grid elements only when genuinely useful.

Not everything needs to be huge. Contrast creates impact. One enormous word combined with a few precise labels can be stronger than a wall of equally sized text.

Ensure that deliberate edge cropping never cuts away the information necessary to understand the lesson.

## Font and letterform choices

Choose legible, aesthetically strong fonts that support the actual topic. Favor bold or variable sans-serif families for the primary system and use a restrained contrasting style for emphasis when appropriate.

You may use compatible, properly licensed web fonts where Artifact access allows it, or dependable built-in font fallbacks. Do not depend on loading an inaccessible font.

Plan exact line breaks and measure text widths. Respect glyph contours, baseline, kerning, capitalization, optical centering, and safe margins. Do not shrink letters independently to force a phrase into a predetermined box.

Never use arbitrary per-character positioning that destroys word spacing or causes inconsistent letter sizes unless that distortion is the intentional effect being demonstrated.

## Composition variety

Use several genuinely different layouts suited to the story:

- Giant centered headline with tiny supporting details
- Asymmetric vertical hierarchy
- Split-screen contrast of related ideas
- Dense typeset wall that resolves into one dominant phrase
- A word becoming a label in a diagram
- A large number or value paired with a clean explanation
- Type integrated into arrows, paths, charts, or information structures
- An editorial grid that breaks and reforms during a transition

These are possibilities, not mandatory shots. The content decides the layout.

---

# 5. TYPOGRAPHY ANIMATION VOCABULARY

Use a refined range of motion techniques. Build variety from the explanation rather than stacking unrelated effects.

## Kinetic type reveals

Use combinations of:

- Masked line reveals and precise vertical wipes
- Words rising through an invisible baseline
- Whole-word movement with internal letter offsets
- Character-by-character reveals only for moments that benefit from them
- Tracking expansion or compression with accurate final spacing
- Scale changes anchored to visually purposeful points
- Rotation on carefully chosen pivots
- Controlled skew, shear, and stretch
- Text blocks sliding behind matte shapes
- Words pushing or displacing one another
- Counter-shapes or negative space exposing additional content

Reveal text rapidly but cleanly. Vary entrances and exits according to the role of each phrase.

## Transformations that teach

Design specific changes in letterforms and words to communicate information:

- Replace one key term with another while preserving the surrounding composition.
- Separate a phrase into meaningful components and connect them.
- Turn a headline into the title of an animated diagram.
- Stack, reorder, or compare phrases to show different outcomes.
- Use a true before/after transition that changes the visual meaning.
- Move a word into a decision branch, sequence, or result.
- Distinguish related categories through deliberate type scale and color.
- Progressively reveal a definition or mechanism rather than showing all text immediately.

Avoid random morphing between unrelated words. The transformation itself should explain the relationship.

## Letterform distortion

Use selective, restrained type distortion for memorable transitions:

- Smooth variable-font weight or width changes when supported
- Carefully controlled perspective and 2.5D rotations
- Elastic-looking character expansion only for stylistic emphasis
- Masked displacement, split-word movement, or hinged text blocks
- Shape-based reveals using letter outlines or Canvas masks
- Controlled text scattering that resolves immediately into legible structure

Do not make text continuously wobble, shake, pulse, melt, or distort without purpose. Keep the final settled type crisp and correctly spaced.

## Readability during movement

Allow motion blur only sparingly, and never fake it with giant unreadable smears. Keep primary phrases on screen long enough to recognize.

Avoid subtitles masquerading as kinetic typography. Motion should be composed at the word, phrase, and graphic-system level, not just bouncing word-by-word captions.

---

# 6. MOTION DIRECTION — SMOOTH, FAST, CONNECTED

The desired movement is strikingly smooth and fast-paced, with refined editorial control.

## Choreography

Build overlapping events rather than executing isolated actions one after another. One phrase can begin transforming into a diagram as the following label appears, while the background grid subtly reframes.

Use carefully tuned easing, anticipation, short holds for reading, and transitions with follow-through. Shift visual focus deliberately.

Use `requestAnimationFrame()` for preview and a timeline that can be evaluated at arbitrary timestamps. Motion must advance based on elapsed time, never on the number of frames drawn.

Avoid abrupt teleports, visibly stepped movement, unintentional font jumps, unstable baselines, and sudden disappearance of important text.

## Transition design

Create transitions from meaningful typographic events:

- A giant word slides past the camera, carrying the next composition behind it.
- A letter or punctuation mark becomes a masking shape.
- A sentence compresses into a thin rule, which expands into the next diagram.
- A full-screen word separates into aligned columns revealing another comparison.
- A highlighted phrase grows into the following section heading.
- A typographic grid reflows and changes visual meaning.
- A line of text becomes a path or chart label.

Transitions should preserve continuity between ideas. Avoid repetitive fades to black and endlessly resetting the stage.

## Camera and space

Use intentional virtual-camera framing, short push-ins, controlled pans, layered depth, and occasional 2.5D movement where it improves the story. Scale typography without losing legibility or creating blurry rasterized edges.

A camera move should make the viewer see something new, not simply keep the screen moving.

## Pacing without a voiceover

Design a readable yet energetic sequence. The pace may be fast, but viewers must be able to parse the educational point at each major state.

Use short impact moments, distinct visual beats, intentional pauses, and coordinated sound to communicate structure. Avoid filling the runtime with either long static holds or chaotic unreadable flashes.

When voiceover is enabled in a future configuration, align visual changes to speech phrases rather than imposing this silent-video rhythm on the recording.

---

# 7. INFOGRAPHIC ELEMENTS AND EXPLANATORY DEPTH

This is not only animated lettering. Integrate original information graphics wherever they materially improve the explanation.

Useful graphic components may include:

- Process timelines
- Change-of-state diagrams
- Branches and choices
- Before/after comparisons
- Rankings when supported by real data
- Precise arrows and direction markers
- Annotated cards
- Clear progressions, phases, or mechanisms
- Counters and numbers only when factually defensible
- Relationships between labels and illustrated components

Text and graphics should move together as a connected system. Avoid putting a diagram behind the typography merely as decoration.

Use a coherent system of grid spacing, lines, alignment, colors, corner shapes, timing, and visual hierarchy. Give meaningful elements appropriate visual weight.

Do not fabricate numerical data, scientific facts, performance scores, or product screenshots. A schematic may be illustrative, but should not be represented as an authentic measurement or interface.

## Educational pacing

Build the explanation around the most important ideas in the configuration. Start with a compelling idea or contrast. Develop specific substance. Finish with a clear resolution.

Don't use an empty hype slogan in place of substance. Avoid a generic hero title followed by several disconnected bullet words.

When possible, make the type itself demonstrate the process: visually reorganize, compare, connect, change state, or reveal a condition.

---

# 8. TECHNICAL IMPLEMENTATION — TEXT-FIRST RENDERING

Create the animation inside a normal Claude HTML Artifact with browser-compatible JavaScript.

You may use:

- JavaScript, HTML, and CSS
- Canvas 2D and Path2D
- SVG masks and text paths
- Native browser animation capabilities
- GSAP and SplitText where loaded and genuinely useful
- Browser-compatible text-layout or vector utilities when necessary
- WebGL shaders for a particular effect when they offer a clear advantage
- Web Audio API and browser media recording/encoding APIs

Do not require local package installation, a terminal, a separate site builder, or a build process. Verify that any CDN-dependent library actually loads inside the Artifact; use native techniques when external access is limited.

The creative design must be original. Do not copy existing motion-demo source code or someone else's title sequence.

## Single captured composition

**The exported video must contain the full finished picture.** Build a capture-safe typography pipeline.

Prefer a master Canvas rendering surface for the final frame. Text can be drawn directly using Canvas, rasterized from pre-rendered SVG, or sampled from securely loaded font glyphs. Supporting vectors, masks, backgrounds, and diagrams should be composited into that same capture surface.

If a DOM/GSAP layer is used for interactive preview, ensure the same text is actually drawn or composited into the recording canvas. **Do not assume that `canvas.captureStream()` captures ordinary HTML/CSS text positioned above a canvas.** It does not.

Avoid repeatedly converting the live DOM into an image every frame if that creates lag or loses fonts. Choose a renderer that remains visually faithful in playback and in the saved video.

## Typography rendering quality

- Wait for fonts to load before measuring and positioning text, when a web font is used.
- Use `measureText()` or glyph metrics to determine word and line widths.
- Preserve correct kerning. When splitting words into letters, calculate positions from reliable advances and account for kerning changes.
- Keep type sharp by rendering it at sufficient resolution and avoiding excessive bitmap enlargement.
- Use antialiased masks for wipes and letter effects.
- Carefully control clipping and overscan during large-scale moves.
- Keep typographic alignment consistent across resolution settings.
- Use safe layout constraints suited to the configured aspect ratio.

Never allow words to unexpectedly reflow mid-animation because the preview canvas resized. Use fixed logical design coordinates scaled consistently to the canvas dimensions.

## Smooth animation model

Provide a master, seekable timeline that supports an equivalent of:

`renderAt(seconds)`

It must evaluate the complete correct visual state for any timestamp, including all text, diagram, background, mask, and camera properties.

Animation should not depend on previous-frame positions. Use stable seeded values for any decorative variation, and avoid random jitter.

A compatible GSAP timeline can be used to define choreography if it can be deterministically seeked and rendered to the final output surface. Do not build a fragile collection of disconnected `setTimeout()` transitions.

## Reusable utilities

Develop reusable functions for:

- Text measurement and layout
- Masks and reveal regions
- Word and line transforms
- Easing and interpolation
- Variable typography parameters when supported
- Animated outlines and rules
- Information-graphic construction
- Camera transform and zoom
- Timeline sequencing
- Color and background transition
- Final frame compositing

Build what the chosen topic needs, rather than implementing an unnecessarily large typography editor.

---

# 9. PRODUCTION QUALITY AND PERFORMANCE

Prioritize smoothness, correct rendering, and visibly strong movement over adding hundreds of unnecessary text elements.

- Cache text geometry, font measurements, static masks, and prerendered glyph assets when useful.
- Avoid excessive per-frame DOM manipulation and forced reflows.
- Use transforms or direct canvas drawing rather than expensive repeated layout calculations.
- Where a blur, displacement, or outline animation is costly, reserve it for hero moments.
- Maintain crisp text edges and useful contrast.
- Use preview scaling when necessary without changing logical composition.
- Keep exported text and graphics at the configured native output resolution.

Avoid overengineering. A small number of spectacular, well-designed transitions is better than a huge number of cheap effects.

Do not solve a performance issue by reducing the animation to plain fade-ins or basic bullet-list slides. Preserve creative intent while optimizing its implementation.

---

# 10. STAGE 1 — STORYBOARD ONLY IF ENABLED

Execute this stage **only** when the storyboard setting is enabled. Otherwise proceed directly to the complete animation.

## Story structure

Identify the most valuable points for the resolved runtime. Plan a connected sequence of approximately 4–5 major compositions for a short video; vary the count to fit the actual subject and duration.

Each composition must contain several purposeful motion beats, not just an entrance and a long static hold.

Decide how the current headline, information graphic, color, and moving type will transform into the following visual idea.

## Storyboard table

Present a compact but specific table:

| Composition | Time | What the viewer learns | Typographic layout | Motion choreography | Supporting graphics | Transition | Audio cue |
|---|---|---|---|---|---|---|---|

Write specific proposed words only after deriving them from the topic. Show distinct movements with approximate timing and reading holds. Cover the resolved duration without unexplained gaps.

## Visual storyboard Artifact

Create a real HTML Artifact showing JavaScript-rendered stills for the proposed compositions.

The visuals must show actual typographic hierarchy, font choices or fallbacks, letter spacing, composition, colors, labels, masks, and infographic components. Do not substitute ASCII art, placeholder words, generic colored boxes, or text-only descriptions.

Use a contact sheet of moderate-resolution previews and allow a selected frame to be enlarged. Use the same layout and drawing engine intended for the final animation. Do not render a separate full-resolution canvas for every thumbnail or build complete scene animations at this stage.

Keep storyboard creation focused and efficient.

## Stop for approval

Make one brief visual check for clipping and text readability. Correct obvious mistakes.

Present the table and visual Artifact, then stop and ask for approval. If revisions are requested, adjust the relevant compositions rather than recreating everything unnecessarily.

**Do not create the complete animation until explicit approval is given.**

---

# 11. STAGE 2 — FULL ANIMATION

If storyboard is disabled, start this stage immediately. If storyboard is enabled, start only after approval.

## Build the piece

Create a complete playable HTML Artifact with a highly polished, continuous kinetic typography explainer.

Use the configuration and, when relevant, the approved storyboard to determine the composition sequence and motion events. Reuse any approved text layouts and visual assets.

Implement impactful typography transformations, precise masked reveals, varied editorial layouts, and animated information graphics. Make sure the animation communicates substantive useful points throughout.

Do not simplify the artwork into a few giant words flying across a blank screen. Build a proper visual narrative with layered movement and controlled contrast.

## Preview controls

Provide:

- Play / pause
- Restart
- Seekable timeline
- Current time and resolved duration
- Export Video
- Toggle(s) for only the configured audio features
- Voiceover file and volume controls only when voiceover is enabled and needed
- Subtitle controls and SRT download only when subtitles are enabled

The Artifact should be primarily a video preview, not a full video-editing application. Scale it to the Artifact viewport without distorting the configured aspect ratio.

---

# 12. VOICEOVER AND SUBTITLES — CONDITIONAL

Use this section only when the configuration enables voiceover and/or subtitles.

## Voiceover playback

When narration is enabled, load the actual recording provided with the prompt or through an Artifact file picker. Read its real decoded duration and use the narration's position as the master clock.

The animation must track the audio's `currentTime` (or equivalent playhead); seeking and pausing should affect audio and visuals together. Never stretch the recording to fit a separate fixed-length visual.

Use a supplied transcript or SRT where available. Obtain actual alignment only if reliable audio-transcription or forced-alignment capabilities are accessible. Otherwise label phrase timings provisional rather than inventing precision.

When subtitles are enabled, create accurately ordered cues and allow downloading an SRT file. If captions are meant to appear in the exported video, draw them onto the capture surface, not only as uncaptured DOM text.

When narration is disabled, do not synthesize or invent spoken words.

---

# 13. BACKGROUND MUSIC — CONDITIONAL

Only create background music when the configuration enables it.

Generate an original, professionally restrained musical bed using native Web Audio synthesis. Do not download commercial tracks or imitate copyrighted recordings.

Keep it musical, with a clear tonal center, a simple coherent chord or note pattern, deliberate rhythmic structure, and energy that supports the pace of the typography.

Suitable elements may include:

- A tight, understated electronic pulse
- Rounded plucked synth notes
- Subtle warm chords
- A gentle low-end foundation
- Short accents at major editorial changes
- Controlled filtered atmosphere

Avoid constant buzzing, unrelated random notes, overly loud percussion, or a melody that distracts from on-screen information.

Match the musical rise and fall to the resolved runtime and major transitions. Use subtle variation rather than an unrelated loop.

When narration is enabled, keep music well below the spoken voice and duck it gently around dialogue. When narration is disabled, music can lead the overall rhythm more clearly.

Fade music in and out inside the actual timeline. Do not let the soundtrack run beyond the video.

Use reusable audio scheduling rather than creating unbounded oscillators on every rendered frame.

---

# 14. SOUND EFFECTS — CONDITIONAL

Only create sound effects when the configuration enables them.

Use original, procedurally generated Web Audio sounds that support precise typographic motion:

- Tight clicks when characters snap into place
- Soft impact accents for major words
- Delicate swishes during masked reveals
- Subtle rising synth sweeps during scale changes
- Short, controlled accents as relationships change
- Clean transition sounds accompanying important rearrangements

Choose effects based on the actual composition; do not add one sound to every letter.

Use simple oscillator shapes, filtered noise, gain envelopes, and restrained stereo placement when compatible.

Synchronize effect events with the master visual timeline. Seeking must not retrigger all earlier cues. Playback and recording must use consistent event timing.

Route enabled music and effects, plus optional voiceover, into a shared master mix. Avoid duplicate narration or clipping. Keep audio balanced, refined, and appropriate for the actual topic.

---

# 15. FINAL VIDEO EXPORT — PRIORITIZE DOWNLOADABLE MP4

**The final deliverable must be a real, downloadable video in the configured output format, containing the complete animation and every enabled audio track.** An animated HTML preview alone is insufficient.

A file's extension must accurately reflect its encoded container and codecs. Never rename WebM bytes to `.mp4`, and do not claim that exporting MP4 succeeded until an actual MP4 file exists.

## Capture requirements

Capture the full final composited frame: typography, masks, vector elements, graphs, any verified brand visuals, backgrounds, and transitions. All essential content visible in preview must appear in the recording.

Use the configured native resolution, frame rate, and resolved duration. Start recording at the beginning, finish on the intended final state, and ensure the audio ends with the video.

Mix all enabled audio through Web Audio and `MediaStreamAudioDestinationNode`; combine it with the recorded video surface where appropriate. Export video-only when every audio option is disabled.

## MP4 export strategy

Implement a genuine browser-compatible route to the configured output format. Prefer the simplest supported method:

1. **Native MP4 recording:** Check actual browser capabilities using `MediaRecorder.isTypeSupported()` and attempt direct `video/mp4` recording with supported video/audio codecs when available. Test the resulting file rather than assuming that a supported MIME string guarantees success.
2. **Browser-side MP4 encoding and muxing:** If native recording is unavailable, prefer WebCodecs with a browser-compatible muxer, such as Mediabunny, **only when its JavaScript module can actually load and the necessary encoder configuration is supported**. Use a real MP4 container and compatible video/audio tracks; prefer H.264 video and AAC audio when supported. The muxer must receive the actual rendered frames and audio, not merely wrap unsupported WebM data in an MP4 container.
3. **Practical file-access fallback:** If the Artifact cannot encode or download the requested format because of sandbox or browser restrictions, provide a downloadable self-contained HTML version that can attempt the same verified export in a normal compatible browser, and state the precise limitation.

Do not automatically introduce a large local development workflow or heavyweight WASM encoding runtime merely to chase the output format. Use lightweight browser APIs or one compatible media library when appropriate.

Do not silently substitute another file format and claim the requirement was met. A genuine alternative download may be provided as a secondary fallback, explicitly labeled as such, but keep the configured format the primary deliverable.

## Recording quality

Prefer deterministic frame evaluation for encoding whenever a supported browser-side encoder makes it practical. If real-time MediaRecorder capture is used, acknowledge that frame drops or slight duration variation may occur under load.

The generated music and effects must be recorded along with the video. Do not export a silent file while the Artifact preview plays sound.

After encoding, provide a clear **Download Video** control for the actual resulting file. Avoid making users hunt through code to find it.

---

# 16. LIGHTWEIGHT VERIFICATION

Keep checks short and centered on real usability, not an extended code-testing project.

If storyboard is enabled, confirm the rendered frames display well, the main typography is readable, and there are no serious clipping problems.

For the completed animation, perform a quick functional pass:

1. The Artifact loads and the animation plays.
2. A few representative moments contain correctly spaced, readable typography and meaningful information.
3. A major text transformation and transition render smoothly, without unintended gaps or layer loss.
4. Enabled sound plays with the video.
5. A real downloadable file in the configured format is produced where technically possible, or a concrete limitation and fallback are given.

Fix broken code, missing text, black frames, export failures caused by implementation mistakes, and severe clipping.

Do not conduct exhaustive screenshot comparisons, prolonged performance profiling, repeated full exports, speculative troubleshooting chains, or repeated autonomous redesigns for minor details.

Stop when the animation is genuinely useful, visually strong, plays correctly, and has the best viable export supported by the environment. Leave optional polish for user feedback.

---

# 17. EFFICIENT EXECUTION

Make creative decisions independently from the single configuration block. Keep commentary short, and concentrate output on the playable artifact and final video.

Avoid extra research unless needed for factual accuracy, authentic brand assets, or a blocking technical issue. Do not create alternate concepts, supplemental editing apps, or multiple unnecessary versions.

Reuse typography, mask, timeline, audio, and diagram utilities. Keep the solution straightforward enough to modify during follow-up chat messages.

Prioritize the details that viewers notice:

- Beautifully aligned and measured letterforms
- Dramatic type hierarchy and excellent contrast
- Smooth, energetic choreography
- A variety of meaningful reveals and transformations
- Strong explanatory substance
- Consistent editorial art direction
- Precise sound synchronization
- Readable final states
- Complete encoded video output

The result must feel like professional motion design, not a template demonstration.

---

# 18. DELIVERY AND START

**When storyboard is enabled:** Deliver the storyboard table and real rendered preview Artifact, then stop for approval. After approval, create the complete animation and final video.

**When storyboard is disabled:** Build the complete animation immediately without asking for storyboard approval.

For the finished animation, provide:

1. The playable HTML Artifact.
2. Working playback and seeking controls.
3. Any audio and subtitle features enabled in the configuration.
4. **A real downloadable video in the configured output format** when the browser permits it, with a clearly labeled Download Video control.
5. A compatible standalone HTML fallback only if the Artifact cannot deliver the requested file format.

Explain any genuine export restriction briefly and precisely; never present a format substitution as a successful MP4 export. Do not provide a lengthy code report.

**START NOW.** Read the one configuration block. Follow its storyboard setting. Create an original, fast-moving, beautifully art-directed kinetic typography explainer that teaches the configured topic through letters, words, diagrams, and flowing transitions. Deliver the finished animation and actual video file according to the selected production settings.
