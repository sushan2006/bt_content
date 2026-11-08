# TASK

Create a cinematic animated explainer about the configured topic, using sophisticated generative particle motion graphics.

Use JavaScript to produce an exceptionally smooth, visually impressive animation in which thousands of particles form recognizable objects, transform into information diagrams, move between components, and create seamless transitions.

Build the finished animation directly inside an interactive HTML Artifact in this Claude conversation.

When voiceover is enabled, use the supplied narration as the master source for the animation's content, pacing, scene changes, and duration.

Generate the complete animation directly when storyboard is disabled.

**If storyboard is enabled, create visual storyboard previews and wait for approval. Otherwise, proceed directly to the complete animation.**

The finished video must include:

- Cinematic particle animation
- Clear, informative visual explanations
- Authentic logos and product visuals, only where relevant to the topic
- Visuals synchronized to the narration when voiceover is enabled
- An SRT subtitle timeline when enabled
- The supplied voiceover when enabled
- Background music when enabled
- Procedurally generated sound effects when enabled
- Playback and video export controls

Prioritize exceptional visual quality, smooth motion, educational value, and efficient implementation.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Cinematic generative particles
{{AUDIO_SETTINGS}}

This is the single editable block. Interpret the topic as an open-ended brief and use these settings everywhere else; do not treat examples elsewhere as additional inputs.

# 2. CONFIGURATION BEHAVIOR

When narration is enabled, use the actual decoded audio duration as the master clock and timing source; when disabled, use the configured fixed duration. If storyboard is enabled, create a visual storyboard first and stop for approval; when disabled, go directly to the complete animation. Generate music, effects and subtitles only when their settings require them. Treat the reference transcript as optional guidance, not proof of exact speech alignment. Never fabricate a narration track. When storyboard is enabled, present a scene table of timing, educational content, compositions, motion, captions and sound plus an interactive contact sheet of actual JavaScript-rendered preview frames. Stop for approval before completing the animation; reuse approved artwork when continuing.

## Duration

**Use the audio duration when narration is enabled; otherwise use the fixed duration in the configuration.**

Do not assume that a recording matches the optional fixed duration.

If narration is enabled, read its actual decoded duration using the browser's audio metadata or Web Audio APIs.

Define:

`DURATION = voiceoverEnabled ? actualVoiceoverDuration : configuredDuration`

Use that duration for the complete animation timeline.

The final visual sequence, enabled audio tracks, and export must end with the resolved duration.

Do not add arbitrary opening or closing padding.

When narration is enabled, do not cut off the last spoken word.

Avoid introducing an extra static ending after the resolved duration.

Account for the practical timing precision of the selected video container and frame rate.

# 3. AUDIO INPUT AND TRANSCRIPTION

When narration is enabled, determine whether its attached MP3 is accessible through the conversation's available file capabilities. Otherwise skip the MP3-specific steps; if subtitles are enabled without narration, generate timed captions from the visual explanation without implying any words were spoken.

If accessible, load and analyze it.

If the attachment cannot be passed directly into the HTML Artifact, create a simple **Load Voiceover MP3** control inside the Artifact.

The user should be able to select the same MP3 from their computer.

Use the loaded audio file for playback, timeline duration, and export.

Do not attempt to bypass Artifact file-access restrictions or claim the audio was loaded when it was not.

The animation may be constructed using the supplied transcript before the MP3 is loaded, but its final duration and timing must be recalculated from the actual audio.

## Transcription and SRT generation

If subtitles are enabled with narration, create a subtitle timeline synchronized with the supplied voiceover. If enabled without narration, time the explanatory captions to the visual timeline. Skip subtitle generation only when subtitles are disabled.

Use actual speech recognition or audio-alignment capabilities if they are available in the current environment.

Use the reference transcript to establish spoken content when one is provided.

If reliable word-level or phrase-level alignment is available, use those timestamps to create the SRT.

