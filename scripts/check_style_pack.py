#!/usr/bin/env python3
"""Checks a Content Studio style pack folder the same way the dashboard does, before you add it.

Usage:   python check_style_pack.py <folder>
Needs:   Python 3.8 or newer. Nothing to install (Pillow is used only if present, to read the picture size).
Exit:    0 = the dashboard will accept the pack, 1 = fix the errors first.

The pack is these files in one folder: style.json, template.md, thumbnail.png (or .jpg/.jpeg/.webp/.gif) and, optionally, README.md.
This script mirrors apps/api/src/studio/packFormat.ts. If you change one, change the other.
"""
import json
import os
import re
import struct
import sys

LIMITS = {"json": 20000, "template": 150000, "readme": 60000, "thumbnail": 2 * 1024 * 1024, "each": int(2.5 * 1024 * 1024)}
PLACEHOLDERS = ["{{TOPIC}}", "{{SETTINGS}}", "{{AUDIO_SETTINGS}}"]
MIN_TEMPLATE_CHARS = 300
REQUIRED_TEXT = {"name": 40, "tagline": 40, "technique": 80, "about": 160, "looks": 700, "best_for": 400, "example_topic": 160}
OPTIONAL_TEXT = {"good_to_know": 500}
BOOL_FIELDS = ["storyboard_first", "footage_only"]


def length(s):
    """Length as the dashboard counts it (Unicode characters, so an emoji counts as one)."""
    return len(s)


def pack_key(s):
    slug = re.sub(r"^pack_", "", s.lower())
    slug = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")[:30].rstrip("_")
    return "pack_" + slug


def sniff_image(b):
    if len(b) > 8 and b[0] == 0x89 and b[1:4] == b"PNG":
        return "image/png"
    if len(b) > 3 and b[0] == 0xFF and b[1] == 0xD8 and b[2] == 0xFF:
        return "image/jpeg"
    if len(b) > 6 and b[:4] == b"GIF8":
        return "image/gif"
    if len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_size(path, b, kind):
    if kind == "image/png" and len(b) >= 24:
        return struct.unpack(">II", b[16:24])
    try:
        from PIL import Image  # optional
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def read_folder(folder):
    files = {}
    for root, _dirs, names in os.walk(folder):
        for n in names:
            files[n.lower()] = (n, os.path.join(root, n))
    return files


