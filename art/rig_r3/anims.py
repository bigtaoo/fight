"""Write hero_tao.json, the pack spec with the hero's clips.
usage: python -I art/rig_r3/anims.py

Poses are limb directions (see tools/rigpose.py). Attack clips are in ticks, keyed to the
frame data in engine/content.ts (windup up to active[0], the cut over the active ticks,
recovery to total).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from rigpose import Rig, key, loop, once  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose (the painting), measured from the split's pivots; leg
# lengths: hip pivot to knee pivot, knee pivot to sole (rest sole at y 1115)
RIG = Rig(
    rest={
        "arm_f_upper": 22, "arm_f_lower": 27, "sword": 52,
        "arm_b_upper": -19, "arm_b_lower": -19,
        "leg_f_thigh": 0, "leg_f_shin": 0, "leg_b_thigh": 0, "leg_b_shin": 0,
    },
    thigh=255, shin=240, extras=("sash", "scarf"),
)
pose = RIG.pose


# Combat poses. Force reads from the whole body, not the arm: a low wide stance, the torso
# thrown into the cut and the back arm swung back against it, a short tick of anticipation
# leaning away from the target, then the cut snaps through and is held past the end before
# the slow recovery. The hit pose lands on the first active tick, which hitstop freezes on.
# The back arm counters in a small range and turns as few times as it can: mashed, the combo
# chains a move every 6 ticks, and a free arm flung 130-240 degrees per move (as it was) reads as
# flailing, moving more than the sword hand. Each move's windup leaves it about where the last
# cut put it; only atk3's two-handed raise takes it overhead.
GUARD = dict(torso=8, head=-4, af=(16, 74, 124), ab=(-20, 10), lf=(24, 4), lb=(-22, -18), body=4, sash=4)
GUARD_IN = dict(GUARD, torso=10, head=-5, af=(12, 70, 118), body=9, sash=7, scarf=2)
HIT1 = dict(torso=26, head=8, af=(72, 78, 58), ab=(-55, -35), lf=(54, 12), lb=(-52, -54), root=(24, 0), body=10, robe=8, sash=34, scarf=-8)
HIT2 = dict(torso=-14, head=-10, af=(150, 165, 175), ab=(-35, 0), lf=(42, 6), lb=(-42, -40), root=(16, 0), body=2, robe=6, sash=-14)
HIT3 = dict(torso=34, head=10, af=(68, 74, 72), ab=(20, 35), lf=(64, 18), lb=(-60, -64), root=(30, 0), body=18, robe=10, sash=44, scarf=-10)
THRUST = dict(torso=34, head=-14, af=(88, 90, 92), ab=(-105, -100), lf=(66, 20), lb=(-68, -76), root=(20, 0), body=6, robe=12, sash=48, scarf=-12)


def walk():
    # one cycle is two steps; the client advances it by distance walked, so the keys only set
    # the shape. Root drops when the legs straddle so the planted foot stays on the ground.
    a = dict(lf=(22, 14), lb=(-20, -38), ab=(20, 35), af=(12, 45, 70), torso=5, sash=6, robe=-2)
    b = dict(lf=(0, 0), lb=(5, -30), ab=(-5, 5), af=(20, 52, 75), torso=6, sash=0)
    c = dict(lf=(-20, -38), lb=(22, 14), ab=(-30, -25), af=(28, 60, 80), torso=5, sash=-6, robe=2)
    d = dict(lf=(5, -30), lb=(0, 0), ab=(-5, 5), af=(20, 52, 75), torso=6, sash=0)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def run():
    # root as given: the body rises in the flight phase instead of keeping a foot down. Leaning
    # into the run, the sword hand trails behind the hip with the blade back and a little down,
    # the arm reaching back so the blade does not seem to come out of the waist; the arms pump
    # against the legs, the sword arm only a little
    common = dict(torso=22, head=-16, plant=False)
    a = dict(common, lf=(42, 22), lb=(-32, -72), root=(0, -6), af=(-52, -78, -100), ab=(28, 70), sash=26, scarf=-6)
    b = dict(common, lf=(12, -18), lb=(10, -60), root=(0, 18), af=(-46, -72, -96), ab=(0, 40), sash=32, scarf=-4)
    c = dict(common, lf=(-32, -72), lb=(42, 22), root=(0, -6), af=(-40, -66, -92), ab=(-40, -10), sash=26, scarf=-6)
    d = dict(common, lf=(10, -60), lb=(12, -18), root=(0, 18), af=(-46, -72, -96), ab=(0, 40), sash=32, scarf=-4)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


JUMP_UP = dict(torso=6, head=-4, lf=(40, -5), lb=(-10, -60), af=(60, 100, 125), ab=(-40, -20), sash=22, scarf=-6, plant=False)
JUMP_DOWN = dict(torso=2, head=-2, lf=(18, 8), lb=(-12, -22), af=(40, 72, 95), ab=(-30, -8), sash=-12, scarf=4, plant=False)


def down():
    # negative leg directions point toward the back, which is the floor once lying
    p = pose(torso=4, head=-10, af=(150, 160, 120), ab=(160, 175), lf=(-4, 2), lb=(-10, -4), plant=False)
    p["rotate"]["root"] = -90
    p["translate"]["root"] = [0, -120]
    return p


def clips():
    return {
        "idle": loop(1.6, [key(0, pose(**GUARD)), key(0.8, pose(**GUARD_IN)), key(1.6, pose(**GUARD))]),
        "walk": walk(),
        "run": run(),
        # not played through: the client picks the time from the vertical speed (0 rising, 1 falling)
        "jump": {"duration": 1, "ease": "ease-in-out", "keys": [key(0, pose(**JUMP_UP)), key(1, pose(**JUMP_DOWN))]},
        # diagonal cut down from over the shoulder
        "atk1": once(11, [
            key(0, pose(**GUARD), "ease-out"),
            key(2, pose(torso=-18, head=-8, af=(170, 200, 240), ab=(-5, 40), lf=(32, 6), lb=(-28, -24), root=(-12, 0), body=6, robe=-4, sash=-8), "ease-in"),
            key(3, pose(torso=14, af=(115, 120, 100), ab=(-30, 10), lf=(40, 8), lb=(-38, -34), body=6, sash=12)),
            key(4, pose(**HIT1), "ease-out"),
            key(7, pose(**dict(HIT1, torso=28, af=(64, 68, 44), body=12)), "ease-in-out"),
            key(11, pose(**GUARD)),
        ]),
        # rising backhand from low behind
        "atk2": once(12, [
            key(0, pose(**HIT1), "ease-out"),
            key(2, pose(torso=26, head=4, af=(0, 12, -40), ab=(-45, -20), lf=(46, 14), lb=(-42, -40), body=12, sash=20), "ease-in"),
            key(3, pose(torso=10, af=(80, 95, 110), ab=(-40, -10), lf=(40, 10), lb=(-40, -36), body=6, sash=8)),
            key(4, pose(**HIT2), "ease-out"),
            key(7, pose(**dict(HIT2, af=(160, 178, 190))), "ease-in-out"),
            key(12, pose(**GUARD)),
        ]),
        # the finisher: both hands over the head, rise, slam down into a deep lunge
        "atk3": once(18, [
            key(0, pose(**HIT2), "ease-out"),
            key(3, pose(torso=-26, head=-12, af=(195, 215, 250), ab=(110, 135), lf=(20, 0), lb=(-16, -12), root=(-14, -18), robe=-4, sash=-12), "ease-in"),
            key(4, pose(torso=10, af=(140, 135, 130), ab=(75, 95), lf=(40, 10), lb=(-40, -40), body=6)),
            key(5, pose(**HIT3), "ease-out"),
            key(11, pose(**dict(HIT3, torso=32, af=(62, 66, 62), body=14, sash=34)), "ease-in-out"),
            key(18, pose(**GUARD)),
        ]),
        "jumpAtk": once(14, [
            key(0, pose(**JUMP_UP), "ease-out"),
            key(1, pose(**dict(JUMP_UP, torso=-10, af=(170, 195, 230), ab=(20, 40))), "ease-in"),
            key(2, pose(**dict(JUMP_UP, torso=10, af=(120, 115, 110)))),
            key(4, pose(**dict(JUMP_UP, torso=30, head=6, af=(30, 40, -10), ab=(-70, -60), lf=(60, -20), lb=(-20, -70), sash=30)), "ease-out"),
            key(8, pose(**dict(JUMP_UP, torso=26, af=(26, 36, -20), ab=(-60, -50), lf=(50, -10), lb=(-20, -60), sash=24)), "ease-in-out"),
            key(14, pose(**JUMP_DOWN)),
        ]),
        # crouch with the blade low, then rip it up and rise onto the toes
        "upper": once(20, [
            key(0, pose(**GUARD), "ease-out"),
            key(3, pose(torso=30, head=6, af=(-6, 6, -45), ab=(-30, -10), lf=(55, -5), lb=(-40, -60), body=14, sash=24), "ease-in"),
            key(4, pose(torso=8, af=(85, 100, 120), ab=(-40, -25), lf=(30, 0), lb=(-24, -24), root=(0, -10))),
            key(6, pose(torso=-18, head=-12, af=(175, 185, 195), ab=(-60, -50), lf=(14, 10), lb=(-30, -40), root=(0, -30), sash=-20, scarf=6), "ease-out"),
            key(13, pose(torso=-14, head=-10, af=(170, 180, 190), ab=(-55, -45), lf=(14, 10), lb=(-28, -36), root=(0, -10), sash=-12)),
            key(20, pose(**GUARD)),
        ]),
        # chamber the blade at the hip, then a flat lunging thrust
        "dash": once(18, [
            key(0, pose(**GUARD), "ease-out"),
            key(2, pose(torso=-6, head=-4, af=(-40, 40, 90), ab=(40, 70), lf=(30, 0), lb=(-20, -20), body=4), "ease-in"),
            key(3, pose(**THRUST)),
            key(10, pose(**dict(THRUST, torso=36, sash=50)), "ease-in-out"),
            key(18, pose(**GUARD)),
        ]),
        # snapped back at the waist, the head whipped, knocked a step back
        "hurt": once(6, [
            key(0, pose(**GUARD), "ease-out"),
            key(1, pose(torso=-24, head=-18, af=(-30, -10, 20), ab=(-60, -50), lf=(26, 8), lb=(-8, -12), root=(-20, 0), sash=24, scarf=8)),
            key(6, pose(torso=-14, head=-8, af=(0, 20, 45), ab=(-40, -25), lf=(22, 6), lb=(-14, -16), root=(-14, 0), sash=10)),
        ]),
        # lying on the back, head toward the attacker's side: the whole figure turned onto its back
        "down": once(1, [key(0, down())]),
        "getup": once(10, [
            key(0, pose(torso=28, head=-6, af=(40, 70, 60), ab=(10, 30), lf=(70, -10), lb=(-30, -110), root=(0, 150), body=10, plant=False), "ease-out"),
            key(10, pose(**GUARD)),
        ]),
    }


def main():
    spec = {
        "name": "hero",
        "parts": "parts",
        "rig": "rig.json",
        "origin": [450, 1115],
        "scale": 0.34,
        "animations": clips(),
    }
    with open(os.path.join(HERE, "hero_tao.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)


if __name__ == "__main__":
    main()
