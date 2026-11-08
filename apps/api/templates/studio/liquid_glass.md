# TASK

Create a professionally designed, cinematic animated explainer in a **liquid glass motion graphics** style, following the project configuration below.

Build an exceptionally fluid visual sequence in which transparent glass forms refract the scene behind them, stretch, separate, merge, transform into information displays, and guide the viewer through a clear explanation. Combine physically convincing optical effects with elegant editorial typography, information graphics, dimensional compositions, and connected transitions.

Create the experience as a playable **HTML Artifact directly in this Claude conversation**, using JavaScript and browser rendering. Do not use Remotion, Hyperframes, Claude Motion, `/motion`, an AI video generator, or a local development setup.

Use the configured storyboard option to determine whether to show visual previews and stop for approval or produce the finished animation immediately.

**The target is a premium motion-design sequence, not static translucent cards, a blurred slideshow, or a UI mockup with a little movement.** Make the material itself part of the storytelling. Keep the video visually striking, informative, remarkably smooth, and practical to render.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Cinematic liquid glass infographic
{{AUDIO_SETTINGS}}

**This is the only editable project-input section.** Treat its values as the single source of truth. Do not treat later visual suggestions as extra topic instructions, alternate settings, or a fixed script. All topic-specific objects, factual details, data, typography, scene content, and durations must be inferred from this configuration or a supplied narration.

The topic is free text: it can be a sentence or a full paragraph. The same prompt must work on unrelated educational subjects without replacing anything outside this section.

---

# 2. CONFIGURATION BEHAVIOR

Read the entire configuration once before producing content. Resolve the runtime, output size, aspect ratio, frame rate, narration, subtitle mode, sound, and approval process from those values.

## Storyboard behavior

- **When storyboard is enabled:** First generate a concise scene table and a visually polished HTML Artifact containing actual rendered scene previews. Stop and request approval. Generate the full animated video only after explicit approval.
- **When storyboard is disabled:** Skip storyboards, approval checkpoints, concept options, and wireframes. Plan internally and deliver the complete playable animation directly.

Do not let the storyboard option change the animation's quality standard.

## Voiceover and duration behavior

- **When voiceover is enabled:** Treat the attached recording as the master clock. Read its decoded duration; use that duration for visuals and export. Use a supplied transcript or SRT if available, align visuals to spoken ideas, and never fabricate verified word-level timestamps. If the audio is inaccessible inside the Artifact, expose a simple file input for the recording and synchronize after it loads.
- **When voiceover is disabled:** Use `Duration without voiceover` as the complete runtime. Communicate the explanation through illustrations, concise on-screen text, moving diagrams, and visual transformations. Do not synthesize or invent narration.

Do not assume any hardcoded duration in the animation engine. Keep scene timing proportional to the resolved runtime.

## Optional elements

- **Subtitles:** When enabled and narration is available, create or accept an SRT with reliable timing where possible. If only a transcript is available, mark inferred cue timings as provisional. When subtitles are enabled without narration, use timed explanatory captions, not fabricated speech. When disabled, omit subtitle rendering and SRT controls.
- **Background music:** Generate and mix it only when enabled. Do not substitute music for an absent narration.
- **Sound effects:** Generate and mix them only when enabled.
- **Brands and real products:** If the configured subject includes named products or companies, use authentic logos, their correct colors, and recognizable, accurate product details where they improve the explanation. Preserve the original marks; animate around them rather than distorting them. Obtain verified assets where available, and never fabricate official branding. For subjects without real branded entities, use original illustrative material.

Do not introduce topic-specific brands, tools, companies, or scenario instructions anywhere else in this prompt.

---

# 3. CREATIVE QUALITY STANDARD

The final piece must deliver equally on **educational value, visual design, and motion quality**.

## An explanation, not a demo reel

Design a connected visual story that teaches something real about the configured topic. Identify the useful sequence, mechanism, cause-and-effect relationship, comparison, or transformation involved.