def check(folder):
    errors, warnings, info = [], [], []
    if not os.path.isdir(folder):
        return ["Folder not found: " + folder], [], [], None
    files = read_folder(folder)
    thumb_key = next((k for k in files if re.match(r"^thumbnail\.(png|jpe?g|webp|gif)$", k)), None)
    used = {"style.json", "template.md", "readme.md"} | ({thumb_key} if thumb_key else set())
    ignored = [files[k][0] for k in files if k not in used]
    if ignored:
        info.append("Ignored files (the dashboard does not use them): " + ", ".join(sorted(ignored)))

    def data(key):
        with open(files[key][1], "rb") as f:
            return f.read()

    for k in [k for k in used if k in files]:
        if os.path.getsize(files[k][1]) > LIMITS["each"]:
            errors.append("%s is larger than 2.5 MB; the dashboard skips files this large." % files[k][0])

    meta = None
    key = ""
    if "style.json" not in files:
        errors.append("style.json is missing (the style name, tagline, what it looks like, and so on).")
    else:
        raw = data("style.json")
        if len(raw) > LIMITS["json"]:
            errors.append("style.json is too large.")
        else:
            try:
                parsed = json.loads(raw.decode("utf-8-sig"))
                ok = True
            except Exception as e:  # invalid JSON or bad encoding
                errors.append("style.json is not valid JSON (%s)." % e)
                ok = False
            if ok:
                if not isinstance(parsed, dict):
                    errors.append('style.json: "file" is missing or not the right type (it must be one JSON object between { and }).')
                else:
                    for f, mx in REQUIRED_TEXT.items():
                        v = parsed.get(f)
                        if not isinstance(v, str):
                            errors.append('style.json: "%s" is missing or not the right type (text in quotes).' % f)
                        elif length(v.strip()) < 1:
                            errors.append('style.json: "%s" is empty.' % f)
                        elif length(v.strip()) > mx:
                            errors.append('style.json: "%s" is %d characters; the limit is %d.' % (f, length(v.strip()), mx))
                    for f, mx in OPTIONAL_TEXT.items():
                        if f in parsed:
                            v = parsed[f]
                            if not isinstance(v, str):
                                errors.append('style.json: "%s" is not the right type (text in quotes).' % f)
                            elif length(v.strip()) > mx:
                                errors.append('style.json: "%s" is %d characters; the limit is %d.' % (f, length(v.strip()), mx))
                    if "key" in parsed and not isinstance(parsed["key"], str):
                        errors.append('style.json: "key" is not the right type (text in quotes).')
                    for f in BOOL_FIELDS:
                        if f in parsed and not isinstance(parsed[f], bool):
                            errors.append('style.json: "%s" must be true or false (no quotes).' % f)
                    if "defaults" in parsed:
                        d = parsed["defaults"]
                        if not isinstance(d, dict):
                            errors.append('style.json: "defaults" must be an object like {"music": true, "sfx": true, "subtitles": false}.')
                        else:
                            for f in ("music", "sfx", "subtitles"):
                                if f in d and not isinstance(d[f], bool):
                                    errors.append('style.json: "defaults.%s" must be true or false (no quotes).' % f)
                    if not errors:
                        meta = parsed
    template = ""
    if "template.md" not in files:
        errors.append("template.md is missing (the full prompt template for this style).")
    else:
        raw = data("template.md")
        if len(raw) > LIMITS["template"]:
            errors.append("template.md is too large (limit 150 KB).")
        else:
            template = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").strip()
            if length(template) < MIN_TEMPLATE_CHARS:
                errors.append("template.md is too short to be a full style template.")
            missing = [p for p in PLACEHOLDERS if p not in template]
            if missing:
                errors.append("template.md must contain %s (the dashboard fills in these placeholders for each video)." % ", ".join(missing))
            for p in PLACEHOLDERS:
                if template.count(p) > 1:
                    warnings.append("%s appears %d times. The dashboard fills in only the first one, so use each placeholder once." % (p, template.count(p)))
            unknown = sorted(set(re.findall(r"\{\{[^}]*\}\}", template)) - set(PLACEHOLDERS))
            if unknown:
                warnings.append("Unknown placeholders will stay as they are in the prompt: " + ", ".join(unknown))
            if re.search(r"do not use claude code|don't use claude code", template, re.I):
                warnings.append('The template tells Claude not to use Claude Code. Claude Code is the tool that makes the video, so remove that sentence.')
            if re.search(r"MediaRecorder", template):
                warnings.append("The template relies on MediaRecorder for the export. The dashboard renders the MP4 frame by frame instead; remove or replace that part.")
    if not thumb_key:
        errors.append('thumbnail.png is missing (a picture of the style: png, jpg, webp or gif, named "thumbnail").')
    else:
        b = data(thumb_key)
        kind = sniff_image(b)
        name = files[thumb_key][0]
        if not kind:
            errors.append("%s is not a real png, jpg, webp or gif picture." % name)
        elif len(b) > LIMITS["thumbnail"]:
            errors.append("%s is larger than 2 MB." % name)
        else:
            size = image_size(files[thumb_key][1], b, kind)
            if size and abs(size[0] / size[1] - 16 / 9) > 0.02:
                warnings.append("%s is %dx%d. A 16:9 picture such as 1280x720 fits the style card best." % (name, size[0], size[1]))
            if size:
                info.append("Thumbnail: %s, %dx%d, %d KB" % (kind, size[0], size[1], len(b) // 1024))
    if "readme.md" in files:
        if os.path.getsize(files["readme.md"][1]) > LIMITS["readme"]:
            errors.append("README.md is too large.")
    else:
        info.append("README.md is optional and not included.")
    if meta is not None:
        k = (meta.get("key") or "").strip() if isinstance(meta.get("key"), str) else ""
        key = pack_key(k) if k else pack_key(meta["name"].strip())
        if not re.match(r"^pack_[a-z0-9_]{2,30}$", key):
            errors.append("The style needs a name with at least two letters or numbers.")
        else:
            info.append("Style: %s (id %s)" % (meta["name"].strip(), key))
    return errors, warnings, info, key


def main(argv):
    if len(argv) != 2:
        print("Usage: python check_style_pack.py <folder>")
        return 2
    errors, warnings, info, key = check(argv[1])
    print("Checking: " + argv[1])
    for m in info:
        print("  info:    " + m)
    for m in warnings:
        print("  WARNING: " + m)
    for m in errors:
        print("  ERROR:   " + m)
    if errors:
        print("RESULT: NOT READY. Fix the errors above, then run this check again.")
        return 1
    print("RESULT: OK. The dashboard will accept this pack (style id %s)." % key)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
