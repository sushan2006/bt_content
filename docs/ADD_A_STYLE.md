# Adding a new editing style (style packs)

The dashboard has nine built-in styles. More are added **from the dashboard, without changing any code**, as a **style pack**:
a small folder that Claude makes from a video you like. This works the same on your laptop and on the deployed site, because the
pack is stored in the database (migration 014), not in the code.

## For you: add a style
1. Download a video whose look you like (a clean 30 to 90 second reel works best).
2. Open a Claude chat that can run code (Claude Code, or a chat with code execution and file creation turned on; any Claude account works). Attach **`docs/STYLE_PACK_KIT.md`** and the downloaded video, and say:
   *"Follow the Style Pack Kit. Make a style pack from the attached video. Style name: <name>. What I like about it: <pacing, captions, 3D objects…>."*
3. Claude delivers a folder: `style.json`, `template.md`, `thumbnail.png`, `README.md`. Look at the thumbnail and the README; ask for changes if you want.
4. In the dashboard: **Styles & music → Add a style pack → Choose the pack folder → Add this style**.
5. The style now appears with its picture next to the built-in ones, and in **New video → 1. Pick a style**. Open it to read its README.
6. Adding a pack with the same name **replaces** the old one. To remove a style, open it and click **Delete this style** (not possible while a video in "Prompt ready" or "Editing with Claude" uses it; videos already finished keep their files).

Only an Admin (the `studio.manage` permission) can add or delete styles. To check a folder before adding it, run `python scripts/check_style_pack.py <folder>`. To try the feature first, add the example in `docs/style-pack-example/` (Blueprint Lines), then delete it.

## The pack
| File | Required | What it is |
| --- | --- | --- |
| `style.json` | yes | The card text and options (below) |
| `template.md` | yes | The full prompt template for Claude Code. At least 300 characters, and it must contain `{{TOPIC}}`, `{{SETTINGS}}` and `{{AUDIO_SETTINGS}}`: the dashboard fills them in for each video |
| `thumbnail.png` | yes | The picture on the style card: png, jpg, webp or gif, named `thumbnail`, under 2 MB. 1280 × 720 (16:9) shows best |
| `README.md` | no | Notes for people, shown on the style's detail page |

Other files are ignored. The checks run when you add the pack; every problem is listed at once in plain words.

### style.json
```json
{
  "name": "Blueprint Lines",
  "tagline": "technical drawing",
  "technique": "Canvas 2D · line draw-on",
  "about": "White technical line drawings that draw themselves on a blueprint grid.",
  "looks": "What it looks like (up to 700 characters).",
  "best_for": "What it is best for (up to 400 characters).",
  "good_to_know": "Optional. Shown in a red box and sent to Claude (up to 500).",
  "example_topic": "How a centrifugal water pump moves water",
  "storyboard_first": false,
  "footage_only": false,
  "defaults": { "music": true, "sfx": true, "subtitles": false }
}
```
- `name` (max 40), `tagline` (max 40), `technique` (max 80), `about` (max 160), `looks`, `best_for`, `example_topic` are required.
- `storyboard_first`: the New video form turns "Storyboard first" on for this style.
- `footage_only`: the style edits real camera footage only (like Simple Edit): the material must be footage, and the prompt says there is no animation.
- `defaults`: starting values for music, sound effects and subtitles when this style is chosen.
- `key` (optional): a short id. Without it the id is made from the name (`Blueprint Lines` → `pack_blueprint_lines`). The same id means the same style.

## For Claude: making a pack from a video
Follow **`docs/STYLE_PACK_KIT.md`**. It is one self-contained file (instructions, tested analysis commands, the rules for each file, a checker script and a complete example pack), written to be attached to a chat on any Claude account together with the video. It is the only copy of these instructions; `test/packs.test.ts` keeps its embedded example and checker identical to `docs/style-pack-example/` and `scripts/check_style_pack.py`.

## How it works (for the developer)
- Table `style_packs` (migration 014): key `pack_<name>`, `meta` (JSON), `template`, `readme`, the thumbnail bytes. Stored in the database, so it deploys with it and is covered by the database backup.
- `apps/api/src/studio/packFormat.ts`: reads and checks the files (pure, unit tested in `test/packs.test.ts`).
- `apps/api/src/studio/packs.ts`: database access and an in-memory list (reloaded at start, after each change, and every minute). `packPreset()` turns a pack into the same shape as a built-in style, so `styles.ts`, `templates.ts` and `pipeline.ts` treat both alike.
- Routes (`routes/studio.ts`): `POST /api/studio/style-packs` (multipart files), `GET /api/studio/style-packs/:id/thumbnail`, `DELETE /api/studio/style-packs/:id`. Packs also appear in `GET /api/studio/styles` with `custom: true`, `thumbnail` and `readme`.
- Screens: `StudioStyles.tsx` (the picture on cards, the README, **Add a style pack**, **Delete this style**); the New video form picks them up automatically.
- Limits: each uploaded file is read up to 2.5 MB; a template up to 150 KB; a thumbnail up to 2 MB.