Use moving structures and changing states to show what happens and why. Avoid relying on generic statements or decorative motion. Provide enough substance that a viewer learns something, even when narration is disabled.

For a short runtime, aim for several meaningful learning points and approximately 12–18 purposeful visual beats across the sequence, adjusted to fit the resolved duration. A beat should introduce information, change the state of a visual, reveal a relationship, or advance the story—not merely add another glow or transition.

Make each composition informative yet readable. Use short headlines, concise annotations, state changes, connected diagrams, labeled objects, and animated comparisons only where they improve understanding.

Never invent factual statistics, benchmarks, pricing, product behavior, or success claims. If the subject needs factual verification, use reliable sources as available. When a visual is illustrative rather than a factual measurement or actual interface, represent it as such.

## Strong visual hierarchy

At every moment, make it evident where viewers should look. Give each composition a hero visual, clear hierarchy, and sufficient negative space.

Use a mixture of recognizable subject-specific forms, sharply legible text, transformed information objects, and convincing glass elements. Avoid covering everything in frosted panels. Not every element needs to be glass.

## Connected visual storytelling

Prefer continuous transformations over unrelated screens appearing one after another. The glass element carrying one idea can flow into the visual for the following idea; an informational object can pass through a lens and visibly change state.

The viewer should perceive one choreographed sequence, not separate slide animations. Use an engaging opening, substantive middle, and a finish that resolves the information presented.

---

# 4. VISUAL DIRECTION — CINEMATIC LIQUID GLASS

Create a refined visual world of transparent, refractive glass structures and fluid optical surfaces. The glass must look convincing when moving across detailed background imagery: shapes and lines behind it should bend, magnify, compress, or distort naturally through the lens.

**The core requirement is visible optical refraction and surface deformation.** CSS opacity, `backdrop-filter: blur()`, translucent rounded rectangles, and highlights alone do not satisfy the style.

## Art direction and palette

Use a premium, clean, dimensional aesthetic with dramatic but restrained color.

Starting palette:

- Midnight graphite: `#0A1120`
- Deep blue: `#15243C`
- Cool porcelain: `#F2F7FF`
- Electric blue: `#599CFF`
- Aqua: `#65D9D3`
- Soft lavender: `#B8ABFF`
- Warm peach highlight: `#FFC7AB`
- Crisp white: `#FFFFFF`

Use these as an aesthetic base, not an excuse to color real branded assets incorrectly. The subject may call for lighter editorial moments or different verified branded colors.

Build rich but controlled backdrops with gradients, finely drawn lines, thin grids, symbolic geometry, illustrated objects, or data paths **related to the explanation**. These are necessary surfaces for glass refraction to be visible; do not fill backgrounds with arbitrary clutter.

Use color to distinguish states, actions, important results, and related components. Reserve vivid accents for moments that matter.

## Optical properties

Glass surfaces should demonstrate several of these properties where visually useful:

- Real-time refraction of the background behind the surface
- Lens magnification or displacement that varies with surface curvature
- Convincing curved edges or beveled rims
- Subtle Fresnel-style edge highlights and specular reflections
- Physically inspired transmission and restrained reflection
- Gentle internal tint or absorption where appropriate
- Controlled chromatic dispersion near the edges
- Thickness-dependent shading and optical depth
- Delicate surface distortion during deformation
- Soft but well-defined contact or depth shadows

Tune the effects so that important objects can be identified through the glass. Excessive blur, rainbow fringing, or overexposed shine makes the scene less professional.

## Glass forms

Create a library of original, useful glass structures:

- Rounded optical lenses that meaningfully magnify or transform information
- Thin transparent sheets with visible beveled edges
- Sculpted, rounded volume forms
- Flowing ribbons or curved channels with apparent thickness
- Fluid, merging lenses that can separate again
- Glass containers, frames, or surfaces shaped to fit the topic
- Dimensional objects whose structure can be explained by splitting or reassembling

These are construction possibilities, not a list of mandatory objects. The configured subject determines what should appear.