If automatic alignment is unavailable and a transcript is provided, create provisional phrase-level cues using that text, detected pauses where possible, and the audio duration. Without a transcript, do not invent speech or timestamps; accept a supplied SRT or mark unverified alignment as unavailable.

Do not misrepresent estimated timestamps as verified word-level alignment.

Allow an existing SRT file to be uploaded as an optional way to obtain precise synchronization.

Do not require an SRT upload merely to create the animation.

Store subtitle cues as structured JavaScript data:

`{ start, end, text }`

Use these cues to coordinate the most important visual changes with the narration.

Provide an option to download the resulting `.srt` file.

## Narration-driven timeline

Divide the animation according to meaningful spoken phrases.

Each major piece of narration should have a corresponding visual development.

Avoid using equal-length scenes simply because they are easier to implement.

Align the most important particle transformations, information reveals, and comparison visuals with the relevant spoken words.

The viewer should see the idea being described at approximately the moment it is spoken.

Do not animate unrelated objects merely to fill time.

# 4. BRAND ASSETS AND REAL-WORLD VISUALS

If the configured topic references real companies or products, use authentic, verified assets when they are relevant. For topics without brands, create original subject-specific visuals.

**Preserve the true appearance of any actual logos or product visuals you include.**

Do not invent, approximate, redraw from memory, or replace their logos with generic AI symbols.

Research the actual brand assets before constructing the animation.

Prioritize:

1. Official product websites and downloadable brand assets
2. Assets from official company repositories
3. Established icon libraries whose assets can be checked against the official product appearance

Use the correct product identity.

Do not substitute the logo of an unrelated product or a company with a similar name.

Do not automatically assume that a company's general logo is identical to the specific product logo.

Preserve the authentic shape, colors, and proportions of each brand mark.

Brand marks may appear inside animated scenes, but do not stretch, distort, recolor, or morph the actual mark into an inaccurate shape.

Particle effects may assemble around a genuine logo, reveal it, dissolve into the surrounding environment, or create a luminous silhouette that reveals the original asset.

The real mark itself must remain recognizable and accurate.

## Asset loading

Retrieve suitable SVG or high-resolution PNG assets when permitted.

Ensure images can be safely drawn onto the final video Canvas without cross-origin restrictions.

Prefer locally embedded or safely loaded assets with preserved transparency.

If external SVGs are embedded, sanitize the markup rather than inserting untrusted scripts.

Verify that the assets actually appear in the exported recording, not merely in an HTML overlay.

If an authentic logo cannot be obtained automatically, provide a simple logo-upload control and identify the missing asset. Do not silently substitute a fabricated logo.

## General rule for other subjects

Whenever the creative brief mentions a real company, brand, product, tool, or recognizable branded interface, use authentic assets when they are important to the explanation.

For concepts that do not have official visual identities, create original procedural illustrations.

Do not introduce unofficial branding where none exists.

# 5. VISUAL DIRECTION

Create a premium cinematic technology aesthetic.

The animation should feel like a professionally produced motion graphics sequence, with dramatic dimensional particle forms, controlled lighting, sophisticated typography, and beautiful transformations.

Avoid the appearance of a generic particle screensaver.

## Palette

Use:

- Midnight navy: #080D1B
- Deep blue: #111C35
- Electric cyan: #44DCEB
- Soft violet: #9B78FF
- Cool blue: #648CFF
- Warm amber: #FFBD73
- Soft white: #F3F7FF

Use these colors for the particle environment, diagrams, transitions, and informational graphics.

Preserve original logo colors.

Use the surrounding colors to help distinguish the subjects and guide the viewer's attention.

Avoid excessive neon bloom, uncontrolled gradients, and constantly shifting rainbow effects.

## Particle appearance

Use a mixture of:

- Tiny luminous points
- Dense particle silhouettes
- Fine light trails
- Controlled particle streams
- Subtle glows
- Dimensional particle structures
- Delicate information connections
- Sparse atmospheric particles

Vary size, opacity, brightness, and depth to establish hierarchy.

Important particle structures should have sufficiently precise outlines to remain recognizable.

