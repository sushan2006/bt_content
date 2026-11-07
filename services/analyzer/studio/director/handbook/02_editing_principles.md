# Editing principles (house rules, learned from edits the team approved)

## Structure
- **Back and forth.** The video alternates between the speaker on camera and full-screen explainers. Leave the speaker when he starts explaining *how* something works; come back to him for opinions, transitions, numbers he states with emphasis and the closing line. Not too fast: hold each explainer at least 2.5 s and each return to the speaker at least 2 s.
- **Every visual means something.** No decoration. If a moment has nothing to show, stay on the speaker; the engine's punch-ins and captions keep it alive.
- **Visuals are brought in with motion.** Objects rise from behind the speaker or fly in from far away, explainers cut in on a word, diagrams build node by node as the words are said. Nothing just appears.
- **One idea per beat.** A beat shows one mechanism or one fact. Split long explanations into two or three beats that follow the speech.
- **Follow the words.** Start a beat on the first word of the idea (start_word) and end it on its last word (end_word). Time actions inside a beat on the words too: the winding glows on "current", the rotor spins on "spins".

## Opening (first 3 seconds)
- The first words must be heard immediately; never delay the speech.
- Use one hook device: a title behind the speaker (2 short words, the topic), a brand object while he introduces himself, or a bold statement card in fast styles.
- If the speaker introduces himself ("I'm from <company> and I work as ..."), show the builtin `brand` object over that sentence.

## Middle
- Typical rhythm for a 60 s talking video: 5–9 beats, at least half of them full-screen explainers or 3D objects, spaced so the speaker is seen between them.
- Use a **3D explainer** (full screen) for mechanisms: inside a machine, how energy or a fluid moves, what turns.
- Use a **3D object over the speaker** when he names a thing and keeps talking about it (the object stays visible next to him).
- Use a **diagram** for flows between several things (grid → meter → appliance; sump → pump → tank; sensor → gateway → cloud → phone) and for cause and effect.
- Use a **number** beat only for numbers that are actually spoken, with their unit.
- Use a **statement** for a strong claim or a short punchline (3–6 words).
- Use a **list** for 2–3 parallel points the speaker lists.
- Use **chapters** only in long or cinematic videos, at real topic changes.

## Cuts (drop_words)
- Cut false starts, stutters, repeated words, filler ("uh", "um", "you know", "like" used as filler) and a sentence that is said twice (keep the better one, usually the second).
- Never cut words that carry meaning, never cut inside a number or a name, and never change what the speaker means.
- Small cuts only: the engine has already removed long pauses and chosen the best takes.

## Captions
- `emphasis`: 5–12 key words (technical terms, numbers, the product name) the captions draw large.
- `corrections`: fix words the speech recognition misheard, using the brief, the glossary, the research and common sense ("Beastings" → company name, "employer" → "impeller", "starter" → "stator" when he talks about a motor). Only fix what is clearly wrong.

## Look and taste
- Brand colours for accents; dark stage backgrounds for 3D explainers; clean light cards in minimal styles.
- Labels: short (1–3 words) title, optional 2–5 word subtitle. Two or three labels per explainer at most, each timed to its word.
- Text on screen is short. A title behind the speaker is 1–2 words per line, max 2 lines.
- Do not repeat the same asset twice in a row; vary cameras between explainers (orbit, push_in, detail, rise, top_down).

## Accuracy
- Use the research notes. If the speaker says something technically wrong, do not illustrate the wrong thing: illustrate it neutrally and add a note for the reviewers.
- Never put a number on screen that was not said or is not in the research.