Vary the scene composition. One powerful refractive object interacting with meaningful graphics is often more impressive than many little glass cards.

## Sharp content versus distorted content

Keep essential type, labels, verified logos, and fine diagrams sharp and recognizable. They can sit on top of the glass, appear beneath a lens when readability is preserved, or be revealed by refractive motion.

Use refraction to transform the environment and guide attention. Don't distort every word or scramble important information.

Preserve generous margins and safe positioning for small-screen viewing.

---

# 5. SMOOTH MOTION AND MATERIAL CHOREOGRAPHY

The animation should look **exceptionally smooth**, with continuous motion and carefully directed changes from beginning to end.

## Motion behavior

Use time-based easing, controlled acceleration, anticipation, overlap, and gentle settling. Separate fast editorial changes from slow, deliberate optical deformation.

Coordinate object movement, changes in curvature, shadow behavior, lighting, typography, and camera motion. When a glass surface lifts or merges, its refractive response and edge highlights should change consistently with the surface.

Avoid:

- Choppy movement or fixed-step stop-motion
- Random pulsing and endless floating
- Sudden teleports or abrupt opacity switches
- Identical slide-ins for every element
- Mechanical, unexplained oscillations
- Heavy bouncy overshoot after every action
- A long pause after each entrance animation

The motion can be energetic without feeling rushed. Preserve brief reading holds during important information changes.

## Fluid forms

Make deformation visible and believable:

- A lens stretches into a ribbon while preserving volume-like behavior
- Two lenses approach, touch, merge, and settle as one continuous shape
- A large lens divides into smaller connected forms
- Glass edges smoothly shift curvature during transitions
- A translucent surface folds or travels across the composition
- Light and refraction travel with the glass geometry

Use these motions to explain changes or relationships, rather than performing arbitrary shape-shifting between unrelated forms.

## Continuous transitions

Favor scene changes built from physical continuity: a lens crosses the frame and reveals a new information state, a glass sheet becomes the surface of another composition, or information flowing through a glass channel becomes the following visual.

Avoid frequent fades to black, hard cuts that reset all objects, and a sequence of unrelated transparent cards.

## Camera direction

Use restrained, cinematic virtual-camera movement when it supports the explanation:

- Short push-ins toward an important detail
- Smooth tracking along a process or connection
- Parallax revealing separation of optical layers
- Reframing to connect related information
- Pulling back to show the finished structure

Choose the camera path in concert with the glass movement. Prevent the background, foreground, and typography from drifting out of visual alignment.

---

# 6. INFORMATION DESIGN AND STORY PACING

Develop a clear visual sequence suited to the configured topic, available runtime, and narration option.

## Main compositions

For a short video, use approximately 4–5 distinct main compositions linked by ongoing transformations. The compositions are **not static scenes**. Each should include several coordinated visual changes.

A composition may begin with a clear idea, reveal related information through lens movement, show a change of state, and then transform into the following composition.

Do not fill the full runtime with a few slow objects appearing and disappearing.

## Meaningful visual beats

Use a mix of:

- An object or diagram being constructed
- The relationship between two components becoming visible
- Information passing through a clearly defined process
- A before/after comparison that visibly changes
- A branch or decision revealing a different state
- An information panel restructuring as the underlying state changes
- A visual mechanism unfolding or being examined
- A final outcome resolving the initial explanation

Use only the actions warranted by the topic. The details should be created from the user's brief, not from predetermined examples hidden elsewhere in the prompt.

## Text choreography

Treat typography as part of the motion design. Reveal meaningful words with masks, tracking, refractive lens sweeps, precision scaling, and clear annotation movements. Keep letterforms sharp, avoid excessive distortion, and don't turn ordinary labels into hard-to-read visual effects.

Use concise phrases. With narration disabled, make the visual story understandable without paragraphs. Let graphics demonstrate information, and use text to anchor the meaning.

## Brand and identity accuracy

