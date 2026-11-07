# What the engine can render

You can only ask for what is listed here. Anything else is rejected and sent back to you.
Times: you anchor everything on **word ids** (`w41` in the transcript is `41`). The engine converts them to exact times.

## Beat kinds

| kind | what the viewer sees | layer | length |
|---|---|---|---|
| `explainer` | full screen 3D: the camera moves around an object on a dark stage while the voice carries on; the object animates (actions) and gets labels | full screen | 2–9 s |
| `object` | a 3D object rises from behind the speaker (or flies in from far away) and hovers beside his head while he talks; it animates too | over the speaker | 2–6.5 s |
| `machine` | the company's own machine (built from their photos), as an `object` or as a full-screen turn-table (`asset: "machine"`, `enter: "still"` makes it full screen). With several machines: `asset: "machine:1"`, `"machine:2"` … (or `"machine:<name>"`) | over / full | 2.4–6 s |
| `text_behind` | 1–2 huge words *behind* the speaker (he stays in front of them) | behind | 0.9–3 s |
| `number` | a spoken number big in 3D (counts up) with its unit; in fast styles a bold card; in minimal styles a clean card | over / full | 1.4–4 s |
| `statement` | full-screen bold typographic card, 1–3 short lines, highlighted words in the accent colour | full screen | 0.9–2.6 s |
| `list` | 2–3 points appear one by one as floating shapes with labels | full screen | 2.4–10 s |
| `chapter` | chapter card ("Part 2" + title), dips from black | full screen | 0.8–1.6 s |
| `diagram` | nodes (cards with icons) build one by one and get connected by animated arrows that carry moving dots (current, water, data, air, heat, money) | full screen | 2.8–12 s |

Rules: full-screen beats never overlap anything; `object` beats never overlap each other; `text_behind` can sit under an `object` only if they do not overlap in time (keep them apart). Leave the speaker on screen at least 2 s between two full-screen beats when you can.

## Assets for explainer / object beats
`asset` is one of:
- the `id` of an asset you define in `assets` (built with the kit below),
- `library:<id>` — an asset built for an earlier video (listed in the asset library section, reuse them when they fit),
- `machine` — the company's own machine chosen for this video (only when one is given); `machine:1`, `machine:2` … when several are given,
- `builtin:<name>` — ready-made objects from earlier edits:
  - full-screen stages (`explainer` only): `energy` (electric bolt hits a motor, energy rings travel, shaft turns; params `strike_at`, `mech_at` in seconds), `motor_inside` (motor casing opens, stator and rotor inside; `energize_at`, `label_times: {stator, rotor, field}`), `pump_inside` (pump cover comes off, impeller spinning; `label_times: {impeller, water, centrifugal}`), `pump_flow` (water through the impeller; `label_times: {suction, delivery}`), `lift` (water from sump up to the tank), `head` (camera rises with water 20 m to a tank, a height counter)
  - objects (`object` only): `pump_set` (motor + pump; `explode_at`, `highlight: "motor"|"pump"`, `label_times: {motor, pump}`, `motor_sub`, `pump_sub`), `stator_rotor`, `impeller`, `energy`, `lift`, `brand` (the company logo assembling + name, `role` text; use `enter: "still"`)
  Builtin params go in `stage_params` (seconds from the beat start).

