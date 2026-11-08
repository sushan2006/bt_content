# TASK

Create an exceptionally polished animated explainer in a **cinematic isometric line-art** style, using the single project configuration below.

Build a continuous visual system in which intricate, recognizable structures draw themselves into existence, components assemble with precision, mechanisms operate, information and materials travel along visible paths, and the composition transforms seamlessly into the following explanation. The result should feel like premium editorial engineering animation: precise, fluid, dimensional, and genuinely informative.

Generate the animation with JavaScript as a playable **HTML Artifact directly inside this Claude conversation**. Favor detailed line geometry, believable mechanical choreography, beautiful isometric composition, clean typography, and carefully controlled pacing—not a collection of static diagrams or basic wireframe cubes.

Read the storyboard configuration to decide whether to show actual rendered previews for approval or proceed directly to the final animation. The finished production must prioritize **a genuine downloadable video in the configured output format**, including all enabled audio and every visible layer.

Do not require Remotion, Hyperframes, Claude Motion, `/motion`, AI video generators, local installation, or a development server. Keep the creative work original and specific to the configured subject; do not reproduce any existing animation template or another creator's example.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Cinematic isometric line-art / animated technical infographic
{{AUDIO_SETTINGS}}

**This is the only editable project-input section.** Treat these values as the single source of truth for content, timing, stage selection, assets, audio, and delivery. All subject-specific illustrations, on-screen labels, diagrams, and factual statements must be derived from this topic and any provided narration—not from assumed examples elsewhere in the prompt.

The topic field is free text. A future user may enter a short sentence, a long paragraph, a comparison, or an educational question. Do not hardcode the subject, a particular type of machine, an industry, a brand, a setting, a fixed script, or a predetermined scene sequence anywhere outside this section.

---

# 2. CONFIGURATION BEHAVIOR

Read the project configuration before creating content. Resolve what needs to be generated based on the selected topic, storyboard mode, voiceover mode, output format, resolution, runtime, and optional features.

## Storyboard behavior

- **If storyboard is enabled:** Produce an informative scene table and an HTML Artifact containing actual rendered preview frames. Stop and request approval. Create the animation and final video only after explicit approval.
- **If storyboard is disabled:** Do not show a storyboard, stop for approval, create planning documents, or provide multiple concept options. Plan the narrative and visual choreography internally and generate the finished animation directly.

The selected workflow must not lower the sophistication or educational value of the animation. Storyboard mode changes the approval process, not the quality target.

## Voiceover, subtitles, and duration

- **If voiceover is enabled:** The uploaded recording determines the logical duration and is the master playback clock. Read its actual decoded duration. If the attachment cannot be accessed in the Artifact, provide a clear audio-file input. A supplied transcript or SRT can help align explanation beats; estimate phrase timing only when actual alignment is unavailable, and identify estimates as such. Never truncate, retime, or synthesize replacement narration to fit a separate fixed length.
- **If voiceover is disabled:** Use the configured fixed duration. Communicate the complete explanation through the graphics, camera moves, annotations, and short readable text. Do not invent spoken narration.
- **If subtitles are enabled:** Generate synchronized subtitle cues and offer the configured display and SRT download behavior. If no voiceover exists, use timed explanatory captions rather than fabricating speech.
- **If subtitles are disabled:** Do not add subtitle-generation work. Ordinary editorial labels and headings may still appear when they help the explanation.

All scene timings, camera animation, audio scheduling, progress indicators, and export logic must follow the resolved duration. Do not hardcode an alternate runtime in application code.

## Optional audio and real-world identity

- **Music:** Create and mix a background track only if enabled. If disabled, omit the track and related controls.
- **Sound effects:** Create and mix effects only if enabled. If disabled, omit effect generation and related controls.
- **Real brands, products, or recognizable interfaces:** Where actually relevant, obtain authentic product logos or official visual assets, use accurate features and approved brand colors, and preserve each brand mark's shape and proportions. Use the mark as an asset; do not fabricate, recolor, or transform it into a false logo. If a reliable asset cannot be accessed, provide a simple asset-upload control or state the limitation. Do not add unrelated branding to generic topics.

Do not copy any input value from this configuration into a contradictory instruction later in this prompt.

---

# 3. CREATIVE QUALITY STANDARD

The finished video must be impressive enough to demonstrate the potential of code-generated motion graphics while clearly teaching the selected subject.