When authentic branded identities are relevant, research or verify the appropriate marks and actual visual characteristics. Prefer official downloadable SVG or PNG assets, preserve proportions and approved colors, and integrate them into the final recorded frame. Use decorative glass around the authentic mark rather than changing the mark.

Do not fabricate product interfaces, capabilities, statistics, or logos and present them as authentic. When a real asset is unavailable, use a neutral clearly illustrative visual or a user-provided asset with appropriate labeling.

---

# 7. TECHNICAL IMPLEMENTATION — REAL-TIME REFRACTION

Use JavaScript in a normal Claude HTML Artifact. Prefer WebGL/WebGL2 and GLSL where they materially improve refraction, animated optical geometry, and rendering performance. Three.js is allowed when it can run inside the Artifact without a local build process.

You may use:

- HTML and CSS for the surrounding controls
- JavaScript for scene construction, state, audio, and timing
- WebGL / WebGL2 and GLSL for optical rendering
- Three.js and browser-compatible libraries when they provide a real advantage
- Canvas 2D or SVG for sharp diagrams, masks, and rasterized text layers
- Native Web Audio API and browser recording APIs

Do not depend on external video footage, stock images, AI image generation, downloaded soundtracks, or prerecorded effects. Verified authentic brand assets are allowed when the topic calls for them.

Avoid dependencies requiring package installation, a build process, CLI commands, or a development server. If a CDN dependency is used, ensure the Artifact can actually load it; disclose it in any downloadable HTML fallback. Do not silently assume an inaccessible external library works.

## Choose a rendering approach that truly bends pixels

Implement one coherent optical rendering pipeline rather than layering arbitrary blur effects.

Preferred approach for a scene with glass over graphics:

1. Render the meaningful background and information elements into an offscreen texture or framebuffer.
2. Build a shape mask for each lens or glass surface.
3. Determine surface curvature or a normal field from the shape, bevel, or displacement function.
4. Re-sample the source backdrop using displaced UV coordinates driven by the optical shape and movement.
5. Apply restrained edge reflection, Fresnel-inspired highlights, tint or absorption, optional frosted transmission, and chromatic separation when appropriate.
6. Composite the transformed glass and sharp foreground information into the final video canvas.

Important: a blur-only CSS card is **not** an acceptable substitute for the effect. The viewer should be able to see information behind the lens visibly bend or magnify when the lens moves.

## Glass shader behavior

Use purpose-built vertex/fragment shaders when useful. The optical model should account for:

- Curved lens silhouette and beveled edge
- Smooth, anti-aliased shape masks
- Surface normal approximation or a normal field
- UV displacement related to apparent curvature and thickness
- Distinct but subtle color-channel offsets near refractive edges
- Bright, narrow highlights along appropriate surface regions
- Smooth blending during lens movement or shape morphing
- Controlled opacity and color without losing background detail

Signed distance fields, analytic rounded shapes, metaball-style surface blending, triangulated deformable surfaces, and shader-controlled displacement are possible techniques. Select the technique that suits the actual scene composition.

Avoid visible seams, broken transparency order, excessive edge aliasing, and black or empty refraction regions when the background moves.

## True 3D glass where useful

For dimensional objects, a suitable Three.js physical-transmission material can be used with reasonable index of refraction, thickness, environmental reflections, and restrained dispersion. An environment texture or procedurally generated lighting setup may be necessary to keep the material legible.

Do not turn every composition into an expensive full-3D glass simulation. Use the less costly custom screen-space method for flatter lens effects where it gives a better-looking result.

When mixing techniques, keep material appearance, lighting direction, and motion coherent across shots.

## A distinctive original implementation

Write original shader logic, geometry, scene compositions, transitions, and editorial visuals. Do not copy another creator's prompt, demo scene, commercial site, or complete animation source code.

Use established browser APIs and rendering concepts as technical building blocks, not as pre-made creative content.

---

# 8. MORPHING, OPTICS, AND TRANSITION ENGINE

Build reusable components that can support different topics without predefining a single subject-specific story.

