"""Write archer_tao.json, the pack spec with the archer's clips.
usage: python -I art/rig_archer/anims.py

Poses are limb directions (see tools/rigpose.py). A light, upright skirmisher with the bow
held low in the near hand. The shot is keyed in ticks to its frame data in engine/content.ts
(total 34, the arrow leaves on 21): the bow comes up level on the lane, the far hand nocks
and draws to the cheek, holds there (the client pulls the string to that hand and lights the
arrowhead before the release), then the hand flies back off the string. The hop (30 ticks,
airborne: the engine moves the body back and up) tucks the legs and lands in a crouch.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from rigpose import Rig, key, loop, once  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose, measured from the split's pivots (make_split.py); leg
# lengths: hip pivot to knee pivot, knee pivot to sole (rest soles at y 1122-1148)
RIG = Rig(
    rest={
        "arm_f_upper": 26, "arm_f_lower": 21, "bow": 180,
        "arm_b_upper": -22, "arm_b_lower": -14,
        "leg_f_thigh": 6, "leg_f_shin": 2, "leg_b_thigh": -4, "leg_b_shin": 0,
    },
    thigh=245, shin=260, weapon="bow",
)
pose = RIG.pose

# the bow held low and forward, tilted, the free hand loose by the quiver strap
READY = dict(torso=6, head=-4, af=(16, 34, 158), ab=(-12, 8), lf=(14, 4), lb=(-14, -10), body=4)
READY_IN = dict(READY, torso=8, head=-5, af=(14, 32, 156), body=8)
# the draw: bow arm level on the lane, bow upright, the far hand at the cheek, the elbow high behind
AIM = dict(torso=-2, head=6, af=(80, 90, 180), ab=(-100, 88), lf=(26, 8), lb=(-22, -18), body=6)


def walk():
    # a light, long-stepped walk; the client advances it by distance walked (RIG_SIZE in
    # bodyView.ts holds the two steps of these keys at game size), backwards when backing off
    a = dict(READY, lf=(24, 14), lb=(-20, -34), ab=(10, 22), af=(10, 28, 152))
    b = dict(READY, lf=(2, 0), lb=(6, -28), body=7)
    c = dict(READY, lf=(-20, -34), lb=(24, 14), ab=(-26, -16), af=(22, 40, 164))
    d = dict(READY, lf=(6, -28), lb=(2, 0), body=7)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def down():
    p = pose(torso=4, head=-10, af=(150, 160, 230), ab=(160, 175), lf=(-4, 2), lb=(-10, -4), plant=False)
    p["rotate"]["root"] = -90
    p["translate"]["root"] = [0, -150]
    return p


def clips():
    return {
        "idle": loop(1.6, [key(0, pose(**READY)), key(0.8, pose(**READY_IN)), key(1.6, pose(**READY))]),
        "walk": walk(),
        "shoot": once(34, [
            key(0, pose(**READY), "ease-out"),
            # the bow comes up, the far hand reaches for an arrow and nocks it at the string
            key(5, pose(**dict(AIM, af=(70, 84, 178), ab=(30, 80), torso=2)), "ease-in-out"),
            key(8, pose(**dict(AIM, ab=(-20, 90))), "ease-in-out"),
            # drawn to the cheek, then held, a slight creep back as the release nears
            key(14, pose(**AIM), "linear"),
            key(20, pose(**dict(AIM, torso=-4, ab=(-106, 84)))),
            # loose: the drawing hand flies back off the string, the bow arm kicks
            key(21, pose(**dict(AIM, torso=-6, af=(84, 96, 184), ab=(-124, 30))), "ease-out"),
            key(26, pose(**dict(AIM, torso=-2, af=(76, 84, 178), ab=(-110, 20))), "ease-in-out"),
            key(34, pose(**READY)),
        ]),
        "hop": once(30, [
            key(0, pose(**dict(READY, lf=(34, -16), lb=(-4, -50), torso=14)), "ease-out"),
            # pushed off: legs tucked, leaning back the way it flies, arms out for balance
            key(4, pose(torso=-12, head=-2, af=(50, 70, 150), ab=(-60, -30), lf=(70, 10), lb=(40, -40), root=(0, -40), plant=False), "ease-in-out"),
            key(18, pose(torso=-6, head=-4, af=(40, 56, 160), ab=(-40, -10), lf=(30, 10), lb=(-6, -8), root=(0, -10), plant=False), "ease-in"),
            # lands in a crouch and rises back to the ready stance
            key(22, pose(**dict(READY, lf=(40, -18), lb=(-6, -56), torso=16, body=14))),
            key(30, pose(**READY)),
        ]),
        "hurt": once(6, [
            key(0, pose(**READY), "ease-out"),
            key(1, pose(torso=-22, head=-18, af=(-10, 10, 130), ab=(-55, -45), lf=(24, 8), lb=(-8, -12), root=(-20, 0))),
            key(6, pose(torso=-12, head=-8, af=(4, 22, 145), ab=(-36, -22), lf=(20, 6), lb=(-14, -16), root=(-14, 0))),
        ]),
        "down": once(1, [key(0, down())]),
        "getup": once(10, [
            key(0, pose(torso=30, head=-6, af=(40, 70, 140), ab=(10, 30), lf=(70, -10), lb=(-30, -110), root=(0, 140), body=10, plant=False), "ease-out"),
            key(10, pose(**READY)),
        ]),
    }


def main():
    spec = {
        "name": "archer",
        "parts": "parts",
        "rig": "rig.json",
        "origin": [440, 1135],
        "scale": 0.34,
        "animations": clips(),
    }
    with open(os.path.join(HERE, "archer_tao.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)


if __name__ == "__main__":
    main()