## Three outcomes that must coexist

**Outstanding visual design:** Intricate isometric compositions, carefully calibrated stroke weights, controlled color accents, beautiful spatial organization, and distinguishable levels of detail. It should feel authored by a skilled motion designer.

**Exceptionally fluid movement:** Continuous animation with precise line construction, coordinated machinery or process movement, smooth camera choreography, and transitions that grow naturally from earlier visuals. No jerky assembly, random rotating cubes, repetitive pop-ins, or inert diagram slides.

**Real educational value:** Explain what happens, why, and how the pieces relate. Use the actual mechanism, sequence, comparison, or cause-and-effect chain implied by the selected topic. Teach through changing geometry and information, not a string of generic labels.

Avoid an abstract wireframe showreel that looks sophisticated but communicates little. Avoid overly simple diagrams presented with long holds and no meaningful state changes.

## Information density

Aim for several specific learning points communicated through a connected sequence. For a brief runtime, use approximately 12–18 meaningful visual beats scaled to the actual resolved length, rather than imposing a fixed quota. A beat introduces information, reveals an internal mechanism, changes a state, passes something between components, compares alternatives, or clarifies a relationship.

Use micro-actions and overlapping motion to explain multiple connected details without crowding the frame. Reserve enough time to read the important short labels.

Do not invent numerical statistics, industry benchmarks, prices, capabilities, or technical claims. If facts are time-sensitive or uncertain, check reliable sources if available; otherwise use a defensible explanation or mark schematic data as illustrative.

## Explain through a concrete visual process

Translate the configured subject into objects, components, interactions, and relationships that the viewer can recognize. Show inputs, transformations, decisions, dependencies, motion, and results where applicable.

Vary how information is represented: an assembled spatial system, an exploded view, an internal cutaway, a route map, a close-up mechanism, a state change, a before/after comparison, or a connected diagram. Select only forms that make sense for the subject.

Make the story engaging from the opening seconds; do not waste a significant portion on an empty title card. End on a clear visual takeaway or completed relationship rather than a generic logo-free flourish.

---

# 4. VISUAL DIRECTION — CINEMATIC ISOMETRIC LINE-ART

Use an original visual language that combines isometric architectural illustration, technical line drawings, intricate object assembly, and modern editorial infographics.

The artwork should appear precise and dimensional without becoming photorealistic 3D, heavy solid-shaded rendering, or a CAD interface screenshot. The drawn lines carry the visual identity.

## Art direction and palette

Suggested palette:

- Deep blue-black: `#0C1726`
- Dark slate: `#1A2A3A`
- Pale ivory: `#F6F5EF`
- Soft cool-gray lines: `#A8B8C6`
- Electric turquoise: `#38D8D2`
- Warm orange: `#FFAF65`
- Ultramarine: `#648CFF`
- Fresh mint highlight: `#A8F2D2`

Use a coherent subset and adjust for the actual subject. A light-paper background with dark lines or a dark technical-canvas background with luminous lines can work, but choose intentionally. Do not alternate lighting or colors at random.

Reserve strong accent colors for active paths, selected components, significant process events, and important labels. Resting structures should be quiet enough that motion and explanation remain obvious.

Favor sophisticated clean strokes over excessive glow, noisy textures, glass-like reflections, or thick cartoon outlines. Some subtle plane tinting or translucent fills may aid legibility, but line-art remains dominant.

## Isometric geometry

Use a consistent orthographic or carefully simulated isometric camera for the primary illustration system. Equal-sized objects at different depths should retain consistent apparent scale under orthographic projection.

Maintain stable axis relationships and visual proportions. Use a conventional isometric orientation or an equally coherent axonometric scheme; avoid changes of perspective that make the illustrated world appear to bend or collapse.

Objects should possess meaningful height, width, depth, and believable relative positioning. Build actual recognizable structures—not only stacked wireframe boxes.

When presenting a detail view, reframe within the consistent spatial system. A close-up or exploded diagram may move parts along their axes, but it should still clearly belong to the same object.

## Line hierarchy

Use intentional stroke levels:

- **Primary silhouette:** Strong, crisp outlines that make objects recognizable at thumbnail size.
- **Structural edges:** Medium-weight lines showing divisions, panels, openings, joints, and connected parts.
- **Fine detailing:** Thin lines for measurements, internal geometry, patterns, joints, and annotations.
- **Active signals:** Colored or luminous traces that indicate motion, information, direction, change, or emphasis.
- **Construction guides:** Optional faint drafting geometry for a brief assembly moment; remove or subdue it when the final object takes shape.