## Lens geometry

Represent optical shapes through parameters or reusable mesh and mask data. Animate position, scale, curvature, thickness, deformation, tint, and lighting in a controlled way.

For a merge or split effect, smoothly blend the underlying forms so the intermediate frames are convincing. Avoid suddenly swapping an ellipse for a rectangle or changing geometry at arbitrary time thresholds.

Maintain recognizable object silhouettes at important moments. Smoothness is not enough if the viewer cannot tell what is happening.

## Material animation

Use coordinated transitions of:

- Refraction strength
- Curvature and bevel
- Surface highlights
- Internal tint or absorption
- Shadow softness and separation
- Distortion of background content
- Shape and camera transforms

Avoid independent random animation of optical parameters. Movement should feel art-directed, physically inspired, and tied to the explanation.

## Data and diagram transforms

Build reusable systems for precision text, arrows and connection paths, geometric symbols, charts, conditional paths, labels, comparison panels, and changing information structures.

These should move with the scene and remain visible in the final recording. They need not all be made of glass; contrasting sharp shapes against refractive surfaces can make the optical effects far more impactful.

## Visual continuity

Keep a timeline of the important objects and visual states. Carry elements into later shots where feasible, rather than disposing of every composition and recreating everything from scratch.

Use one design language for dimensionality, typography, movement, camera perspective, lighting, and color.

---

# 9. RENDERING ARCHITECTURE AND SMOOTHNESS

Use a single master animation timeline driven by elapsed time and the resolved duration.

Expose an equivalent of:

`renderAt(seconds)`

This should be able to produce the correct visual state for an arbitrary timestamp, including optical deformation, background content, diagrams, typography, and camera transforms.

Do not depend on the previous rendered frame to establish the main visual positions. Stable seeded variation is acceptable, but do not use new randomness per frame to drive important motion.

Use `requestAnimationFrame()` for real-time preview. Calculate animation progress from time, not from the number of frames that happened to render.

## Performance decisions

- Prefer GPU-based distortion and compositing over CPU pixel manipulation every frame.
- Cache procedural textures, geometry, text textures, masks, and static backdrops.
- Reuse render targets or buffers when possible; resize only when needed.
- Avoid excessive transmission passes, repeated full-screen blur filters, heavy postprocessing, and unnecessary multi-pass rendering.
- Prefer a few visually substantial glass objects to many costly, overlapping refractive surfaces.
- Use a reduced preview rendering scale when needed, preserving the configured native export size.
- Keep edges crisp, labels readable, and the refractive effect visible even if expensive cosmetic effects are reduced.

Do not solve performance issues by turning the glass into basic translucent rectangles.

## Color and compositing

Choose a consistent color-space and compositing approach. Avoid washed-out highlights, unintended premultiplied-alpha edges, or black borders around refractive objects.

Keep essential foreground text and brand assets at readable resolution. Use high-quality anti-aliasing for refractive boundaries and diagrams.

## Artifact resilience

If a WebGL feature or a specific library is unavailable, use the simplest viable browser-based alternative that **still demonstrates real optical displacement**. An honest simplified refraction effect is preferable to claiming that CSS blur is sophisticated liquid glass.

If rendering or recording is blocked by the Artifact environment, keep the implementation usable in a normal Chromium browser as a fallback. Avoid spending significant time on speculative workarounds.

---

# 10. STORYBOARD STAGE — ONLY WHEN ENABLED

**Skip this entire section when the configuration disables storyboard.** Do not make a scene table or ask for approval in that case.

When enabled:

## Develop the explanation

Identify the essential learning points from the configured topic and any supplied narration. Plan a connected narrative that fits the resolved runtime, with meaningful changes within each main composition.

Specify which optical forms carry the story, what information is revealed, how their shapes deform, and how each shot becomes the following shot.

## Storyboard table

Present a concise table with these columns:

| Scene | Time | Key information | Glass composition | Motion and optical changes | Information revealed | Transition | Audio |
|---|---|---|---|---|---|---|---|