Avoid oversized glowing circles and blurry, indistinct shapes.

## Dimensional composition

Use perspective, parallax, depth-aware particle sizing, controlled camera movement, and soft lighting to create cinematic depth.

Foreground and background structures should feel spatially connected.

Use 3D motion where it helps the explanation.

Avoid constant camera movement that makes information difficult to read.

# 6. MOTION QUALITY

Smoothness is a primary requirement.

All particle movement, camera transitions, typography, and diagram changes must be fluid and coordinated.

Use continuous time-based animation.

Avoid stepped motion, random jitter, abrupt jumps, and visible resetting between scenes.

## Particle assembly

Particles should be able to:

- Assemble into recognizable objects
- Form accurate branded marks or surrounding reveal effects when relevant
- Transform into information diagrams
- Separate into meaningful groups
- Flow along connected paths
- Form subject-specific objects, environments, or workflow representations
- Reorganize into comparison layouts
- Merge into a clear final composition

Each transformation should communicate something meaningful.

## Particle morphing

Use coherent, smooth paths between particle structures.

Maintain stable particle identities when practical.

Avoid assigning completely unrelated random targets that create chaotic crossing paths.

Use easing, staggered timing, controlled attraction, and restrained local motion variation.

Preserve recognizable structure at key moments.

Transitions should feel like the same particle material continuously reorganizing itself.

## Visual pacing

The video should feel energetic and engaging without making the narration difficult to follow.

Create several meaningful visual developments throughout the animation.

Use overlapping movement:

- A particle structure assembles.
- A headline reveals.
- Information connections develop.
- A highlighted element changes.
- The structure begins transforming toward the following idea.

Avoid long static holds.

Use brief moments of stability when important information needs to be understood.

## Cinematic transitions

Favor:

- Particle dispersion and reassembly
- Smooth camera tracking
- Structural morphing
- Flowing information streams
- Depth-based reveals
- Diagrams transforming into dimensional objects
- Coordinated particle and typography movement

Avoid repetitive fades and disconnected scene changes.

# 7. EDUCATIONAL DIRECTION

The animation must be informative, not merely visually impressive.

Use the configured topic and any supplied narration to determine what viewers should learn.

For the configured topic, communicate:

- The main subjects or components being explained
- Their relevant capabilities, properties, or relationships
- How the underlying process or mechanism works
- Any meaningful differences, decisions, or consequences
- What viewers should understand or be able to evaluate afterward

Do not make unsupported claims about the relative performance or superiority of any subject, product, method, or option.

Avoid fabricated benchmark results, pricing, speed differences, or performance scores.

If actual statistics are used, they must come from verifiable sources and be represented accurately.

Use original visual comparisons, connected process diagrams, animated interfaces, and explanatory graphics.

The video should demonstrate the topic rather than merely display names, labels, or brand marks repeatedly.

## Composition

Integrate:

- Authentic product branding when relevant
- Particle-based objects
- Animated topic-relevant objects or interfaces
- Information-flow diagrams
- Clear explanatory or comparison graphics
- Short headlines and annotations
- Controlled visual highlights

Do not force every element into every shot.

Use visual variety while maintaining one consistent design identity.

## Typography

Use modern, crisp, readable typography.

Prefer short phrases that reinforce the explanation and, when present, the narration.

Use clear hierarchy and strong contrast.

Important words may be formed from particles, but small explanatory labels should remain sharp.

Avoid covering the main illustration with excessive text.

Subtitles, if shown, must remain visually separate from other text and inside safe margins.

# 8. CREATIVE EXECUTION

Create a continuous visual explanation rather than a sequence of unrelated slides.

Use the supplied narration to determine scene timing when available; otherwise pace the scenes across the configured fixed duration.

The animation should include visually distinct developments involving:

- The important subjects and recognizable visual identities, when applicable
- A concrete goal, problem, or mechanism that organizes the explanation
- The important actions, changes, or relationships
- How intermediate outcomes affect what follows
- A meaningful conclusion linked to the configured topic

These are content requirements, not fixed scene durations.