Do not use the same stroke thickness and opacity everywhere. Avoid detailed thin lines fighting with typography or becoming invisible in the video.

## Recognizable objects

Construct meaningful subject-specific structures with identifying details: panel divisions, structural components, openings, frames, surfaces, connectors, moving parts, and attachments as appropriate to the topic.

An object should be identifiable before the viewer reads its label. Distinct objects should differ by silhouette, internal structure, proportions, and spatial arrangement—not solely by color.

Keep purely decorative geometry restrained. Every prominent structure should contribute to the explanation or to a purposeful transition.

## Hidden edges and occlusion

Respect front-to-back ordering. Avoid a tangled see-through wireframe in which hidden back faces compete with visible edges.

Use occlusion, selective hidden-line removal, or subtle face fills to keep complex objects readable. Reveal internal or normally hidden parts only as a deliberate cutaway or X-ray moment, with a visual cue that the representation has changed.

Overlaps must be intentional and spatially consistent. Paths crossing on screen should not become misleading connections between unrelated systems.

## Technical accents

Use restrained engineering or infographic features when useful:

- Exploded views
- Dimension rules
- Callout leaders
- Small numbered markers
- Direction arrows
- Section or cutaway highlights
- Highlighted routes
- Layered floor plans
- Connection points
- Simple indicators of state or flow

These should serve the subject, not create visual clutter. The project should feel like beautifully animated information design, not a busy schematic full of illegible labels.

---

# 5. LINE CONSTRUCTION AND ANIMATION VOCABULARY

The animation must exploit the fact that geometry is being created and controlled by code.

## Progressive line drawing

Lines should draw themselves with controlled timing and direction. Favor coherent construction order:

- Establish principal axes or silhouette.
- Trace structural edges and key panels.
- Assemble internal details.
- Reveal interfaces, connectors, or internal systems.
- Introduce accent highlights that show action or relationships.

Line revelation should not resemble a random scribble. Control the stroke reveal by each path's arc length or an equivalent segment-reveal method, not a hardcoded uniform mask that produces unnatural speeds across short and long paths.

Use ease and staging. Do not make every stroke appear simultaneously or animate every detail at the same rate.

## Assembly and disassembly

Make objects build from meaningful separate components. Panels, supports, wheels, joints, layers, labels, modules, or other parts should slide, rotate, lift, and lock into a complete system when appropriate.

Components should move along clear paths, with compatible origin points and believable final alignment. Use tiny settle motions for weight and precision; avoid cartoon bouncing.

Where useful, reverse assembly to reveal dependencies or show how a structure works internally.

## Exploded and cutaway diagrams

Use controlled separation of parts to clarify internal mechanisms, layers, or stages.

Hold the relationship between components using subtle guide lines or alignment marks. The viewer should understand where each piece belongs.

Return parts to a complete object when the explanation calls for it, or transform the exploded structure into the next connected diagram.

## Moving flows and state changes

Animate travel or change through geometry with clear visual language:

- Moving dots or packets along drawn paths
- A highlight traveling through a connection
- Directional line pulses
- State indicators changing color or fill
- A mechanism advancing from one position to another
- Data, energy, material, or other subject-appropriate entities moving through a network
- A pathway splitting or joining when the process truly branches

Show the source, path, destination, and consequence of flow. Avoid random colored signals disconnected from the explanation.

## Mechanism animation

When a structure contains moving parts, animate them with coherent pivot points and relative movement. Links must remain connected, openings should correspond to the motion, and parts should not interpenetrate impossibly.

Use coordinated motion to show cause and effect. When one component activates another, synchronize their animations so the sequence communicates that relationship.

For an abstract subject, create a clear diagrammatic equivalent rather than forcing a physical machine into an unrelated topic.

## Morphing and transition between structures

Whenever practical, repurpose the previous scene's geometry or guide paths to build the following one.

A line can extend into a network, a structural edge can become a route, or separate components can reorganize into a new system when the conceptual relationship supports it.

Do not simply crossfade the whole image to a completely unrelated drawing at every scene boundary.

If a direct morph would make the subject difficult to understand, use an intentional pan, reveal, or connected object handoff instead.