Describe real images and meaningful actions, not vague phrases. The full runtime must be accounted for.

## Rendered previews

Create an HTML Artifact showing real JavaScript-rendered scene previews. The previews must demonstrate actual refractive glass, meaningful background content that visibly bends through the lens, lighting, typography, and the intended information hierarchy.

Use modest thumbnail rendering resolution with an enlarged selected-scene view. Reuse the same rendering utilities in the full animation rather than creating an entirely unrelated storyboard renderer.

Do not build the complete animated sequence at this stage. Avoid extra editing interfaces, multiple alternate concepts, and unnecessary exports.

## Approval

Perform one brief check for missing content or obvious drawing errors. Show the scene table and visual preview Artifact. Then say:

**"Storyboard ready. Review the visual previews and reply APPROVED to generate the animation, or tell me what you'd like to change."**

Stop until the user approves. If revisions are requested, change the affected parts rather than regenerating everything.

---

# 11. FULL ANIMATION — IMMEDIATELY OR AFTER APPROVAL

When storyboard is disabled, start this stage immediately. When enabled, begin only after approval.

Produce the complete animated video as a playable HTML Artifact using the resolved configuration.

For an approved storyboard, preserve its art direction, major compositions, meaningful content, and intended transitions. Do not downgrade detailed designs to generic shapes merely because a simpler animation is easier to code.

## Motion and sequence

Implement the planned explanation through continuous, time-based glass deformation, connected transitions, purposeful camera motion, sharp editorial typography, and subject-specific information graphics.

Use coordinated overlapping animation throughout. Important optical changes should accompany meaningful information changes.

Keep background visual detail sufficient to demonstrate real refraction, without overwhelming the explanation.

If narration is disabled, the combination of visuals and on-screen text must stand on its own.

## Avoid the slideshow failure

Do not complete a static composition, hold it without development, fade it away, and repeat. Use changes of information, object states, refraction, movement, and visual focus within each main composition.

The output should demonstrate a premium animation style, not merely verify that transparent UI objects can move.

---

# 12. VOICEOVER AND SUBTITLES — CONDITIONAL

**When voiceover is disabled:** Do not fabricate a voice track, transcription, or speech timing. Use the configured fixed duration. Skip voiceover upload and narration controls. Follow the subtitle setting independently.

**When voiceover is enabled:**

- Use the attached recording as the timing authority.
- Determine its decoded duration; align the visual timeline to meaningful spoken phrases.
- Use the recording itself for preview and export; do not synthesize a replacement voice.
- Use the provided transcript as reference material only. If reliable speech recognition or forced alignment is unavailable, do not pretend to have precise word-level timestamps.
- If the attachment cannot be accessed in the Artifact, expose a straightforward file input so the user can load it.
- Synchronize seeking, pausing, restart, and export with the actual recording position.
- Do not truncate the audio or stretch playback to force a separate duration.

When subtitles are enabled, provide an SRT or equivalent timed captions with clear source-of-timing disclosure. Preserve accurate cue order and reasonable reading time. Let a supplied SRT replace provisional cues. Render subtitles into the recorded video only if on-screen captions are enabled; do not force them into the picture when disabled.

---

# 13. BACKGROUND MUSIC — CONDITIONAL

**Generate background music only when the configuration enables it.** Otherwise omit the music engine and its controls.

Create an original, tasteful electronic/cinematic music bed procedurally with the native Web Audio API. No downloaded commercial soundtrack, prerecorded loop, or externally generated music file is required.

Make the music genuinely musical rather than a continuous buzzing oscillator or random noise. Use a coherent key or tonal center, a restrained harmonic pattern, a gentle pulse, subtle movement, and a shape that fits the resolved duration.

Suitable synthesized ingredients include:

- Warm sustained pads
- Soft mallet or bell-like notes
- Light, restrained rhythmic pulses
- Delicate filtered textures
- Gentle bass support
- Subtle harmonic changes near meaningful transitions