Choose the actual visual compositions and transformations independently.

Do not display a repetitive series of logos and text cards, regardless of topic.

Make use of particle sculptures, information structures, animated UI elements, procedural 3D representations, and meaningful movement.

Aim for a visually memorable opening, an informative middle, and a satisfying finish aligned with the final spoken phrase when narration is enabled, or with the resolved timeline otherwise.

# 9. TECHNICAL IMPLEMENTATION

Create the complete animation directly in a normal Claude HTML Artifact.

Prefer GPU-accelerated rendering where supported.

You may use:

- HTML and CSS
- JavaScript
- WebGL or WebGL2
- Three.js
- GLSL shaders
- Canvas 2D
- SVG
- Web Audio API
- Browser-compatible JavaScript libraries

Do not require an external coding environment, Remotion, Hyperframes, Claude Motion, `/motion`, a local development server, or package installation.

All main particle visuals and motion graphics should be generated programmatically.

When applicable, the attached narration, authentic brand assets, and necessary verified references are permitted external inputs.

## Particle engine

Prefer batched GPU particle rendering using Three.js point clouds, buffer geometry, and shaders where appropriate.

Avoid one DOM element or separate rendering object per particle.

Use shader-based transitions when they improve smoothness and rendering efficiency.

Generate particle target structures procedurally.

Use Canvas masks, SVG paths, mathematical geometry, and procedural sampling where appropriate.

Optimize particle density based on the visual complexity and available performance.

Preserve smooth playback before increasing particle count unnecessarily.

## Animation timing

Expose a deterministic rendering function equivalent to:

`renderAt(seconds)`

The visual state must be calculated from the supplied timestamp.

Particle positions, typography, diagrams, camera movement, and morphing should follow the resolved timeline, synchronized to narration when enabled.

Do not assume a duration different from the resolved duration.

Keep procedural randomness seeded and stable.

Avoid rebuilding particle buffers or textures unnecessarily.

Use `requestAnimationFrame()` for smooth preview playback.

## Performance

Cache geometry, textures, and reusable particle targets.

Avoid heavy per-frame JavaScript allocations.

Use shaders and batched rendering where they provide an advantage.

Reduce expensive glow effects or excessive particle counts before compromising the design.

Use lower preview resolution if needed for responsiveness while retaining full-resolution export.

## Complete video composition

The recorded video must include:

- Particle rendering
- Actual brand logos when relevant
- Typography
- Diagrams
- Narration when enabled
- Sound effects when enabled
- Background music when enabled
- Subtitles when enabled

Do not place crucial content in HTML overlays that are omitted from the video recording.

Use a Canvas/WebGL compositing solution that captures the complete intended frame.

# 10. VOICEOVER SYNCHRONIZATION

When voiceover is enabled, use the supplied audio as the master playback clock. Otherwise use a standard elapsed-time timeline based on the configured duration, and skip narration-specific handling below.

During playback, obtain the current time from the actual audio playback position.

Do not use a separate animation timer that gradually drifts away from the narration.

The visual rendering should follow the voiceover's current playback time.

Seeking should update the narration position and redraw the corresponding visual frame.

Pausing should pause the visuals and all enabled audio tracks.

Restarting should return all media to the beginning.

At the end of the resolved timeline, the visual animation should reach its final state and finish.

## Scene timing

Use the transcript and any available SRT alignment to identify the major phrases and their timing.

Synchronize important visual events to those phrases.

If precise alignment cannot be produced, use provisional phrase-level timing and preserve the narration itself as the playback clock.

Do not pretend approximate timings are exact.

Keep the subtitle cue data editable and allow a supplied SRT file to replace provisional cues.

# 11. BACKGROUND MUSIC

If background music is enabled, generate it as described below; otherwise omit it.

Create an original, understated cinematic electronic music bed that supports the animation and, when present, the narration.

Use JavaScript and the Web Audio API to synthesize the music.

Do not download copyrighted commercial music or imitate a specific recording.

The music should contain actual musical structure, not merely random noise.