---

# 6. MOTION DIRECTION — BUTTERY SMOOTH, CONNECTED, PURPOSEFUL

The piece must look fluid from beginning to end. The isometric line-art style should not be used as an excuse for stiff or slow animation.

## Choreography

Animate several related elements in coordinated layers. A structural silhouette might draw as a camera move begins, followed by internal details, an active path, and a short headline. The next visual can begin developing before the previous one has fully exited.

Use sensible staging and overlap. Group dependent actions. Reserve simultaneous movement for moments when the relationship is meaningful, not just for decoration.

Use physically plausible easing and controlled overshoot only where justified. Avoid sudden jumps, linear slides, stop-motion updates, and repetitive entrance presets.

## Pacing

Use the resolved duration to choose the number and length of major compositions. Each should contain meaningful sub-actions. Avoid the pattern of one object drawing in, staying still for several seconds, and disappearing.

Support rapid, readable changes while making the important information understandable at normal playback size.

A dramatic reveal can last only part of a scene. Follow it with a state change, moving pathway, close-up, callout, or transformation that teaches something new.

## Continuous spatial storytelling

Prefer one coherent isometric world or a succession of connected spaces rather than unrelated diagrams on blank backgrounds.

Use tracked motion to follow a subject, connection, object, or piece of information from one place to another. Build bridges between compositions through actual connecting edges, camera framing, or the transformation of shared objects.

Avoid large resets that break immersion or make the viewer reconstruct the relationships from scratch.

## Camera movement

Favor a consistent orthographic camera with smoothly animated position and zoom. Pan, track along a route, push into a mechanism, pull back to reveal a whole system, and reframe the composition as needed.

Keep the orientation substantially stable while moving. If a rotation is essential, use it sparingly and ensure the movement does not undermine the isometric visual language or spatial understanding.

Do not continuously orbit around objects as if showing a generic 3D demo. Every camera move should reveal meaningful new information or connect parts of the explanation.

## Transitions

Build transitions from the drawings themselves:

- A pathway extends beyond the current composition, and the camera follows it.
- A component unfolds into a new diagram.
- An architectural structure separates to reveal a process.
- The camera pulls back to show a network or system.
- A selected object is tracked as it moves into the following scene.
- Existing guide lines redraw into the next composition.

Avoid repeated fades, hard scene resets, generic wipes, and jarring perspective changes.

---

# 7. INFOGRAPHIC DESIGN AND EXPLANATORY DEPTH

The animation must contain enough substance to make someone understand the subject more clearly than before watching.

## Translate words into mechanisms

For each key idea, determine what can be shown visibly: a moving object, a change in state, a decision, a constraint, a transfer, an assembly, a calculation, a comparison, or a finished result.

Prefer specific depicted mechanisms to generic symbols. Let the viewer see why one action leads to another.

If showing a multi-step process, make relationships and dependencies visible rather than simply listing steps as isolated cards.

## Information hierarchy

Compose each beat using a hierarchy appropriate to the selected topic:

1. A dominant isometric visual showing the action or relationship.
2. A concise title or key phrase.
3. Supporting annotations, labels, quantities, or arrows only where helpful.

Use typography as a partner to the line illustrations, not as an afterthought or a substitute for them.

## Clear states and meaningful color

Use different line colors, fills, badges, and highlight behavior to distinguish resting, active, completed, delayed, or rejected states where relevant to the story.

Make state changes visually observable. Do not rely on changing a tiny label alone.

For numerical data, use clear axes, scales, labels, and units where needed. All numbers should be correct or explicitly marked illustrative.

## Legible motion

Avoid cluttered edge intersections, tiny labels, too many active traces at once, and moving the camera faster than the viewer can interpret the relationship.

Maintain safe margins and appropriate contrast for the configured format. Major objects and text should remain identifiable at a reduced playback size.

## Subject-aware detail

Use the topic's actual materials, components, procedures, or relationships. Do not replace an unfamiliar subject with a vague network of boxes when a recognizable illustration or diagram is possible.

The same renderer must be capable of explaining physical systems, digital processes, abstract concepts, comparisons, and educational mechanisms through tailored spatial illustration.

---

# 8. TECHNICAL IMPLEMENTATION — REAL ISOMETRIC GEOMETRY

Use JavaScript and browser-supported graphics technologies directly inside a normal Claude HTML Artifact.

You may use:

- JavaScript, HTML, and CSS
- Three.js with WebGL when supported
- An orthographic camera and procedural three-dimensional geometry
- SVG for precise technical paths and labels
- Canvas 2D when useful for composition or fallback
- Native browser animation APIs
- Browser-compatible animation utilities where they offer a clear benefit
- Web Audio API for enabled sound
- WebCodecs and a compatible media muxer for final export where supported

Avoid heavy frameworks, local package installations, or a setup that only works in a coding terminal. Use a library only if it can actually load and run in the Artifact environment.

## Consistent camera and projection

Prefer `THREE.OrthographicCamera` or an equivalent fixed isometric projection for the main illustration system.

Maintain consistent world axes, camera framing, and object scale. Use scene groups and sensible origin points so components animate around meaningful pivots.

Make the system responsive to the configured aspect ratio without distorting proportions or cutting off key elements.

## Lines and geometry

Use actual spatial geometry where it improves object construction and occlusion. A Three.js scene can combine `BufferGeometry`, `LineSegments`, `Line2`, `LineGeometry`, `LineMaterial`, and sparse face meshes as appropriate to the required appearance and browser support.

For crisp thicker lines in WebGL, prefer a tested wide-line method rather than assuming all browsers support arbitrary `gl.lineWidth`. If using `LineMaterial`, manage its viewport resolution correctly.

Implement progressive path revelation with partial-path geometries, shader attributes, dash offsets where supported, or equivalent techniques that can represent a controlled fraction of a stroke.

Avoid reconstructing thousands of vertices unnecessarily every animation frame.

## Occlusion and clean contours

Make visible surfaces block hidden rear edges where appropriate. Use careful depth testing, hidden-line approaches, layer ordering, or subtle same-background face fills.

If generating outlines from meshes, avoid relying on an unfiltered edge extraction that exposes every triangle or triangulation artifact. Preserve the intended silhouette and meaningful structural edges.

Use correct draw order for translucent fills, accents, and labels so connections are understandable.

## Procedural isometric illustrations

Build recognizable objects using reusable geometric functions for beams, panels, boxes, cylinders, frames, openings, connectors, paths, platforms, and components relevant to the topic.

Group parts into semantically meaningful objects. Animate each component's transformation or state without breaking the integrity of the larger structure.

Generate more intricate structures by composing simple primitives carefully, not by showing primitive scaffolds as finished illustration.

Create original source code and original scene compositions. Do not reproduce someone else's animation source or a proprietary template.

## Reusable motion engine

Provide utilities for:

- Time-based easing
- Path-length reveals
- Line-trace progression
- Hierarchical component transforms
- Pivot-based mechanism movement
- Animated routes and signal flow
- Color/state transitions
- Camera position and zoom
- Exploded-view separation and reassembly
- Typographic callouts and annotations
- Coordinated transitions between compositions

The required visual narrative should determine which utilities are implemented. Do not add a large library of unused effects.

---

# 9. RENDERING ARCHITECTURE AND PERFORMANCE

## Deterministic time-based rendering

Implement the visual equivalent of `renderAt(seconds)`.

At any supplied timestamp, the application must reproduce the correct camera framing, line-reveal progress, object transforms, animated flows, labels, scene visibility, and transitions without depending on which frame was rendered before it.

Use `requestAnimationFrame()` for preview playback and an elapsed-time clock rather than counting frames. Animation speed must remain consistent across hardware and refresh rates.

Avoid using `Date.now()`, frame accumulation, or fresh random values to control geometry in ways that cause seeking errors or animation flicker.

## Performance priorities

Cache static geometry, paths, materials, and text wherever reasonable. Batch many small line elements when practical. Avoid rebuilding complex structures, SVG paths, meshes, or buffers in every frame.

If rendering slows down, optimize draw calls, unnecessary labels, path updates, overdraw, and resolution before stripping away the detailed art direction.

Use lower preview pixel density if necessary for smooth interaction. Preserve the requested native export resolution.

A smooth, detailed illustration is better than an enormous collection of lines that visibly stutters.

## Rendering fidelity

Use anti-aliased, crisp lines. Maintain consistent stroke weights despite zoom changes as much as the chosen rendering technique allows.

Handle hidden surfaces, silhouettes, geometry intersections, and label placement carefully. Avoid z-fighting, flickering edges, clipped geometry, and illegible micro-details.