Match the feel of the configured subject and visual direction, rather than using a single fixed tune for every topic.

Keep the music lively enough to support smooth visual pacing but never overpower the explanation.

If narration is present, mix the music well below the voice and use subtle ducking. If narration is absent, the music can have a clearer presence without becoming distracting.

Fade in and out inside the resolved runtime. Avoid abrupt cutoffs or a musical ending that runs beyond the visuals.

Generate music with reusable Web Audio scheduling and a controllable gain bus. Do not rebuild the entire audio engine for each animated shot.

---

# 14. SOUND EFFECTS — CONDITIONAL

**Generate sound effects only when the configuration enables them.** Otherwise omit the effects engine and controls.

Use procedural Web Audio synthesis to create understated, high-quality sounds matched to meaningful actions:

- A soft airy sweep as a refractive shape travels
- Delicate glass-like resonances during a merge or separation
- Restrained high-frequency glints when a lens catches light
- Brief low-impact tones when information settles into a new state
- Precise interface-style clicks for meaningful changes
- Smooth transition swells that support a major visual reveal

Select effects based on the actual animation. Do not trigger audio for every small movement or use loud cartoon effects.

Create effects using oscillators, filtered noise, envelopes, and sensible gain staging. Use subtle reverb-like tails or filtering only when performance permits.

Schedule all sound events against the same timeline as the animation. Seeking should not cause a burst of old effects. Pause/restart should reset pending events predictably.

Balance the effects against enabled music and narration. Route all enabled sources through a shared master mix without clipping or doubling audio.

---

# 15. PLAYBACK CONTROLS AND ARTIFACT PRESENTATION

Create a minimal, polished control interface surrounding the video canvas.

Include:

- Play / pause
- Restart
- Seekable timeline
- Current time and total resolved duration
- Export Video
- Background music toggle only when enabled
- Sound effects toggle only when enabled
- Voiceover loaded/ready and file picker only when enabled and necessary
- Narration volume only when enabled
- Subtitles toggle and SRT download only when enabled

Keep controls visually secondary to the actual video. Do not spend time building a video editor or an elaborate settings application.

Maintain the configured aspect ratio when the preview scales within the Artifact. The internal canvas or equivalent output target should retain the configured native resolution for export, even if the live preview uses a lower rendering scale.

The playhead must track the same resolved timeline that drives visual rendering and enabled audio.

---

# 16. VIDEO EXPORT

Include a functional Export Video button.

The recording must include the actual complete visual composition: refracted glass, underlying imagery, diagrams, typography, verified brand assets when applicable, and all enabled audio tracks.

Use a single composited video capture surface. **Do not render crucial text, glass layers, or graphics exclusively as uncaptured DOM overlays** that disappear from the exported video.

## Recording method

Use browser-supported mechanisms, including Canvas capture and `MediaRecorder` where available.

If WebGL produces the video, capture the actual composited renderer canvas or a reliable final compositing canvas. Avoid a separate preview-only overlay that never reaches the recording.

Where audio is enabled, connect the music, effects, and optional voiceover to a `MediaStreamAudioDestinationNode`. Combine its audio track with the captured video track. Prevent duplicate audio paths.

If all audio is disabled, export video-only.

Use the configured resolution, export frame rate, and resolved duration. Start from the beginning and end at the intended final time.

**The final video format is MP4.** The finished deliverable must be a real downloadable MP4 file containing the complete animation and every enabled audio track. Choose the simplest reliable browser route:

1. **Native recording:** Check `MediaRecorder.isTypeSupported()` for an MP4-compatible MIME type (for example `video/mp4` with H.264 video and AAC audio) and use it when the browser can actually record that format. Validate the resulting file, not merely the MIME string.
2. **Browser-side encoding and muxing:** If native MP4 recording is unavailable, use `WebCodecs` with a lightweight browser-compatible MP4 muxer (for example, Mediabunny) when its module can load and the encoders are supported. Prefer H.264 video and AAC audio. WebCodecs alone does not create an MP4 container, so do not skip the muxing step.
3. **Restricted-environment fallback:** If the Artifact blocks real MP4 encoding or downloading, provide the complete self-contained HTML with the same MP4 export route for a standard Chromium browser, and state the specific blocker. A clearly labeled WebM may be offered as a secondary fallback, but it must never be presented as the MP4.

