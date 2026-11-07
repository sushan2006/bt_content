# Styles learned from reference videos

The team can upload a video they like. The engine measures it and Claude writes a **style card** from it:
- 24 frames spread over the video
- five-frame strips around up to 8 cuts, showing exactly how each transition happens
- the engine's measurements: cut times, how much of the time the speaker is on screen, grade, captions, sound effects per minute, music level

When a learned style is chosen for a video, its card is included in your task. The goal is that our video feels as if the same editor made it. Copy the style, never the content.

## How to follow a style card
Work through the card in this order and apply every part of it:
1. **`replicate`** contains the concrete instructions. Follow each one. If one cannot be done here, use the closest engine choice and say so in `notes`.
2. **Pacing**:
   - `cut_every` sets the rhythm of framing changes (the engine applies it).
   - `leave_speaker_every`, `graphic_hold` and `speaker_hold` decide how often you leave the speaker for a full-screen beat and for how long.
   - Fit the beat count to these numbers for the length of our video.
3. **Transitions**:
   - `engine_in` and `engine_out` are the style's default way into and out of graphics, and the engine applies them to every full-screen beat where you set nothing.
   - Set `transition_in` / `transition_out` yourself only when a moment needs something different, for example the zoom reveal of the wow moment.
   - Keep the style's `duration_s` and `easing` in mind: a style with fast, sharp cuts should not get dissolves.
4. **Motion graphics**:
   - Use graphics for the kinds of moments in `used_for` and keep the moments in `not_used_for` on the speaker.
   - Keep to `per_minute`, and copy how they enter, move and leave.
   - Rebuild the `signature_effects` with our kit (camera moves, exploded views, flows, labels timed on words, diagrams building). These are what make the style recognisable, so every video in this style needs at least one.
5. **Look**: the engine applies the grade, letterbox and grain. Use the card's `palette` for the colours of the kit objects and diagrams, unless they clash with the brand's accent colour (the brand wins for logos and the end card).
6. **Typography and captions**: the engine applies the caption mode, position and highlight. Keep on-screen text in the card's case and weight feel (upper case and short, or sentence case and calm).
7. **Sound**:
   - Match `sfx_per_min` and the kinds of effects. Mark the moments that have no effect in the reference as `sound: "none"`.
   - The quality bar still holds: minimal and deliberate, with one accent.
8. **`dont`**: never do these, even if another rule seems to ask for it.
9. **`engine_gaps`**: things the reference does that we cannot render. Use the substitutes the card gives.

Without a card (no API key when the style was learned) you get only the measured numbers. Use them the same way: pace, how much graphics, grade, caption position, sound level.

## When writing a style card (style analysis)
Watch for everything that makes the reference recognisable:
- cutting rhythm
- how it leaves and returns to the speaker
- transition speed and easing
- which moments get graphics
- 2D or 3D
- how graphics enter, move and leave
- typography
- caption animation
- colour palette and grade
- contrast and grain
- music energy, effect density and loudness

Trust the frames over the measurements when they disagree, and say why.
