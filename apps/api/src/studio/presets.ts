/**
 * The preset styles: eight motion-graphics looks and Simple Edit (clean cuts of real footage, no graphics).
 * Each one is shown on the Styles page and in the New video form. Its full prompt template lives in
 * apps/api/templates/studio/<key>.md and is copied into Claude Code with the job's settings filled in.
 * Styles learned from a reference video live in style_profiles and are referenced as "profile:<id>".
 */
export interface Preset {
  key: string;
  number: number;
  name: string;
  tagline: string;          // two or three words under the name
  technique: string;        // how Claude builds it
  about: string;            // one line on the card
  looks: string;            // "What it looks like"
  best_for: string;         // "Best for"
  good_to_know?: string;    // shown in a red box; also goes into the prompt
  storyboard_first: boolean;
  footage_only?: boolean;   // edits real footage only (no graphics): the material must be camera footage
  defaults?: { music?: boolean; sfx?: boolean; subtitles?: boolean };
  example_topic: string;
  spec: string[];           // the full style spec for the prompt
}

export const PRESETS: Preset[] = [
  {
    key: 'paper_cutout', number: 1, name: 'Paper Cut-Out', tagline: 'handmade editorial', technique: 'Canvas 2D · paper textures',
    about: 'Layered construction paper that slides, folds and settles into infographics.',
    looks: 'Cut paper with torn edges, fibre texture and soft shadows. Pieces assemble into diagrams, labels sit on paper banners, and small parts move with a slight stop-motion step.',
    best_for: 'How-it-works explainers, loops and processes, anything that should feel warm and approachable.',
    good_to_know: 'Each scene is dense with paper detail, so this is a good one to run with Storyboard first. You check the frames before Claude animates them.',
    storyboard_first: true,
    example_topic: 'How an AI agent works: goal, act, check, decide',
    spec: [
      'Background: warm cream paper (#efe6d6 range) with visible fibre noise; a torn green or blue paper strip as the ground or frame.',
      'Shapes: every element is a cut-paper piece with a slightly irregular, torn edge, a 1–2 px lighter edge highlight and a soft drop shadow (offset 3–6 px, 25% opacity) so pieces sit in layers.',
      'Palette: terracotta (#c9623f), mustard (#e3a83b), slate blue (#6d93a8), dark ink (#22313f), sage (#8aa17a). Use the brand colours only as accents unless they fit this palette.',
      'Type: bold rounded sans (Montserrat ExtraBold / Inter Black) in white on paper banners, or dark ink on cream tags. Labels are paper tags pinned with a small piece of tape.',
      'Motion: pieces slide in from off-frame and settle with a small overshoot, flip over like folding paper, or drop and bounce once. Animate at 12 fps "on twos" for a stop-motion feel while the export stays 30 fps. Tiny ±1° wobble on resting pieces.',
      'Diagrams: arrows are dashed paper strips; loops are a thick paper ring with arrow heads; charts are paper bars that grow up from the base.',
      'Transitions: a new sheet of paper slides over the old scene, or the scene tears away.',
    ],
  },
  {
    key: 'particles', number: 2, name: 'Generative Particles', tagline: 'cinematic tech', technique: 'Three.js point clouds · shaders',
    about: 'Thousands of glowing points assemble into objects, words and diagrams.',
    looks: 'A deep navy-to-black space where thousands of small glowing points drift, then flow together to form words, logos, outlines of objects and connected diagrams, and scatter again into the next idea.',
    best_for: 'Technology, AI, data and comparison videos that should feel high-end and cinematic.',
    good_to_know: 'Particle scenes look best dark. Text made of particles needs to stay on screen a little longer (about 1.5 s fully formed) to be readable.',
    storyboard_first: false,
    example_topic: 'Claude Code vs Codex: one goal, ship working software',
    spec: [
      'Background: deep navy (#050b1f) to black radial gradient, faint star dust, slight bloom/glow on bright points.',
      'Particles: 8,000–40,000 points (Three.js Points with additive blending). Two accent colours that glow: cyan (#35e0ff) and violet (#9b7bff), or the brand colours if they glow well on dark.',
      'Forming shapes: sample points from text (canvas-rasterised words), from SVG outlines of objects and from diagram boxes, then tween every particle from its current position to its target with curl-noise wobble on the way (1.2–2 s, ease-in-out).',
      'Diagrams: boxes and their connector lines are drawn as dotted particle outlines; data flowing between them is small bright pulses travelling along the lines.',
      'Camera: slow dolly and orbit (no more than 10° per beat); depth of field feel by fading far particles.',
      'Type: monospace or tech sans (JetBrains Mono / Inter) for small labels in pill-shaped outlines; key words formed out of particles.',
      'Transitions: particles explode outwards into noise and re-form as the next shape.',
    ],
  },
  {
    key: 'liquid_glass', number: 3, name: 'Liquid Glass', tagline: 'premium product', technique: 'WebGL refraction shaders',
    about: 'Glass lenses glide over the scene and bend whatever sits behind them.',
    looks: 'A rich dark-blue product scene with interface cards; rounded glass lenses and pills slide over it, refracting and magnifying what is behind them with a thin bright rim, the way premium product launches look.',
    best_for: 'Product and app demos, software features, launches that should feel premium.',
    good_to_know: 'Refraction needs something interesting behind the glass: keep a UI card, a photo or the speaker under every lens.',
    storyboard_first: false,
    example_topic: 'Idea → live app: prompt, preview, fix, ship',
    spec: [
      'Background: deep blue gradient (#0b1a3a → #1c3f7a) with soft out-of-focus light blobs.',
      'Content under the glass: clean UI cards (rounded 16–24 px, subtle borders), screenshots, the product photo or the speaker footage.',
      'Glass: rounded rectangles, circles and pills rendered with a refraction shader (offset the background by a normal map of a rounded bevel), 4–8% white fill, thin bright rim light on top-left, soft shadow below, slight chromatic fringe at the edge.',
      'Motion: lenses glide on smooth curves (ease-in-out, 0.8–1.2 s), magnify key UI elements, then park as the frame for a label. Buttons inside glass press down with a small scale bounce.',
      'Type: Inter / SF-style sans, white, semibold headings; small monospace captions for steps (prompt · preview · fix · ship).',
      'Flows: a step-by-step pill timeline at the bottom with glowing connectors that light up as each step is reached.',
      'Transitions: a large glass panel sweeps across the frame and the scene behind it changes.',
    ],
  },
  {
    key: 'kinetic_type', number: 4, name: 'Kinetic Typography', tagline: 'type is the picture', technique: 'Canvas 2D text engine',
    about: 'Huge words, masked reveals and type that turns into the explanation.',
    looks: 'Huge, heavy words fill the frame, revealed through masks, struck out, stacked and swapped in time with the voice. Lists and checklists are built out of type, with one highlighter colour for the key word.',
    best_for: 'Tips, opinions, before/after and "do this, not that" videos, and anything driven by the voiceover.',
    good_to_know: 'Every word on screen should match the voice exactly. Timing comes from the word-level transcript, so a clean voice recording matters most.',
    storyboard_first: false,
    example_topic: 'Vague vs precise prompts: goal, details, constraints, example, evaluate',
    spec: [
      'Layout: split or full-frame type. One side dark (#111) with white type, one side off-white (#f2efe8) with black and electric-blue type; a neon-yellow (#e8ff3a) highlighter bar marks the key line.',
      'Type: very heavy condensed sans for hero words (Anton / Bebas Neue / Inter Black, 160–300 px at 1080 wide), monospace for small labels and numbering (01, 02, 03).',
      'Motion: words land on the beat of the voice using word-level timestamps; reveal with a mask wipe (60–120 ms), scale punch (1.15 → 1.0), or slide up from a clipping line. Strike-throughs draw across in 200 ms.',
      'Lists: numbered rows (01 GOAL / 02 DETAILS …) build one per spoken item with a thin rule under each and a right-aligned small note.',
      'Captions: none separately; the type IS the caption, so it must match the voice word for word.',
      'Transitions: a hard cut on the beat, or the hero word scales up to fill the frame and becomes the next background.',
    ],
  },
  {
    key: 'isometric', number: 5, name: 'Isometric Line Art', tagline: 'technical drawing', technique: 'Three.js orthographic · line geometry',
    about: 'Precise line drawings that trace themselves, then start working.',
    looks: 'Clean isometric line drawings on a dark navy blueprint background. Lines draw themselves stroke by stroke, then the drawing comes alive: parcels move, signals pulse along routes, numbered call-outs pop in.',
    best_for: 'Processes, logistics, systems and anything with a physical layout or journey.',
    good_to_know: 'Line art reads best with few colours: keep the drawing in one line colour and use the accent only for what is moving or important.',
    storyboard_first: false,
    example_topic: 'Checkout → doorstep: payment, pick & pack, in transit, delivered',
    spec: [
      'Background: dark navy (#0f1b2b) with a very faint isometric grid.',
      'Drawing: orthographic 30° isometric view, white/pale-blue lines (1.5–2.5 px), no fills except small accent fills; rounded line caps.',
      'Accent: one teal (#2ec4b6) for paths and status dots, one orange (#f5a524) for the thing that matters (pin, alert); brand colour may replace teal.',
      'Motion: every object first draws itself (stroke-dashoffset style, 0.6–1.2 s, ordered from back to front), then animates: things move along dashed routes, numbered call-outs (1, 2, 3 in small teal circles with a mono label) pop in with a leader line.',
      'Camera: static isometric camera, slow pan along the journey; no perspective.',
      'Type: small uppercase monospace labels (letter-spaced) and one bold sans title bottom-left with a progress dot track under it.',
      'Transitions: the camera pans to the next area of the same drawing (one continuous world), or lines un-draw and the next drawing traces in.',
    ],
  },
  {
    key: 'flat_vector', number: 6, name: 'Flat Vector', tagline: 'clean 2D studio', technique: 'SVG paths · shape morphing',
    about: 'Bold 2D illustration where shapes morph from one idea into the next.',
    looks: 'Bright, friendly flat illustration on a light background: simple shapes, bold colours, no gradients. Shapes morph into each other, numbered steps appear, and dashed flow lines show where energy, water or data goes.',
    best_for: 'Explaining how a machine or system works (energy, water, sensors), education, and friendly product explainers.',
    good_to_know: 'This is the best match for machine explainers like the water motor: draw the machine in simple shapes and animate the flow through it.',
    storyboard_first: false,
    example_topic: 'This video explains how the water motor works and its principle',
    spec: [
      'Background: very light grey/blue (#f4f6fb) with a thin ground line.',
      'Illustration: flat SVG shapes with solid fills, 2–3 px dark outlines only where needed, rounded corners; no gradients, no textures, simple shadows as flat darker shapes.',
      'Palette: sunny yellow (#ffc83d), royal blue (#2f5bea), teal-green (#18c29c), coral (#ff6b5b), navy (#1d2a4d). Brand colours replace blue/teal when given.',
      'Motion: shapes morph from one idea into the next (path morphing, 0.6–0.9 s, ease-in-out); parts pop in with a small overshoot; rotating parts (impellers, gears, fans) spin continuously while the narration talks about them.',
      'Flows: dashed lines with moving dashes show water, current, air or data; small particles travel along pipes; numbered black circles (1, 2, 3) label the steps with short bold labels.',
      'Type: Montserrat Bold title top-left with a smaller subtitle; small Inter labels next to parts.',
      'Transitions: the whole scene morphs into the next, or zooms into one part which becomes the next scene.',
    ],
  },
  {
    key: 'risograph', number: 7, name: 'Risograph Print', tagline: 'spot-ink poster', technique: 'Canvas ink plates · halftones',
    about: 'Overprinted spot inks, halftone dots and slightly off registration.',
    looks: 'A printed-poster look on warm paper: two or three spot inks that overprint where they overlap, halftone dot shading, grainy texture and a slightly misaligned print, with big poster type.',
    best_for: 'Culture, music, events, opinion pieces and anything that should feel artistic and memorable.',
    good_to_know: 'Keep to two or three inks. The charm comes from overlaps and misregistration, not from many colours.',
    storyboard_first: false,
    example_topic: 'How a record plays: groove, stylus, cartridge, amp, speaker',
    spec: [
      'Paper: warm off-white (#f3e9d2) with paper grain and a few speckles.',
      'Inks: fluorescent pink (#ff4f8b), riso blue (#3d5afe) and yellow (#ffd23f) as separate plates; where they overlap use multiply blending so they overprint (purple, orange). Offset each plate by 2–4 px (misregistration) that drifts slightly over time.',
      'Shading: halftone dots (rotated dot screens per plate) instead of gradients; grain overlay on every plate.',
      'Type: big condensed poster type in one ink with a second plate offset behind it; tiny uppercase labels in a typewriter mono.',
      'Motion: elements are stamped in (scale from 1.05 with a quick ink-spread), rotate slowly like a turning record, halftone density animates to show emphasis; small dashed leader lines to labels.',
      'Transitions: a new print pass slides across (each plate a few frames apart) or the frame is overprinted with a big solid ink shape.',
    ],
  },
  {
    key: 'pixel_art', number: 8, name: '8-Bit Pixel Art', tagline: 'retro game', technique: 'Low-res canvas · nearest-neighbour',
    about: 'Pixel sprites, bitmap type and tile transitions with a chiptune feel.',
    looks: 'A low-resolution game world scaled up with sharp pixels: sprites jump and hit blocks, a HUD panel explains the idea, bitmap text types itself out, and scenes change with tile wipes.',
    best_for: 'Light-hearted explainers, gaming and coding topics, younger audiences, and anything that should be playful.',
    good_to_know: 'Draw everything on a small canvas (for example 270×480 for vertical) and scale it up with nearest-neighbour, so every pixel stays crisp.',
    storyboard_first: false,
    example_topic: 'How a game loop works: input, update, render, frames',
    spec: [
      'Canvas: draw at low resolution (270×480 for 9:16, 480×270 for 16:9) and scale up 4× with nearest-neighbour (image-rendering: pixelated); never blur.',
      'Palette: limited 16-colour palette (PICO-8 style): night blue (#1d2b53), purple (#7e2553), green (#00e436), yellow (#ffec27), pink (#ff77a8), white, plus the brand colour mapped to the nearest palette colour.',
      'World: parallax pixel mountains, a tiled brick floor, twinkling single-pixel stars; sprites 16×16 or 24×24 with 2–4 frame walk/jump cycles.',
      'HUD: a bordered panel on one side lists the steps (INPUT / UPDATE / RENDER) with a blinking cursor bar on the current one; small counters (X:51 Y:37).',
      'Type: bitmap pixel font (Press Start 2P or a hand-made 5×7 font), typed out letter by letter with a blip sound per letter.',
      'Motion: everything moves in whole pixels at 12–15 fps steps; "HIT!" pop-ups, coin sparkles, screen shake of 1–2 pixels.',
      'Transitions: tile wipe (the screen fills with tiles in a pattern, then clears to the next scene) or an iris-out circle.',
    ],
  },
  {
    key: 'simple_edit', number: 9, name: 'Simple Edit', tagline: 'clean cuts, real footage', technique: 'FFmpeg · cuts · colour · sound',
    about: 'Well-paced cuts of your own footage with proper picture and sound. No graphics, no captions.',
    looks: 'Your footage, cut tightly in a clear order: the best moments of each shot, stabilised, colour-matched and with clean, levelled sound. Straight cuts, a short crossfade only between locations, and nothing added on top.',
    best_for: 'Office tours, factory and plant walk-throughs, machines running, events, site visits and interviews: footage that speaks for itself.',
    good_to_know: 'Upload every clip you shot (or attach them in Claude). The edit is only as good as the footage, so steady, well-lit shots of 5–15 s each work best.',
    storyboard_first: false, footage_only: true, defaults: { music: false, sfx: false, subtitles: false },
    example_topic: 'A walk through our factory: from raw material at the gate to the finished, packed product',
    spec: [
      'Cuts only: no motion graphics, animated text, titles, stickers, zoom effects or flashy transitions; no captions unless subtitles are enabled.',
      'Order the shots to tell the story of the topic (the real path through a place, or the real order of a process); open with the strongest shot.',
      'Shots of 1.5–4 s for b-roll, cut on action or on natural pauses; keep complete sentences when someone speaks.',
      'Stabilise handheld shots, match exposure and white balance across shots, gentle contrast lift.',
      'Clean sound: high-pass speech, reduce noise and hum, even levels, keep natural ambience low; −14 LUFS final.',
      'Reframe intelligently for 9:16 around the subject; constant 30 fps output.',
    ],
  },
];

export const PRESET_BY_KEY: Record<string, Preset> = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

/** Styles of videos made before Phase 4 (shown by name only). */
export const LEGACY_STYLES: Record<string, string> = {
  editorial: '3D Explainer', hype: 'Bold & Fast', cinematic: 'Cinematic Story', minimal: 'Clean & Minimal',
  clean: 'Clean cut + captions', branded: 'Branded', motion: 'Motion graphics (split screen)', overlay: 'Full video + floating graphics',
};