Use a restrained combination of:

- Warm synthesized pads
- Soft harmonic movement
- Gentle rhythmic pulses
- Subtle electronic textures
- Controlled low-frequency support
- Light atmospheric accents

Choose a tempo and mood that complement the particle animation.

Avoid aggressive percussion, excessive bass, distracting melodies, or loud transitions.

The music should create energy without competing with the voiceover.

## Audio mixing

When narration is enabled, it must remain clearly audible.

When narration is present, keep the music significantly quieter than the voiceover during speech.

Use appropriate gain staging and gentle ducking.

Avoid clipping, distortion, and abrupt volume changes.

Fade music in and out naturally within the resolved duration.

When present, do not fade out or truncate the narration.

# 12. SOUND EFFECTS

If sound effects are enabled, generate them as described below; otherwise omit them.

Generate cinematic procedural effects using the Web Audio API.

Suitable effects include:

- Particle swells
- Gentle electronic pulses
- Soft information-transfer sounds
- Airy transitions
- Subtle digital clicks
- Controlled impacts
- Delicate confirmation tones

Synchronize effects with meaningful visible actions.

When narration is enabled, keep the effects quieter than the voiceover; otherwise balance their levels against any enabled music.

Do not add a sound effect to every small particle movement.

Use sound to reinforce important visual changes.

Route all enabled audio tracks through a shared audio-mixing structure.

Do not allow sound effects to continue after the video ends.

# 13. PLAYBACK INTERFACE

Create a simple, polished Artifact preview.

Include:

- Play / pause
- Restart
- Seekable timeline
- Current time and resolved duration
- Voiceover loaded/ready indicator when enabled
- Narration volume when enabled
- Music on/off when enabled
- Sound effects on/off when enabled
- Subtitles on/off when enabled
- Optional MP3 and SRT file inputs when required
- Export Video
- Download SRT when subtitles are enabled

The animation should remain the main focus.

Do not build a full video-editing application.

When voiceover is enabled and the MP3 cannot be accessed automatically, display the upload control clearly.

When voiceover is enabled, update the duration and timeline automatically after the MP3 loads.

# 14. VIDEO EXPORT

Provide a working Export Video button.

The exported video must contain the complete animation and all enabled audio tracks.

Target:

- Resolution: Configured native resolution
- Frame rate: Configured export rate
- Duration: Resolved duration
- Narration: Supplied audio only when enabled
- Music: Included only when enabled
- Sound effects: Included only when enabled
- Format: MP4 (the configured final video format)

## Recording

Use browser-supported recording APIs.

Capture the composited animation Canvas or WebGL output.

Create an audio graph that mixes:

- The supplied voiceover when enabled
- Synthesized background music when enabled
- Procedural sound effects when enabled

When at least one audio track is enabled, use a `MediaStreamAudioDestinationNode` to capture the combined audio; otherwise export video-only.

When narration is enabled, the original voiceover should enter the mix through an appropriate Web Audio source.

Ensure the narration is not accidentally doubled through separate audio playback paths.

Combine the Canvas video track with the mixed audio track when audio is enabled; otherwise record the Canvas video track alone.

**The final video format is MP4.** The finished deliverable must be a real downloadable MP4 file containing the complete animation and every enabled audio track. Choose the simplest reliable browser route:

1. **Native recording:** Check `MediaRecorder.isTypeSupported()` for an MP4-compatible MIME type (for example `video/mp4` with H.264 video and AAC audio) and use it when the browser can actually record that format. Validate the resulting file, not merely the MIME string.
2. **Browser-side encoding and muxing:** If native MP4 recording is unavailable, use `WebCodecs` with a lightweight browser-compatible MP4 muxer (for example, Mediabunny) when its module can load and the encoders are supported. Prefer H.264 video and AAC audio. WebCodecs alone does not create an MP4 container, so do not skip the muxing step.
3. **Restricted-environment fallback:** If the Artifact blocks real MP4 encoding or downloading, provide the complete self-contained HTML with the same MP4 export route for a standard Chromium browser, and state the specific blocker. A clearly labeled WebM may be offered as a secondary fallback, but it must never be presented as the MP4.

