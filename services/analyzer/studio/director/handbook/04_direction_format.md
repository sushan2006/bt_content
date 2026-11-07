# The direction you write

Reply with one JSON object (inside a ```json block), nothing else after it:
```
{
  "style": "<the style you were asked for>",
  "corrections": {"misheard": "correct", ...},
  "drop_words": [<word ids to cut>],
  "emphasis": ["<key words for big captions>"],
  "headline": "<short hook title for the post, 3-7 words>",
  "pace": <optional: seconds between camera framing changes, only to override the style>,
  "sound_level": "minimal",
  "assets": [<kit assets you build for this video>],
  "beats": [
    {"kind": "explainer", "start_word": 41, "end_word": 58, "asset": "transformer", "camera": "orbit", "transition_in": "zoom", "transition_out": "cut", "sound": "accent",
     "actions": [{"do": "flow", "flow": "current_in", "at_word": 44}, {"do": "label", "target": "core", "title": "Iron core", "sub": "guides the field", "at_word": 47}],
     "reason": "shows how the current enters the primary winding"},
    {"kind": "object", "start_word": 60, "end_word": 70, "asset": "library:smart_meter", "enter": "rise", "side": "right", "actions": [...], "reason": "..."},
    {"kind": "text_behind", "start_word": 3, "end_word": 6, "lines": ["SMART", "METER"], "reason": "..."},
    {"kind": "number", "start_word": 80, "end_word": 84, "value": 30, "suffix": "%", "label": "lower bills", "reason": "..."},
    {"kind": "statement", "start_word": 90, "end_word": 95, "lines": ["NO MORE", "GUESSWORK"], "highlight": ["GUESSWORK"], "transition_in": "cut", "transition_out": "fade", "sound": "none", "reason": "..."},
    {"kind": "machine", "start_word": 96, "end_word": 99, "asset": "machine:2", "enter": "rise", "side": "left", "reason": "he names our TankSync controller"},
    {"kind": "list", "start_word": 100, "end_word": 120, "items": [{"label": "Live usage", "at_word": 103}, {"label": "Alerts", "at_word": 110}], "reason": "..."},
    {"kind": "diagram", "start_word": 121, "end_word": 140, "title": "How the data travels", "layout": "column",
     "nodes": [{"id": "meter", "label": "Meter", "sub": "reads every second", "icon": "zap", "at_word": 122}, {"id": "cloud", "label": "Cloud", "icon": "cloud", "at_word": 130}],
     "links": [{"from": "meter", "to": "cloud", "kind": "data", "at_word": 128}], "reason": "..."},
    {"kind": "chapter", "start_word": 141, "end_word": 143, "number": "Part 2", "title": "The savings", "reason": "..."}
  ],
  "notes": ["<2-5 short sentences for the reviewers: the idea of the edit and anything they should check>"],
  "metadata": {"title": "<post title>", "caption": "<1-2 sentence post caption>", "hashtags": ["#..."]}
}
```
Checks the engine makes (and sends back to you if they fail): word ids exist and start ≤ end; beat lengths within the limits; no overlaps between full-screen beats or between objects; every asset referenced exists and is valid (unique part ids, required sizes present); labels and actions point at existing parts or groups; diagrams have 2–6 nodes and valid links; text_behind lines are ≤ 12 letters.
Beats are listed in time order.
`transition_in`, `transition_out` (cut | whip | fade | zoom) apply to full-screen beats; `sound` (auto | none | accent) to any beat; leave them out to use the style's choice.
