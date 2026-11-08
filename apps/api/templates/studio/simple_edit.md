# TASK

Edit the supplied camera footage into a clean, well-paced, professional video with **straight cuts and proper picture and sound**: no motion graphics, no animated text, and no captions unless subtitles are enabled in the configuration.

This style is for footage that speaks for itself: an office tour, a factory or plant walk-through, a machine running, an event, a site visit, an interview or a short talk. The quality comes from choosing the best moments, cutting them in a clear order, and making every shot look and sound right.

Edit the footage here with code (FFmpeg, Python). No paid API and no AI video generator.

---

# 1. PROJECT CONFIGURATION — FILLED IN BY THE CONTENT STUDIO DASHBOARD

**Topic:** {{TOPIC}}

{{SETTINGS}}
- Style: Simple edit / clean cuts of real footage, no graphics
{{AUDIO_SETTINGS}}

**This is the only configuration block and the single source of truth.** Use the topic to decide what the viewer should see first, what order the places or steps go in, and what the video should leave them with.

---

# 2. WHAT THIS STYLE IS (AND IS NOT)

**Do:**
- cut, trim and reorder
- choose the best takes and moments
- reframe and crop for the format
- stabilise shaky handheld shots
- correct exposure, white balance and colour so all shots match
- clean the sound (noise, hum, wind, levels)
- add a music bed when enabled
- use a short crossfade only where a cut would jar (for example a change of location)

**Do not:**
- add motion graphics, animated text, titles, lower thirds, stickers or emoji
- add zoom effects, glitches or flashy transitions
- add AI-generated imagery or stock footage
- add captions or subtitles, unless subtitles are enabled in the configuration
- add a logo or end card, unless the notes ask for one

**Storyboard enabled:** before cutting, show a shot list (the order of the shots with their source file, in/out times and one frame each, as a contact sheet) and wait for approval.

**Voiceover enabled:** the voiceover is the spine of the edit. Cut the footage to the narration, with each shot showing what is being said.

---

# 3. EDITING METHOD

1. **Log the footage.**
   - `ffprobe` every file: duration, resolution, fps, rotation, audio.
   - Pull a frame every 2 s and look at them.
   - Transcribe any speech with word timestamps (faster-whisper).
   - Note the usable moments: steady, well-exposed, something happening, good sound. Note the unusable ones: shaky starts, the camera pointing at the floor, people walking into the lens, wind noise.
2. **Structure.** Build a clear order from the topic:
   - **Tours:** follow the real path through the place (entrance, then each area, then the most important area, then a closing shot).
   - **Processes:** follow the real order of the steps.
   - **Talks:** follow the speaker's argument.

   Open with the strongest, most telling shot within the first 2 seconds. End on a shot that completes the story (the finished product, the team, the wide view).
3. **Cut.**
   - **Shot length:** usually 1.5–4 s for b-roll; longer when something is happening, and as long as the sentence when someone speaks.
   - **Cut on action:** cut when movement starts or completes, or on a natural pause in speech.
   - **Avoid jump cuts** between near-identical framings of the same subject. Use cutaways (hands at work, a detail, a wide shot) to bridge them.
   - **Speech:** keep complete sentences. Cut false starts, filler and long pauses; never cut inside a word.
   - **J-cuts and L-cuts:** let audio lead or trail a cut when it makes the flow smoother.
4. **Picture.**
   - **Reframe:** for 9:16, crop intelligently around the subject (the person, the machine, the action), never just the centre of a moving subject. For 16:9, keep the original framing.
   - **Stabilise** handheld shots (`vidstabdetect` / `vidstabtransform`, with a smoothing that does not warp).
   - **Colour:** match exposure and white balance between shots, with a gentle contrast and saturation lift. No heavy looks or film filters unless the notes ask.
   - **Frame rate:** keep a constant 30 fps output. Convert variable-frame-rate phone footage properly.
5. **Sound.**
   - High-pass at around 80 Hz on speech. Reduce steady noise and hum (`afftdn` / `anlmdn`, gently).
   - Even out levels between shots.
   - Keep natural ambient sound under b-roll (machines, footsteps, the room), lowered so it supports rather than distracts.
   - **Music** (only when enabled): a licensed track from the brief, or an original bed made in code. Keep it under any speech and duck it about 18 dB while someone talks. Fade it in and out inside the runtime.
   - **Sound effects:** none unless enabled; even then only subtle ones that a viewer would not notice as added.
   - **Final mix:** −14 LUFS integrated, true peak ≤ −1 dB.
6. **Length.** Respect the target length (within about 10%) when one is set. With "as long as the footage needs", keep only what earns its place: shorter is better than padded.

---

# 4. EXPORT

- MP4, H.264 (yuv420p, CRF about 18, `+faststart`), AAC 48 kHz 192 kb/s, at the configured resolution and 30 fps.
- Check the result with `ffprobe`, measure the loudness, and watch the full video once before sending it.

# 5. CHECK BEFORE SHOWING A DRAFT

- No black, frozen or duplicated frames.
- No flash frames at the cuts.
- No clicks or pops at the cuts.
- No sudden changes in volume or colour between shots.
- The subject is never cut off by the crop.
- Every shot has a reason to be there.
- The order tells the story of the topic.

Show the draft with a short shot list (shot, source, in/out, why it is there), then make the requested changes.

**START NOW.** Follow the configuration. If any footage is missing or unreadable, ask before guessing.
