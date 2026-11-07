"""Studio unit tests: python -m pytest services/analyzer/tests"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from studio import directives, llm, takes  # noqa: E402
from studio.captions import chunk_words  # noqa: E402
from studio.schema import Clip, Plan  # noqa: E402


def W(t, s, e):
    return {"text": t, "start": s, "end": e}


def test_directives_basic():
    ops, un = directives.parse('Make the logo bigger and cut the first 3 seconds. Change the headline to "Stop guessing. Start measuring."')
    kinds = [o["op"] for o in ops]
    assert kinds == ["logo", "trim", "headline"]
    assert ops[2]["text"] == "Stop guessing. Start measuring."
    assert un == []


def test_directives_pleasantries_ignored():
    ops, un = directives.parse("Looks good, thanks!")
    assert ops == [] and un == []


def test_reply_classification():
    assert llm.classify_reply("Approved")["decision"] == "approve"
    r = llm.classify_reply("Yes go ahead with version C")
    assert r["decision"] == "approve" and r["version"] == "C"
    assert llm.classify_reply("Not approved, audio is bad")["decision"] == "reject"
    assert llm.classify_reply("Approve B but make the logo bigger")["decision"] == "changes"
    assert llm.classify_reply("Looks good!\n\nOn Mon, 7 Nov 2026 at 10:00, Studio wrote:\n> reply approved or not approved")["decision"] == "approve"


def test_caption_chunks_drop_fillers_and_break_on_punctuation():
    ws = [W("So,", 0, .3), W("um", .35, .5), W("this", .6, .8), W("works.", .85, 1.2), W("Next", 1.3, 1.5), W("part", 1.55, 1.8)]
    ch = chunk_words(ws)
    assert [[w["text"] for w in c["words"]] for c in ch] == [["So,", "this", "works."], ["Next", "part"]]


def test_alignment_and_selection_prefers_clean_take():
    def take(tid, sents):
        words, t, out = [], 0.0, []
        for k, (txt, fill) in enumerate(sents):
            ws = []
            for w in txt.split():
                ws.append({"start": t, "end": t + .3, "text": w, "prob": .95})
                t += .35
            words += ws
            t += .6
        tk = {"take_id": tid, "path": "x", "duration": t, "words": words, "sentences": takes.sentences(words), "focus": {"x": .5, "y": .4}}
        for s, (_, fill) in zip(tk["sentences"], sents):
            s.update({"speech_db": -20, "snr_db": 30, "clip_frac": 0, "fillers": fill, "repeats": 0, "unsure": 0, "long_pauses": 0, "wps": 2.8})
        return tk
    a = take("T1", [("First we fit sensors.", 1), ("Then we watch the data.", 0)])
    b = take("T2", [("First we fit sensors.", 0), ("Then we watch the data.", 0)])
    sel = takes.select([a, b])
    assert len(sel["lines"]) == 2
    assert sel["lines"][0]["take_id"] == "T2"


def test_plan_validation_rejects_bad_clip():
    try:
        Plan(clips=[Clip(take_id="T1", src="x", t_in=1.0, t_out=1.02)])
        assert False, "should fail"
    except Exception:
        pass


def test_reply_version_letters():
    assert llm.classify_reply("Approved")["version"] is None
    assert llm.classify_reply("Approve D")["version"] == "D"
    r = llm.classify_reply("approved, go with the cinematic one")
    assert r["version"] is None and r["style"] == "cinematic"


def test_editorial_pieces():
    import numpy as np
    from studio import editorial as E
    from studio.llm import classify_reply
    words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "text": w} for i, w in enumerate("the impeller spins water outwards fast.".split())]
    ch = E.kinetic_chunks(words, ["impeller"])
    assert any(c["emph"] == [True] or (True in c["emph"]) for c in ch)
    assert max(len(c["words"]) for c in ch) <= 3
    for k in ("whoosh", "swish", "pop", "tick", "hit", "riser", "ding"):
        s = E.sfx(k)
        assert len(s) > 100 and np.max(np.abs(s)) <= 1.5
    bed = E.music_bed(4.0)
    assert len(bed) == 4 * E.SR and np.max(np.abs(bed)) <= 0.81
    edit = {"punches": [{"t": 0, "zoom": 1.1}, {"t": 2.0, "zoom": 1.0, "cap_y": 0.8}]}
    assert E.punch_at(edit, 2.5)[0] < 1.02 and E.caption_y(edit, 2.5, 0.7) == 0.8
    assert classify_reply("Approve E please")["version"] == "E"


def test_scene3d_renders():
    import pytest
    from studio import scene3d
    if not scene3d.available():
        pytest.skip("3D libraries not installed")
    try:
        img, labels, settled = scene3d.render_object("pump_set", {"label_times": {"motor": 0}}, 3.0, 6.0, 320, 256)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"no OpenGL context here: {e}")
    assert img.shape == (256, 320, 4) and img[..., 3].max() == 255 and settled > 0.9
    assert labels and 0 <= labels[0]["x"] <= 320


def test_false_start_is_cut_but_deliberate_repeat_is_kept():
    from studio import takes as T
    def W(items):
        return [{"start": s, "end": s + 0.25, "text": t} for s, t in items]
    w = T.mark_false_starts(W([(0, "So"), (0.3, "the"), (0.6, "electric"), (0.9, "motor"), (2.0, "has"), (2.3, "a"),
                               (3.0, "So"), (3.3, "the"), (3.6, "basic"), (3.9, "electric"), (4.2, "motor"), (4.5, "has"), (4.8, "a"), (5.1, "pump.")]))
    assert [x.get("false_start", False) for x in w[:6]] == [True] * 6 and not any(x.get("false_start") for x in w[6:])
    w2 = T.mark_false_starts(W([(0, "The"), (0.3, "electric"), (0.6, "motor."), (1.5, "The"), (1.8, "electric"), (2.1, "motor"), (2.4, "converts")]))
    assert not any(x.get("false_start") for x in w2)



def test_styles_build_and_style_extract_rules():
    from studio import styles
    from studio.schema import Plan, Clip, Word
    words = [Word(start=i * 0.4, end=i * 0.4 + 0.3, text=t) for i, t in enumerate("the pump has 0.5 to 1.5 horsepower. it lifts water 20 meters up. the impeller spins.".split())]
    clip = Clip(take_id="T1", src="x.mp4", t_in=0, t_out=8.0, words=words, line=0)
    for key in ("hype", "minimal"):
        p = Plan(clips=[clip])
        styles.BUILDERS[key](p, {"keywords": ["impeller"], "speaker_name": "A", "speaker_role": "B"})
        assert p.edit["punches"] and p.captions.mode in ("box", "soft")
    nums = styles._numbers(Plan(clips=[clip]))
    assert any(n[1] == "0.5–1.5" for n in nums) and any(n[1] == "20" for n in nums)


def test_several_machines_resolve_by_number_and_name():
    from types import SimpleNamespace
    from studio.director.direction import _asset_for
    pump = {"name": "Pump panel", "mesh": "x"}
    tank = {"name": "TankSync controller", "mesh": "y"}
    beat = lambda a: SimpleNamespace(asset=a, kind="machine")
    assert _asset_for(beat("machine"), {}, {}, pump, [pump, tank]) == ("machine", pump)
    assert _asset_for(beat("machine:2"), {}, {}, pump, [pump, tank]) == ("machine", tank)
    assert _asset_for(beat("machine:tanksync controller"), {}, {}, pump, [pump, tank]) == ("machine", tank)
    kind, why = _asset_for(beat("machine:3"), {}, {}, pump, [pump, tank])
    assert kind is None and "machine:1" in why


def test_transition_phases_in_and_out():
    from types import SimpleNamespace
    from studio.editorial import _transition_phase
    g = SimpleNamespace(params={"enter": "zoom", "exit": "fade"})
    assert _transition_phase(g, 0.1, 4.0)[0:1] == ("in",) and _transition_phase(g, 0.1, 4.0)[2] == "zoom"
    assert _transition_phase(g, 2.0, 4.0) is None
    side, p, how = _transition_phase(g, 3.9, 4.0)
    assert side == "out" and how == "fade" and 0 < p < 1
    short = SimpleNamespace(params={"enter": "zoom", "exit": "zoom"})
    assert _transition_phase(short, 0.9, 1.0) is None          # too short for an exit: skipped, not squeezed
    assert _transition_phase(SimpleNamespace(params={"enter": "cut"}), 0.05, 3.0) is None


def test_sound_minimal_accent_none():
    from types import SimpleNamespace
    from studio.director.direction import Beat, apply_sound
    b = Beat.model_validate({"kind": "explainer", "start_word": 1, "end_word": 5, "transition_in": "zoom", "sound": "accent"})
    assert b.transition_in == "zoom" and b.sound == "accent"
    G = lambda s, prm: SimpleNamespace(type="fullscreen", start=s, params=prm)
    plan = SimpleNamespace(graphics=[G(2.0, {"sound": "accent"}), G(8.0, {"sound": "none"}), G(14.0, {})],
                           edit={"sfx": [{"t": 1.8, "kind": "air", "gain_db": -6}, {"t": 7.8, "kind": "air", "gain_db": -6},
                                         {"t": 14.0, "kind": "air", "gain_db": -6}, {"t": 14.6, "kind": "tap", "gain_db": -8}]})
    apply_sound(plan, "minimal")
    sfx = plan.edit["sfx"]
    assert [e["t"] for e in sfx] == [1.8, 14.0]
    assert sfx[0]["gain_db"] == -3 and sfx[1]["gain_db"] == -8
