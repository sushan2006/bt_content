# The company's machines

On the New video form the team can tick "This video shows one of our machines" and add one or more machines, each with a name, photos (front first, then side and top) and optional notes. Machines added for earlier videos can be reused.

## How a machine becomes a 3D model (.glb)
This happens before the edit starts. The edit waits until every machine is ready.
1. Each photo is cut out of its background (the U²-Net cut-out model runs on the laptop), cropped and saved as a PNG with a transparent background.
2. Claude, with a Claude API key, works as a 3D product artist:
   1. Identifies the machine and which side each photo shows.
   2. Measures the width : height : depth ratios from the photos.
   3. Blocks out the silhouette with the kit (boxes, rounded boxes, cylinders, pipes …).
   4. Adds the 3–8 details that make it recognisable.
   5. Takes the real colours from the photos.
   6. Puts the photos on flat faces as `plate` parts (front panel, display, nameplate) so the real look comes through.
   7. Names and groups the parts so they can spin, open, glow and get labels. The casing is its own group, so it can fade away to show the inside.
3. The model is rendered from three angles. Claude compares the render with the photos (silhouette, proportions, colours, plates, details) and corrects it once.
4. The engine saves `model.glb` (a standard 3D file anyone can open), `spec.json` (the kit description you can animate) and `preview.jpg`. All three go in the Drive `_assets` folder and are reused by later videos.

Without an API key, the engine builds a 3D relief from the front photo instead. It looks right when it turns up to about 35° each way and cannot be opened or exploded.

## How to use the machines in an edit
- Each machine is listed in your context: `machine:1`, `machine:2` … in the order the team added them, with its name, keywords and its three-angle preview. `machine` alone means `machine:1`, the main machine.
- **Show each machine when it is first named** (its name or one of its keywords). Use our machine instead of a generic built-in object of the same kind: when he says "our pump", show our pump, not `builtin:pump_set`.
- Ways to show it:
  - an `object` / `machine` beat rising beside the speaker (`enter: "rise"`) while he keeps talking about it
  - a full-screen `explainer` with `asset: "machine:<n>"` for a turn-table
  - with a Claude-modelled machine (it has a kit spec), the kit actions on its parts: spin the fan, fade the casing to reveal the inside, `explode` to show how it is built, `glow` the part he names, `label` the main parts, `detail:<part>` to land the camera on it
- The main machine is the natural centre of the **wow moment** when the topic is that machine. Use a zoom reveal, a cutaway or an exploded view, timed on his words.
- Never change how the machine looks (colours, proportions, logos) and never invent parts it does not have. If the speaker describes a part that the model does not show, illustrate it with a separate kit object or a diagram, and note it for the reviewers.
- With several machines, keep each one on screen long enough to recognise (at least 2.4 s) and never show two machines at the same time unless he compares them.