Never rename a WebM file to `.mp4` or claim an MP4 exists until a valid file has been encoded. Provide a clear **Download Video** control with a truthful extension and MIME type.

Native browser recording may vary slightly in timestamps or drop frames under load. Don't claim frame-perfect encoding without checking.

## Fallback

If the Artifact environment blocks direct capture or downloading, expose the full HTML implementation for running in a standard Chromium browser. Clearly identify any external library dependency used by the HTML file.

Do not attempt a long sequence of speculative workarounds or turn the project into a separate video-rendering application.

---

# 17. LIGHTWEIGHT VERIFICATION

Keep checks practical. The purpose is a usable, visually ambitious animation, not an extended software-testing exercise.

When creating a storyboard, confirm the previews show the intended refractive effect and the information is legible. Fix obvious failures.

When creating the full animation, make one short functional pass:

1. Confirm the Artifact loads and the video plays.
2. Inspect a few representative timestamps, including at least one lens deformation or transition.
3. Check that the surface actually bends visible background content instead of merely blurring it.
4. Confirm key type, diagrams, and any required authentic assets appear in the final composited frame.
5. Confirm optional audio follows the configuration and is reasonably synchronized.
6. Confirm the export mechanism works where supported, or identify the actual restriction.

Correct broken rendering, empty frames, serious overlaps, glaring material artifacts, failed controls, and code errors.

Do not conduct exhaustive pixel comparisons, prolonged iterative visual polishing, repeated full-video exports, multiple alternative builds, or lengthy QA reports.

When the result is functional, informative, visually cohesive, and faithful to the selected style, deliver it for user review. Minor refinements can be requested later.

---

# 18. EXECUTION EFFICIENCY

Make creative decisions independently using the configuration. Avoid unnecessary clarifying questions, extensive preliminary planning, extra dependencies, multiple competing concepts, and unrelated features.

Do not spend effort building a large reusable design application. Build the requested animated explainer.

Reuse shaders, geometry, shape masks, rendering targets, typography utilities, and audio functions where practical. Keep source code clean enough for updates in the same Claude conversation.

Spend the available effort on the qualities viewers will notice most:

- Beautiful, visibly refractive glass
- Sophisticated, continuous morphing
- High-quality edge lighting and depth
- Seamless, controlled camera movement
- Strong typographic hierarchy
- Useful, animated explanatory information
- Meaningful transitions connecting the story
- Smooth real-time playback
- Sound that supports the animation
- A complete recorded output

Do not sacrifice those qualities merely to simplify the implementation. Equally, avoid spending excessive time on cosmetic effects with little perceptible benefit.

---

# 19. FINAL DELIVERY AND START

When storyboard is enabled, provide the scene table and rendered Artifact previews, then stop for explicit approval. After approval, generate the complete playable animation.

When storyboard is disabled, produce the complete playable HTML Artifact directly, without a storyboard or approval request.

For the completed animation, provide:

1. The playable Artifact.
2. Playback and seek controls.
3. Any audio enabled by the configuration.
4. A functional Export Video option producing a downloadable MP4 where the browser permits it.
5. Self-contained HTML or a clear fallback when Artifact restrictions prevent export.
6. Subtitle/SRT controls only when enabled.

Mention genuine technical limitations briefly. Do not report features as tested if you could not test them. Do not generate a long implementation report.

**START NOW.** Read the single configuration block and follow its storyboard setting. Use the selected topic to create an original, informative, visually striking liquid-glass explainer. Make the optical effects visibly refractive, the motion exceptionally smooth, and the finished composition fully recordable.