## The 3D building kit (for `assets`)
An asset is a list of parts in your own units (it is centred and scaled automatically). Y is up, X is right, Z is towards the camera.
```
{"id": "solar_panel", "name": "Solar panel",
 "parts": [
   {"id": "frame", "shape": "box", "size": [3.2, 0.12, 2.0], "at": [0, 0, 0], "rot": [-25, 0, 0], "color": "#C7CDD5", "material": "metal"},
   {"id": "cells", "shape": "box", "size": [3.0, 0.05, 1.8], "at": [0, 0.07, 0], "rot": [-25, 0, 0], "color": "#1B3A6B", "material": "glass", "group": "panel"}
 ],
 "flows": [{"id": "dc_out", "path": [[1.6, -0.2, 0], [2.6, -0.2, 0], [2.6, -1.4, 0]], "kind": "current"}],
 "labels": [{"part": "cells", "title": "Solar cells"}]}
```
Part fields: `id` (unique), `shape`, `at` [x,y,z], `rot` [deg x,y,z], `axis` ("x"/"y"/"z": the long axis of cylinders, tubes, cones, coils, domes, tori and the turning axis of gears; default "y"), `color` (hex, or a name: blue, red, steel, dark, copper, gold, teal, water, green, white, black, orange, yellow, grey, silver, or a brand colour role: primary, accent, alert, dark), `material`, `group` (several parts that animate together), `hidden` (true = invisible until an `appear` action).
Shapes and their sizes:
- `box` / `rounded_box`: `size` [x,y,z]
- `cylinder`: `radius`, `height` · `tube` (pipe ring, hollow): `radius`, `inner`, `height` · `cone`: `radius`, `radius_top` (0 = point), `height`
- `sphere`: `radius` · `dome`: `radius`, `height` · `torus`: `radius`, `thickness`, `arc` (degrees, optional)
- `gear`: `radius`, `teeth`, `thickness`, `inner` (hole radius)
- `pipe` (tube along a path, rounded corners): `path` [[x,y,z], ...], `radius`, `corner`
- `coil` (helix of wire: windings, springs, heating elements): `radius`, `height`, `turns`, `wire`
- `plate`: `size` [w,h], faces +Z, `photo` (index of a photo of the company's machine mapped on it)
- `text` (3D letters): `text`, `height`, `depth` · `arrow`: from `at` to `to` [x,y,z], `radius`
Materials: metal, steel, painted (default), plastic, rubber, copper, brass, glass (see-through), glow (emits light), matte.
Flows (particles moving along a path): `id`, `path`, `kind` current | water | air | heat | signal | gas | oil | light, optional `color`, `count` (default 24), `size`, `tube` (true draws a faint glass tube along the path).

Modelling tips: 8–60 parts. Get the silhouette and proportions right first, then 2–4 details that make it recognisable (fins, bolts, terminals, a display). Put parts that will move or be labelled in their own ids or groups. Build cutaways with a `glass` or `hidden` casing so the inside can be shown. Keep flows outside solid parts so they are visible.

## Actions (inside explainer / object beats)
`{"do": ..., "at_word": <id> (or "at": seconds from the beat start), "target": <part id | group | "*">, ...}`
- `spin`: `axis`, `rpm`, optional `until_word`
- `explode`: parts move apart from the centre by `distance` (exploded view)
- `move`: `by` [x,y,z] in the asset's units (open a lid, slide a part out)
- `appear` / `fade_out`: show a hidden part / hide a part (a casing fading out reveals the inside)
- `glow`: the target lights up (`color`), stays lit (`until_word` to stop) · `pulse`: one flash
- `highlight`: everything else dims, the target stays bright
- `flow`: starts the particles of `flow: <flow id>` (until `until_word`), `speed`
- `label`: a call-out on the target with `title` and `sub`
Cameras for explainers: `orbit` (slow turn, default), `push_in`, `pull_back`, `rise`, `top_down`, `detail:<part or group>` (from wide to close on that part).
For objects: `enter` `rise` (from behind the speaker, default) or `far` (flies in), `side` left/right of the speaker.

## Transitions (full-screen beats)
Every full-screen beat (`explainer`, `statement`, `list`, `chapter`, `diagram`, and `number` in fast/minimal styles) has a way in and a way back to the speaker:
`"transition_in"` and `"transition_out"`, each one of:

| value | what the viewer sees | length | use it for |
|---|---|---|---|
| `cut` | a straight cut on the word | 0 s | most moments: clean, fast, never laggy; the default |
| `whip` | the graphic slides in fast with motion blur (out: slides off the other side) | 0.38 s in / 0.30 s out | energy, a change of topic, fast styles |
| `fade` | a short dissolve between the speaker and the graphic | 0.32 s in / 0.28 s out | calm or cinematic moments, going back to the speaker softly |
| `zoom` | the graphic scales in from 108 % while it fades in (out: settles to 96 % while it fades) | 0.36 s in / 0.30 s out | the reveal of the key idea, the wow moment |

All moves are eased (fast start, soft landing) and rendered frame by frame at 30 fps, so they never stutter. Leave both fields out to use the style's default (a style learned from a reference video sets its own). The exit is skipped automatically when a beat is too short to hold both moves.
`object`, `machine` and `number` objects over the speaker always arrive with motion (`enter`: `rise` from behind him, `far` flying in, `still` for logos) and ease out at their end.

## Sound
Sound effects are generated by the engine (no licence issues): `air` (soft movement), `whoosh`, `tap`, `thump`, `ding`. The style places them on the moves; you control them per beat with `"sound"`:
- `auto` (default): the style decides
- `none`: silent (small moves, calm moments, a dissolve)
- `accent`: the one moment that should be felt (3 dB louder)
and for the whole video with `"sound_level"`: `minimal` (default: one soft sound per moment, no taps or dings on small moves, 2 dB quieter) or `normal`.
Music is a licensed track or a generated bed, always ducked under the voice; the style sets its level.

## Diagram beats
`nodes`: 2–6 `{id, label (1–3 words), sub (2–5 words), icon, at_word, color}` · `links`: `{from, to, label, kind, at_word}` · `layout`: column (default, top to bottom), row (2–3 nodes), cycle, grid · `title` (2–5 words) · `look` dark/light.
Icons available: listed in the session context.
