"""Write bandit_tao.json, the pack spec with the bandit's clips.
usage: python -I art/rig_bandit/anims.py

Poses are limb directions (see tools/rigpose.py). The slash is in ticks, keyed to its frame
data in engine/content.ts (total 40, active 17-19, lunging forward over 15-18): a long, readable
windup with the dao hauled back over the shoulder, which is the player's cue to get out of
the way or hit first, then one heavy chop. A brute, not a fencer: hunched, elbows out, the
weight sunk into the back foot until it commits.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from rigpose import Rig, key, loop, once  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose, measured from the split's pivots; leg lengths: hip pivot
# to knee pivot, knee pivot to sole (rest sole at y 1112)
RIG = Rig(
    rest={
        "arm_f_upper": 15, "arm_f_lower": 23, "sword": 40,
        "arm_b_upper": -16, "arm_b_lower": 2,
        "leg_f_thigh": 1, "leg_f_shin": 2, "leg_b_thigh": -6, "leg_b_shin": -5,
    },
    thigh=235, shin=225,
)
pose = RIG.pose

# the dao held low with the blade pointing forward out of the fist (a blade hanging along the
# forearm's line reads as about to slip out of the fingers), the free hand loose at the side
GUARD = dict(torso=12, head=-8, af=(30, 60, 100), ab=(-14, 10), lf=(20, 4), lb=(-18, -14), body=6)
GUARD_IN = dict(GUARD, torso=14, head=-9, af=(26, 56, 96), body=11)
WINDUP = dict(torso=-16, head=-12, af=(185, 215, 245), ab=(40, 70), lf=(30, 8), lb=(-26, -24), root=(-16, 0), body=6, robe=-6)
CHOP = dict(torso=34, head=6, af=(82, 84, 66), ab=(-80, -95), lf=(50, 12), lb=(-46, -50), root=(26, 0), body=14, robe=10)


def walk():
    # a heavy, short-stepped walk; the client advances it by distance walked (WALK_CYCLE in
    # bodyView.ts is the two steps of these keys at game size)
    a = dict(GUARD, lf=(18, 10), lb=(-16, -30), ab=(14, 30), af=(26, 56, 96), robe=-3)
    b = dict(GUARD, lf=(0, 0), lb=(4, -26), ab=(-4, 6), af=(30, 60, 100), body=10)
    c = dict(GUARD, lf=(-16, -30), lb=(18, 10), ab=(-24, -18), af=(34, 64, 104), robe=3)
    d = dict(GUARD, lf=(4, -26), lb=(0, 0), ab=(-4, 6), af=(30, 60, 100), body=10)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def down():
    # lying on the back, head toward the attacker's side: the whole figure turned onto its back
    p = pose(torso=4, head=-10, af=(150, 160, 120), ab=(160, 175), lf=(-4, 2), lb=(-10, -4), plant=False)
    p["rotate"]["root"] = -90
    p["translate"]["root"] = [0, -150]
    return p


def clips():
    return {
        "idle": loop(1.8, [key(0, pose(**GUARD)), key(0.9, pose(**GUARD_IN)), key(1.8, pose(**GUARD))]),
        "walk": walk(),
        "slash": once(40, [
            key(0, pose(**GUARD), "ease-out"),
            # hauls the dao up and back over the shoulder, then holds it there, shaking a little
            key(8, pose(**dict(WINDUP, torso=-10, af=(170, 200, 230), root=(-10, 0))), "ease-out"),
            key(13, pose(**WINDUP), "ease-in-out"),
            key(15, pose(**dict(WINDUP, torso=-20, af=(195, 225, 255), root=(-18, 0))), "ease-in"),
            # the lunge starts on 15; the chop lands on the first active tick
            key(16, pose(torso=10, af=(140, 140, 140), ab=(-20, 0), lf=(40, 10), lb=(-36, -36), root=(8, 0), body=8)),
            key(17, pose(**CHOP), "ease-out"),
            key(26, pose(**dict(CHOP, torso=36, af=(70, 72, 46), body=16)), "ease-in-out"),
            key(40, pose(**GUARD)),
        ]),
        # snapped back at the waist, the head whipped, knocked a step back
        "hurt": once(6, [
            key(0, pose(**GUARD), "ease-out"),
            key(1, pose(torso=-22, head=-18, af=(-20, 0, 70), ab=(-55, -45), lf=(24, 8), lb=(-8, -12), root=(-20, 0))),
            key(6, pose(torso=-12, head=-8, af=(10, 30, 85), ab=(-36, -22), lf=(20, 6), lb=(-14, -16), root=(-14, 0))),
        ]),
        "down": once(1, [key(0, down())]),
        "getup": once(10, [
            key(0, pose(torso=30, head=-6, af=(40, 70, 60), ab=(10, 30), lf=(70, -10), lb=(-30, -110), root=(0, 140), body=10, plant=False), "ease-out"),
            key(10, pose(**GUARD)),
        ]),
    }


def main():
    spec = {
        "name": "bandit",
        "parts": "parts",
        "rig": "rig.json",
        "origin": [445, 1112],
        "scale": 0.34,
        "animations": clips(),
    }
    with open(os.path.join(HERE, "bandit_tao.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)


if __name__ == "__main__":
    main()
