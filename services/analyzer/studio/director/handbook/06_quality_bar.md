# The quality bar (read before every edit)

Every video must look like it was cut by a top motion-design studio: smooth, purposeful, clean, with one or two moments that make the viewer say "wow". The rules below come from the team. They apply to every style. A style card from a reference video can change the numbers (pace, colours, sound levels), but never these principles.

## 1. Transitions: smooth, never laggy
- **Know the engine.** Only the transitions in "What the engine can render › Transitions" exist: `cut`, `whip`, `fade`, `zoom`, plus the built-in entrances of objects (`rise`, `far`, `still`). Never describe or plan a transition the engine cannot do. If a reference style uses one, pick the closest engine transition and say so in `notes`.
- **Cut on the word.** Every change happens on a word boundary: a graphic arrives on the first word of its idea, and the edit returns to the speaker as the idea ends, never in the middle of a word. Anchor beats on word ids so the engine times them to the frame.
- **The default is a clean cut.** A straight cut on the word is the smoothest transition there is. Use a move (`whip`, `fade`, `zoom`) only where it adds meaning:
  - `zoom` in for the reveal of the key idea (the wow moment), at most 2 per minute
  - `whip` for a change of topic or in fast styles, at most 1 in every 3 full-screen beats
  - `fade` back to the speaker after a calm or emotional moment, or in cinematic styles
- **Be consistent.** Choose one family of transitions for the video, for example cut in / cut out with one zoom reveal. Mixing all four looks amateur. Do not use the same move twice in a row unless the style card says so.
- **Leave room to breathe.** Keep a full-screen beat on screen at least 2.5 s and the speaker at least 2 s between two full-screen beats, so nothing flickers. Never stack two moves within 0.6 s.
- **No dead frames.** A graphic must be moving or building from its first frame: camera moving, parts assembling, labels arriving. Do not hold a still image over speech for more than about 1.5 s.

## 2. Sound: minimal, but it lands
- Default `"sound_level": "minimal"`. Most moments get one soft `air` movement or nothing at all.
- Give `"sound": "accent"` to one moment per video, two at most: the wow moment or the strongest statement. That contrast is what makes it felt.
- Give `"sound": "none"` to small moves (labels, a second object close after the first, dissolves) and to any moment where the speaker says something serious.
- Never put an effect on top of the speaker's key words; effects sit just before or between words. Music stays low under the voice (the style ducks it), and the voice is always the loudest thing.

## 3. Motion graphics: only where they are needed, special when they are
- **Need first.** A graphic earns its place when it shows something the viewer cannot see on the speaker: how a mechanism works, what flows where, a number that matters, the company's machine, a claim worth remembering. Opinions, introductions, stories and the closing line stay on the speaker (punch-ins and captions keep them alive).
- **Budget.** For a 60 s video: 4–8 graphic moments in total. At most half of the video's time on full-screen graphics (the style card can change this).
- **When you use one, make it special.**
  - Show the mechanism, not a static object: the rotor spins as he says "spins", water flows as he says "flows", the casing fades away to reveal the inside, parts explode apart to show how it is built.
  - Use camera moves: `push_in` toward the important part, `detail:<part>` to land on it, `orbit` to show the whole.
  - Build in sync with the words: labels on the word they name, diagram nodes as each is mentioned, numbers counting up as they are said.
  - Plan one **wow moment** per video, on the key idea: the most complete 3D explainer (an exploded view, a cutaway with flow, a zoom reveal of the company's machine) with `transition_in: "zoom"` and `sound: "accent"`.
- **Clean design.** Brand colours for accents, dark studio backgrounds for 3D, 1–3 word labels, at most 3 labels per explainer, nothing covering the speaker's face, text large enough to read on a phone.
- The approved water-motor edit (`05_example_water_motor.md`) shows the level expected. It is not a template: each video needs its own ideas built from its own words.

## 4. The company's machines
When the video has machines (see "The company's machines"), each one must appear when it is first named. Use it instead of a generic object of the same kind, and make the main machine part of the wow moment when the topic allows.

## 5. Check before you reply
Run through this list. Fix anything that fails before you send the direction:
1. Every beat starts and ends on the right words, and nothing starts before its word.
2. Transitions: mostly cuts, one family, zoom kept for the reveal, no two moves within 0.6 s.
3. Every graphic explains something, and there is exactly one planned wow moment.
4. Every named machine appears at least once, with the right `machine:<n>`.
5. Sound: minimal level, one or two accents, silence on small moves.
6. No dead frames, no clutter, nothing on the speaker's face, labels short.
7. Speaker seen at least 2 s between full-screen beats; total full-screen time within the budget.
