"""The company's own machine as a 3D model, built by Claude from their photos (no paid 3D service).

1. Each photo is cut out of its background (U^2-Net, on the CPU).
2. Claude looks at the photos and models the machine with the building kit: the body as boxes, cylinders and pipes in
   the right proportions and colours, with the photos mapped onto plates on the visible faces, and parts named so they
   can be animated and labelled later.
3. The model is rendered from three angles; Claude compares the previews with the photos and corrects it once.
4. model.glb (standard 3D file), spec.json and preview.jpg are written; the machine is used like any other asset.
"""
from __future__ import annotations

import json
import os
from typing import Callable

from . import claude as C
from .. import kit

SYSTEM = """You are a senior 3D product artist. You model the company's real industrial machines and products from their photos as clean,
instantly recognisable 3D product illustrations for explainer videos (the look of a premium product render: correct proportions,
true colours, crisp edges, a few telling details, nothing invented).
You build with a parts kit (boxes, rounded boxes, cylinders, tubes, cones, spheres, domes, tori, gears, pipes, coils, plates that carry
the real photo, 3D text, arrows). The model is saved as a standard .glb file and animated later (parts spin, open, glow, get labels),
so parts must be named and grouped sensibly. Reply with JSON only."""


MODEL_BRIEF = """Model this machine as ONE kit asset, working in this order:
1. Identify it. What is it (type of machine), what are its main assemblies (e.g. motor + pump head + base; enclosure + display + glands)?
   Which photo shows which side (front / side / top / back)? Use the name and the notes from the team.
2. Measure proportions from the photos. Estimate width : height : depth from the photo that shows each pair of dimensions. Use the real
   size if the notes give one; otherwise keep the ratios right (that matters more than absolute size). Round parts are cylinders along the
   right axis; flat housings are rounded boxes.
3. Block out the silhouette with 3-8 large parts: body, main housings, base or feet, the biggest pipes or flanges. Check the silhouette
   against every photo before adding detail.
4. Add the 3-8 details that make THIS machine recognisable: cooling fins, terminal box, nameplate, display, buttons, cable glands, bolts on
   a flange, inlet/outlet ports, wheels, handles, vents. Skip anything you cannot see.
5. Colours and materials: sample the real colours from the photos as hex; painted metal = painted, bare metal = metal or steel, rubber
   seals = rubber, windows = glass, screens or LEDs = glow. Brand stickers and nameplates come from the photo plates, not invented text.
6. Photo plates: put 'plate' parts with "photo": <index> on the faces the photos show clearly (front panel, display, nameplate), sized to
   that photo's aspect ratio and set 0.01 in front of the face so the real look comes through. Do not cover curved surfaces with plates.
7. Make it animatable: give moving parts their own id or group (fan, impeller, shaft, rotor, lid, door, valve handle) with the right axis;
   build the casing as its own group so it can fade away to show the inside; add 2-4 'labels' for the parts a viewer should learn.
   If the inside matters (motor, pump), model the visible inner parts as 'hidden' parts that an 'appear' action can reveal.
8. 20-60 parts in total. Centre it on the origin, Y up, front facing +Z.
Reply with the asset JSON only: {"id": "...", "name": "...", "parts": [...], "flows": [...], "labels": [...]}"""

CHECK_BRIEF = """Here is your model rendered from three angles. Compare it with the photos, point by point:
- silhouette and proportions (width : height : depth) - the most important check
- colours and materials
- position and size of the photo plates (do they sit on the right faces, right way up, not stretched?)
- the recognisable details: anything missing, misplaced, or invented that is not in the photos?
- would a colleague who knows this machine recognise it in one second?
If everything is right reply {"ok": true}. Otherwise reply {"ok": false, "issues": ["..."], "asset": <the complete corrected asset>}."""


def kit_reference() -> str:
    here = os.path.join(os.path.dirname(__file__), "handbook", "03_capabilities.md")
    text = open(here, encoding="utf-8").read()
    a = text.find("## The 3D building kit")
    b = text.find("## Actions")
    return text[a:b] if a >= 0 and b > a else text


def build(images: list[str], out_dir: str, name: str, notes: str = "", log: Callable[[str], None] = lambda m: None,
          model: str = "claude-opus-5-5", budget_usd: float = 1.5) -> dict:
    from PIL import Image
    from .. import machine as MC
    os.makedirs(out_dir, exist_ok=True)
    if not images:
        raise ValueError("add at least one photo of the machine")
    log("Cutting the machine out of each photo")
    cutouts = []
    for i, p in enumerate(images[:6]):
        rgba = MC._crop(MC.cutout(p))
        im = Image.fromarray(rgba, "RGBA")
        im.thumbnail((1400, 1400))
        cp = os.path.join(out_dir, f"photo_{i}.png")
        im.save(cp)
        cutouts.append(cp)
    usage = C.Usage(budget_usd)
    cl = C.Claude(usage, log)
    blocks = [C.text_block(f"Machine: {name}\n{notes}\n\nPhotos (index 0..{len(cutouts) - 1}, background removed):")]
    for i, p in enumerate(cutouts):
        blocks += [C.text_block(f"photo {i}:"), C.image_block(p, 1100)]
    blocks.append(C.text_block(kit_reference() + "\n\n" + MODEL_BRIEF))

    def check(obj):
        if not isinstance(obj, dict):
            return ["reply with one asset JSON object"]
        spec = dict(obj, photos=cutouts)
        _, err = kit.validate(spec)
        return [err] if err else []

    log("Claude is modelling the machine from the photos")
    spec, msgs = cl.ask_json("Machine model", model, SYSTEM, [{"role": "user", "content": blocks}], max_tokens=12000, check=check, retries=2)
    spec = dict(spec, photos=cutouts, name=spec.get("name") or name)
    prev = kit.preview(spec, os.path.join(out_dir, "preview_draft.jpg"))
    log("Claude is comparing its model with the photos")
    try:
        fix, _ = cl.ask_json("Machine check", model, SYSTEM, msgs + [{"role": "user", "content": [
            C.text_block(CHECK_BRIEF),
            C.image_block(prev, 1400)]}], max_tokens=12000,
            check=lambda o: [] if isinstance(o, dict) and (o.get("ok") or (isinstance(o.get("asset"), dict) and not kit.validate(dict(o["asset"], photos=cutouts))[1])) else ["reply {\"ok\": true} or a valid corrected 'asset'"],
            retries=1)
        if isinstance(fix, dict) and not fix.get("ok") and isinstance(fix.get("asset"), dict):
            spec = dict(fix["asset"], photos=cutouts, name=fix["asset"].get("name") or name)
            log("Claude corrected the model: " + "; ".join(fix.get("issues") or [])[:240])
    except C.ClaudeError as e:
        log(f"Model check skipped: {str(e)[:160]}")
    info = kit.save(spec, out_dir)
    b = kit.built(spec)
    meta = {"name": name, "kind": "kit", "kit": spec, "spec": info["spec_path"], "glb": info.get("glb"), "previews": [info["preview"]] if info.get("preview") else [],
            "cutouts": cutouts, "texture": cutouts[0], "width": float(b.size[0]), "height": float(b.size[1]), "usage": usage.summary()}
    with open(os.path.join(out_dir, "machine.json"), "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in meta.items() if k != "kit"}, f, indent=1)
    return meta
