"""Write shield_tao.json, the pack spec with the shield bearer's clips.
usage: python -I art/rig_shield/anims.py

Poses are limb directions (see tools/rigpose.py). A heavy, slow soldier hunched behind a tall
shield: the shield stands upright in front of him whenever engine/combat.ts counts him as
guarding (standing, walking, the bash up to its strike), and swings down to his side, edge on,
whenever he is open (the bash's recovery, turning round, hit, down), so the opening reads from
the pose. The bash is keyed in ticks to its frame data in engine/content.ts (total 34, active
15-17, stepping in over 12-16): the shield drawn in to the chest, then rammed out at arm's
length. The turn (16 ticks; the facing flips at its end) drops the shield; the client squeezes
the body through edge-on so the flip is not a jump.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from rigpose import Rig, key, loop, once  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose, measured from the split's pivots (make_split.py); leg
# lengths: hip pivot to knee pivot, knee pivot to sole (rest sole at y 1120)
RIG = Rig(
    rest={
        "arm_f_upper": 35, "arm_f_lower": 16, "shield": 180,
        "arm_b_upper": -35, "arm_b_lower": -20,
        "leg_f_thigh": 2, "leg_f_shin": 0, "leg_b_thigh": -7, "leg_b_shin": -2,
    },
    thigh=245, shin=215, weapon="shield",
)
pose = RIG.pose

# behind the shield: the near arm bent, the board upright close in front of the hips,
# the far arm cocked behind (it holds nothing), knees bent and the weight forward
GUARD = dict(torso=10, head=-6, af=(4, 54, 180), ab=(-20, 20), lf=(22, 4), lb=(-20, -14), body=8)
GUARD_IN = dict(GUARD, torso=12, head=-7, af=(2, 52, 180), body=13)
# open: the shield swung down to the side and turned off the line, the arm hanging
OPEN = dict(torso=4, head=-4, af=(-6, 10, 150), ab=(-14, 6), lf=(14, 4), lb=(-14, -10), body=6)
# the bash: drawn in to the chest, shoulder down ...
COIL = dict(torso=-6, head=-10, af=(-4, 40, 186), ab=(-34, -4), lf=(26, 6), lb=(-24, -20), root=(-16, 0), body=12, robe=-4)
# ... and rammed out at arm's length, the whole body behind it
RAM = dict(torso=28, head=4, af=(62, 88, 178), ab=(-60, -40), lf=(52, 14), lb=(-44, -48), root=(28, 0), body=14, robe=8)


def walk():
    # a slow, heavy shuffle behind the shield; the shield barely moves. The client advances it by
    # distance walked (RIG_SIZE in bodyView.ts holds the two steps of these keys at game size)
    a = dict(GUARD, lf=(20, 10), lb=(-16, -26), ab=(-16, 22))
    b = dict(GUARD, lf=(2, 0), lb=(4, -24), body=12)
    c = dict(GUARD, lf=(-14, -26), lb=(18, 10), ab=(-24, 16))
    d = dict(GUARD, lf=(4, -24), lb=(2, 0), body=12)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def down():
    p = pose(torso=4, head=-10, af=(150, 160, 220), ab=(160, 175), lf=(-4, 2), lb=(-10, -4), plant=False)
    p["rotate"]["root"] = -90
    p["translate"]["root"] = [0, -150]
    return p


def clips():
    return {
        "idle": loop(2.0, [key(0, pose(**GUARD)), key(1.0, pose(**GUARD_IN)), key(2.0, pose(**GUARD))]),
        "walk": walk(),
        "bash": once(34, [
            key(0, pose(**GUARD), "ease-out"),
            key(8, pose(**dict(COIL, torso=-2, root=(-10, 0))), "ease-in-out"),
            key(12, pose(**COIL), "ease-in"),
            # the step in starts on 12; the shield hits on the first active tick
            key(14, pose(**dict(RAM, torso=16, af=(40, 76, 182), root=(10, 0)))),
            key(15, pose(**RAM), "ease-out"),
            key(18, pose(**dict(RAM, torso=24, af=(56, 80, 172))), "ease-in-out"),
            # the recovery is the opening: the shield drops away from the line
            key(24, pose(**dict(OPEN, torso=14, af=(10, 30, 140), root=(14, 0))), "ease-in-out"),
            key(34, pose(**GUARD)),
        ]),
        # the shield swung down and the body turning away; the client flips it through edge-on
        "turn": once(16, [
            key(0, pose(**GUARD), "ease-out"),
            key(4, pose(**dict(OPEN, torso=-4, head=-14, lf=(6, 2), lb=(-6, -4))), "ease-in-out"),
            key(12, pose(**dict(OPEN, torso=-2, head=-12, af=(-2, 16, 160), lf=(8, 2), lb=(-8, -4))), "ease-in-out"),
            key(16, pose(**OPEN)),
        ]),
        # knocked back with the shield flung wide
        "hurt": once(6, [
            key(0, pose(**OPEN), "ease-out"),
            key(1, pose(torso=-20, head=-16, af=(-30, 0, 130), ab=(-50, -40), lf=(24, 8), lb=(-8, -12), root=(-20, 0))),
            key(6, pose(torso=-10, head=-8, af=(-14, 6, 140), ab=(-30, -16), lf=(20, 6), lb=(-14, -16), root=(-14, 0))),
        ]),
        "down": once(1, [key(0, down())]),
        "getup": once(10, [
            key(0, pose(torso=30, head=-6, af=(30, 60, 130), ab=(10, 30), lf=(70, -10), lb=(-30, -110), root=(0, 140), body=10, plant=False), "ease-out"),
            key(10, pose(**OPEN)),
        ]),
    }


def main():
    spec = {
        "name": "shield",
        "parts": "parts",
        "rig": "rig.json",
        "origin": [445, 1120],
        "scale": 0.34,
        "animations": clips(),
    }
    with open(os.path.join(HERE, "shield_tao.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)


if __name__ == "__main__":
    main()