Keep accent trails and glows restrained enough to preserve the line-art aesthetic.

## Single captured composition

Everything needed to understand the final video—3D/2D illustrations, labels, authentic brand elements where relevant, lines, fills, indicators, diagrams, and any subtitles intended to be burned in—must appear in the surface captured by the video exporter.

If typography or UI elements are rendered in HTML for preview, composite them into the recording surface or use a compatible unified SVG/Canvas/WebGL rendering strategy for export.

Never promise a complete video while leaving important visible text outside the captured surface.

## Artifact resilience

Work within the actual capabilities of the normal Claude Artifact environment. If external module loading is blocked, use a browser-compatible fallback instead of retrying indefinitely.

Keep the implementation easy to open, preview, adjust, and export, with no required local build tools.

---

# 10. STAGE 1 — STORYBOARD ONLY WHEN ENABLED

Perform this stage **only** if the configuration enables storyboard approval.

## Define the visual story

Find the essential educational ideas in the topic and map them into connected isometric compositions.

Choose major camera positions, recognizable structures, meaningful mechanical or informational actions, and the transitions between them. Each composition must have several meaningful beats rather than a static diagram.

Use a suitable number of compositions for the resolved runtime. Do not impose a fixed scene count when narration or duration changes.

## Scene table

Present a concise but detailed table with columns:

| Scene | Time | Key information | Isometric composition | Line-draw and motion beats | Camera / transition | On-screen text | Audio |
|---|---|---|---|---|---|---|---|

Describe exactly which structures and connections appear, how they move or assemble, what changes visually, and what the viewer learns.

## Actual rendered previews

Create an interactive HTML Artifact showing real isometric line-art preview frames, not text-only placeholders, generic wireframe cubes, ASCII drawings, or borrowed images.

Use the same object definitions, camera scheme, line rendering style, palette, and layout intended for the finished animation.

Provide a contact sheet, timestamps, scene selection, and a larger preview of the selected composition. Render thumbnails at a moderate resolution while preserving the final design coordinate system.

The previews should be polished representations of the intended art direction, including recognizable structures, spatial depth, stroke hierarchy, meaningful highlights, text, and diagram relationships.

Do not animate and export the entire video at storyboard stage. Do not build an elaborate storyboard editing app.

## Stop for approval

Briefly check that the previews load, main objects are recognizable, and text is visible.

Present the scene table and preview Artifact, then stop and ask for approval or requested changes. Do not proceed to the final animation until approval is explicit.

When changes are requested, update the affected compositions without discarding the entire design unnecessarily.

---

# 11. FULL ANIMATION — DIRECTLY OR AFTER APPROVAL

If storyboard is disabled, build the finished animation immediately. If storyboard is enabled, begin this stage only after approval.

## Build the piece

Implement the complete educational sequence in a playable HTML Artifact using the selected isometric rendering method.

Animate the full choreography: progressive line construction, recognizable object assembly, meaningful internal motion, route and state changes, callouts, camera tracking, dimensional cutaways, and connected transitions.

Use the selected topic and resolved runtime to decide the actual scenes and beats. Preserve approved storyboard decisions where approval was required.

Do not reduce intricate approved geometry into a generic icon to save effort. For difficult constructions, use a practical visually comparable implementation with the same educational purpose.

## Keep motion continuous

Make compositions develop throughout their active period. Avoid long holds, generic slides, disconnected object demonstrations, and repeated fades.

Ensure the line-art system appears intentionally choreographed rather than randomly generated. Every major motion should direct attention, show a relationship, or reveal information.

## Playback interface

Provide functional, unobtrusive controls for:

- Play / pause
- Restart
- Seekable timeline
- Current time and resolved total duration
- Enabled audio controls only
- Subtitles and transcript controls only when enabled
- Export Video
- Download Video when actual output is available

If an audio attachment is required but inaccessible, include a clear local upload input. Fit the preview to the Artifact without distorting the configured aspect ratio.

Do not create a full timeline editor, a separate design application, or unrelated controls.

---

# 12. VOICEOVER AND SUBTITLES — CONDITIONAL

Apply this section only when the relevant options are enabled.

## Narration handling

When narration is enabled, use the supplied audio as the master timing authority. Load or decode its actual duration and synchronize the entire sequence to it.

If Claude chat provides no usable attachment access inside the Artifact, offer a local audio-file input and bind the animation to that source once loaded.