Never rename a WebM file to `.mp4` or claim an MP4 exists until a valid file has been encoded. Provide a clear **Download Video** control with a truthful extension and MIME type.

## Duration accuracy

Start the recording and playback from the beginning.

Use the resolved duration as the logical end of the animation.

Stop at the end of the recording, without arbitrary padding.

Keep the final visual composition present until the resolved end time; when narration is present, do not cut off its final samples.

Aim for the closest achievable match to the resolved duration within the precision of the selected frame rate and media container.

Do not claim sample-accurate output unless measured.

If the browser introduces encoder padding or small timestamp differences, report that limitation rather than misrepresenting the file duration.

## Export fallback

If the Claude Artifact sandbox restricts media recording or downloading, provide the complete HTML implementation for opening in a standard Chromium browser.

When voiceover is enabled, allow the user to load the MP3 there and use the same Export button.

Do not require a local development server or additional animation software.

Do not attempt repeated complicated workarounds for unavailable browser capabilities.

# 15. LIGHTWEIGHT VERIFICATION

Keep verification focused and efficient.

After generating the Artifact:

1. Confirm the animation renders and plays.
2. When the topic includes real brands, confirm authentic assets are used or identify any assets still requiring upload.
3. Confirm the runtime follows the voiceover when enabled, or the configured duration otherwise.
4. Check that representative visual developments correspond to the topic and narration when available.
5. Confirm that enabled audio tracks use the intended mix.
6. Check playback controls and video export where supported.

Correct major functional problems.

Do not run extended QA loops, repeated exports, exhaustive screenshot analysis, or excessive visual revisions.

Do not sacrifice visual quality merely to simplify the implementation.

If a technical capability cannot be verified inside the available Artifact environment, state the limitation briefly.

# 16. EXECUTION GUIDELINES

Create the finished animation directly.

Generate a storyboard and stop for approval only when that setting is enabled. If disabled, do not generate wireframes, approval checkpoints, or multiple competing concepts.

Make reasonable creative decisions independently.

Keep explanations short and prioritize producing the finished Artifact.

Use reusable code for particles, diagrams, typography, transitions, and audio.

Avoid unnecessary dependencies, repeated planning, and unrelated features.

Focus effort on the animation's most visible qualities:

- Exceptional smoothness
- Beautiful particle transformations
- Clear explanatory or comparison graphics
- Authentic branding when relevant
- Precise timeline-driven choreography, synchronized to narration when enabled
- Cinematic depth and lighting
- Readable typography
- Balanced audio
- Reliable playback

The result must look substantially more sophisticated than a basic JavaScript animation.

# 17. FINAL DELIVERY

Provide:

1. The finished playable HTML Artifact.
2. A video timeline synchronized with narration when enabled.
3. Authentic visual identities when real products or brands are relevant.
4. Background music and sound effects when enabled.
5. Functional playback and export controls, with a downloadable MP4.
6. An SRT download option when subtitles are enabled.
7. The self-contained HTML implementation when needed for external browser playback.

If any audio alignment is provisional, identify it accurately.

If a required asset cannot be accessed automatically, make the appropriate upload control available without fabricating a replacement.

Do not produce a lengthy implementation report.

## START NOW

Build the complete generative-particle explainer directly when storyboard is disabled; when storyboard is enabled, first create polished rendered previews and a scene table, then stop for approval before animating.

Use attached narration as the timing source when enabled. If the audio cannot be accessed inside the Artifact, provide a file input; when narration is disabled, use the configured fixed duration.

Use verified, authentic branding only when actual brands or products are relevant to the configured topic.

Generate the enabled music and sound effects in JavaScript.

Create a cinematic, exceptionally smooth animation with meaningful particle transformations and informative explanatory graphics.

**When storyboard is enabled, stop for approval before building the video. Otherwise, deliver the playable animation and export controls immediately.**