Audio playback, seeking, pause, resume, and restart must synchronize with the visual state. Do not run an independent animation timer that drifts away from the narration.

Use an optional transcript or provided SRT to identify phrase boundaries where possible. Generate actual aligned word or phrase timings only when suitable transcription/alignment tools are available. Otherwise be transparent that the timestamps are estimated.

Do not infer a perfect transcript merely from waveform analysis. Do not generate a synthetic replacement narrator when an audio recording is supplied.

## Subtitle behavior

Generate subtitles and an SRT download only when enabled.

When narration exists, base subtitle text on reliable spoken words and use available alignment. When it does not, timed captions should be written as editorial explanation, not fabricated quotations of speech.

Keep captions readable and away from critical diagram labels. If subtitles must be visible in the video, render them onto the captured composition rather than as an export-invisible DOM overlay.

---

# 13. BACKGROUND MUSIC — CONDITIONAL

Generate music only when enabled in the project configuration.

Create an original, tasteful electronic or minimal instrumental bed procedurally using Web Audio. Choose the musical character to suit the subject and visual identity rather than reusing identical audio for every topic.

Prefer clear harmonic structure and a restrained pulse that supports the progression of the isometric drawings. The rhythm can reinforce line tracing, object assembly, and changes in the diagram.

Useful elements may include:

- Warm, subtle synthesizer chords
- Light percussive pulses
- Short melodic motifs
- Understated bass foundation
- Occasional harmonic lifts at important reveals
- Delicate rhythmic textures

The output must sound composed rather than being a random succession of oscillators. Do not download a copyrighted recording or imitate a specific commercial track.

Synchronize the introduction, musical changes, and final fade to the resolved runtime. Avoid an abrupt cut at the end.

When narration is enabled, keep music substantially below the voice and duck gently during speech. Without narration, allow the music to provide more of the rhythm and atmosphere, without drowning out meaningful visual sound effects.

Avoid generating excessive audio nodes during individual frames; schedule events against the media clock.

---

# 14. SOUND EFFECTS — CONDITIONAL

Generate procedural sound effects only when enabled.

Use nuanced sounds that reinforce the spatial and structural motion rather than crude arcade effects:

- Fine tracing or short electronic ticks as significant paths finish drawing
- Soft clicks when components attach or lock
- Gentle swishes for camera and object transitions
- Mechanical or material-like movement accents where appropriate
- Subtle pulses traveling along connections
- Clean confirmations for important state changes
- Low, controlled impacts when a larger structure settles

Create the effects through Web Audio oscillators, filtered noise, envelopes, and careful gain staging. Choose a sound language that fits the actual subject; do not force mechanical noises into topics where they are inappropriate.

Use meaningful event timestamps, not audio triggers inside every render call. Seeking must not fire all past sounds. Replaying the video should not accumulate duplicate audio sources.

Mix enabled effects with music and optional narration in a shared audio graph. Avoid clipping, exaggerated volume, or repeated identical accents every fraction of a second.

Every enabled track must be included in the recorded output.

---

# 15. FINAL VIDEO EXPORT — DOWNLOADABLE MP4 PRIORITY

**The final deliverable must be a real downloadable video in the configured output format, with every enabled audio track.** Providing only the HTML Artifact or a preview of moving lines is not enough.

Never rename a WebM recording to `.mp4` or claim to have generated an MP4 unless a valid MP4 file with compatible codecs was actually created.

## Capture the full visual result

The recording must include all isometric geometry, construction lines, surface accents, callouts, text, arrows, authentic brand assets where applicable, and intended subtitles.

Use the configured resolution, export frame rate, and actual resolved duration. Start from the initial visual state and finish at the intended endpoint.

Combine enabled audio tracks through Web Audio and a `MediaStreamAudioDestinationNode` when suitable. Include narration if enabled. Export video-only if all audio options are disabled.

Do not leave important labels or diagram elements in a DOM overlay that disappears from the saved video.

## MP4 route

Choose the simplest reliable browser-supported approach for the configured format:

1. **Direct recording:** Check actual support with `MediaRecorder.isTypeSupported()` and use native MP4 recording when the necessary codec/container combination works in the browser. Validate the resulting file, not merely the MIME string.
2. **Browser-side encoding and muxing:** If direct MP4 recording is unavailable, use `WebCodecs` with a compatible JavaScript muxer (for example, Mediabunny) when its module can load and the relevant encoders are supported. Prefer H.264 video and AAC audio when practical. Create an actual MP4 container. WebCodecs alone does not mux MP4 files, so do not skip that stage.
3. **Graceful restricted-environment fallback:** If the Claude Artifact prevents required encoding or download APIs, provide the complete standalone HTML implementation with a working compatible-browser export route, and describe the specific blocker. An explicitly labeled alternative-format recording may also be offered, but it does not count as a successful MP4 delivery.

Do not introduce a heavyweight local toolchain or repeatedly attempt unsupported libraries. Use one lightweight media dependency if necessary and available.

## Video quality and timing

Prefer controlled frame evaluation for browser-side encoding where feasible. If real-time capture is necessary, target the requested frame rate and acknowledge possible dropped frames or small duration differences under load.

For enabled narration, match the video's logical duration to the uploaded audio as closely as the container and frame timing allow, with no arbitrary additional opening or ending. Do not claim sample-accurate alignment without measurement.

For music and effects, ensure the final mix is present and synchronized. A silent MP4 when audio was enabled is a failed output.

Create a clear **Download Video** control for the actual result, with a truthful extension and MIME type.

---

# 16. LIGHTWEIGHT VERIFICATION

Perform short, practical checks only. Prioritize creative quality over extensive debugging reports.

If storyboard is enabled, confirm the visual previews render, the core structures are recognizable, and no critical labels are clipped.

For the complete animation, check:

1. The Artifact loads and plays at normal speed.
2. A few representative frames show recognizable structures with clean contours.
3. One important assembly, route animation, or mechanism works smoothly.
4. The camera moves and transitions without jarring resets, missing geometry, or blank frames.
5. Enabled music, effects, and narration appear in playback and recording as intended.
6. A genuine downloadable file is available in the configured format where technically possible, or the specific limitation is identified.

Fix major functional failures, severe geometry errors, broken exports, missing content, and obviously invalid timing.

Do not conduct extensive pixel comparisons, prolonged profiling, repeated full exports, exhaustive screenshot testing, or endless art-direction revisions. Do not spend more effort verifying the piece than creating it.

Once the animation is clear, visually sophisticated, functional, and offers the best available export, deliver it for user review.

---

# 17. EFFICIENT EXECUTION

Make creative and technical decisions independently, following the single configuration section. Keep progress commentary short and focus on building the animation.

Avoid unnecessary clarifying questions, unrelated web research, planning documents, extra concept proposals, multiple implementations, and separate editing applications.

Only research facts and authentic brand assets when needed. Do not generate scripts for unrelated topics or invent brand imagery.

Reuse the rendering system, object definitions, timeline, audio graph, and export functions. Don't recalculate expensive geometry or labels unnecessarily.

Prioritize the details most visible to viewers:

- Intricate yet legible isometric structures
- Correct spatial logic and consistent orthographic geometry
- Beautiful staged line tracing and assembly
- Deliberate state and information changes
- Fluid camera tracking and connected transitions
- Crisp line rendering at delivery resolution
- Strong editorial hierarchy and readable labels
- Meaningful educational content
- Cohesive procedural sound and music where enabled
- Real downloadable output in the specified format

A striking demonstration should not be mistaken for a simple wireframe demo or an unfinished technical sketch.

---

# 18. DELIVERY AND START

**If storyboard is enabled:** Deliver the scene table and rendered visual storyboard Artifact, then stop for approval. After approval, deliver the complete playable animation and video export.

**If storyboard is disabled:** Produce the complete motion graphic directly without a storyboard interruption.

For the finished animation provide:

1. The playable HTML Artifact with working controls.
2. The complete animated explanation, with meaningful moving lines, mechanisms, and diagrams.
3. All audio, transcript, or subtitle controls enabled by the configuration.
4. **A genuine downloadable video in the configured output format**, when the browser permits it.
5. A standalone HTML fallback only if the Artifact blocks the required encoding or download capability.

State any real export limitation briefly and precisely. Do not claim format compliance when only a preview or differently encoded video exists. Do not write an implementation essay.

**START NOW.** Read the project configuration once. Develop an original explanatory sequence that translates the selected topic into fluid, intricate isometric structures and connected information graphics. Follow the storyboard setting and generate either the rendered previews for approval or the complete animation immediately. Deliver the real video using the configured export format.
