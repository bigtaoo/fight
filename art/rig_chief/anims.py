"""Write chief_tao.json, the pack spec with the chief's clips.
usage: python -I art/rig_chief/anims.py

Poses are limb directions (see tools/rigpose.py). A huge, slow brute with a long-hafted axe
on his shoulder. Every move comes in two speeds (engine/content.ts chiefMoves: the "F" moves
of the second phase have their windups and recoveries at 65 percent), so each clip is built
by a function of that percentage with the engine's own rounding, and its keys land on the
same ticks as the frame data:
  chop    windup W=28, active W+1..W+4, lunging W-2..W+2, recovery 28: the axe hauled up
          overhead and back and held there (the cue to get out of the way), then one chop
          that buries the head in the floor in front.
  charge  windup W=24, then 30 ticks dashing (active), recovery 26: the shoulder dropped, the
          axe trailed low behind, a pawing stamp, then a running charge that skids to a stop.
  slam    a crouch of 20 with the axe drawn back; slamAir, the leap (up 36 against gravity
          3.6: about 20 ticks in the air), with the legs tucked and the axe swung up over the
          head and down as it falls; slamLand (30), the axe slammed into the floor on tick 1,
          where the shockwaves leave, then rising out of the crouch.
  roar    40 ticks: rearing up, the arms flung wide and the axe raised, shaking.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from rigpose import Rig, key, loop, once  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose, measured from the split's pivots (make_split.py); leg
# lengths: hip pivot to knee pivot, knee pivot to sole (rest soles at y 1095-1115)
RIG = Rig(
    rest={
        "arm_f_upper": 15, "arm_f_lower": 34, "sword": 20,
        "arm_b_upper": -27, "arm_b_lower": -17,
        "leg_f_thigh": 12, "leg_f_shin": -2, "leg_b_thigh": -5, "leg_b_shin": -2,
    },
    thigh=174, shin=230,
)
pose = RIG.pose

# the axe on the near shoulder, its head up behind him; the free fist hanging heavy
GUARD = dict(torso=6, head=-4, af=(-8, 146, 208), ab=(-18, -6), lf=(14, 6), lb=(-14, -12), body=6)
GUARD_IN = dict(GUARD, torso=8, head=-5, af=(-8, 144, 205), body=12)
# the chop's top: leaning back, the axe overhead and back, the free arm thrown forward
WINDUP = dict(torso=-14, head=-10, af=(172, 196, 232), ab=(30, 58), lf=(26, 6), lb=(-24, -24), root=(-14, 0), body=8, robe=-6)
CHOP = dict(torso=32, head=6, af=(72, 74, 52), ab=(-60, -40), lf=(46, 10), lb=(-44, -48), root=(24, 0), body=18, robe=10)
# the charge: the shoulder dropped, the axe trailing low behind, the free fist leading
CHARGE = dict(torso=28, head=14, af=(-34, -14, 260), ab=(46, 76), lf=(34, 2), lb=(-30, -42), root=(-8, 0), body=18, robe=6)
# the slam's crouch, the axe drawn back over the shoulder; and its landing, the head buried in
# the floor in front
CROUCH = dict(torso=26, head=10, af=(150, 176, 226), ab=(-70, -40), lf=(66, -16), lb=(30, -62), body=26, robe=8)
LAND = dict(torso=40, head=10, af=(70, 70, 44), ab=(-50, -20), lf=(70, -10), lb=(-6, -76), body=30, robe=12)
ROAR = dict(torso=-16, head=-24, af=(130, 156, 200), ab=(-124, -150), lf=(22, 4), lb=(-22, -18), body=-6, robe=-6)


def t(n, pct):
    """The engine's tick rounding (chiefMoves in engine/content.ts)."""
    return n * pct // 100


def chop(pct):
    w, r = t(28, pct), t(28, pct)
    return once(w + 4 + r, [
        key(0, pose(**GUARD), "ease-out"),
        # hauls the axe off the shoulder and up, then holds it back, straining a little
        key(t(10, pct), pose(**dict(WINDUP, torso=-6, af=(150, 180, 220), root=(-6, 0))), "ease-out"),
        key(t(18, pct), pose(**WINDUP), "ease-in-out"),
        key(w - 3, pose(**dict(WINDUP, torso=-20, af=(184, 210, 248), root=(-20, 0))), "ease-in"),
        # the lunge starts on w-2; the axe comes over and lands on the first active tick
        key(w - 1, pose(torso=10, af=(140, 140, 150), ab=(-20, 0), lf=(38, 8), lb=(-36, -36), root=(6, 0), body=10)),
        key(w + 1, pose(**CHOP), "ease-out"),
        key(w + 4 + t(12, pct), pose(**dict(CHOP, torso=34, af=(66, 68, 44), body=20)), "ease-in-out"),
        key(w + 4 + r, pose(**GUARD)),
    ])


def charge(pct):
    w, r, dash = t(24, pct), t(26, pct), 30
    run = []
    # a running stride every 10 ticks of the dash: front leg reaching, passing, back leg
    # reaching, passing
    for i in range(3):
        at = w + 1 + 10 * i
        run += [
            key(at, pose(**dict(CHARGE, lf=(44, 10), lb=(-36, -64)))),
            key(at + 2.5, pose(**dict(CHARGE, lf=(4, -6), lb=(26, -50), body=12))),
            key(at + 5, pose(**dict(CHARGE, lf=(-36, -64), lb=(44, 10)))),
            key(at + 7.5, pose(**dict(CHARGE, lf=(26, -50), lb=(4, -6), body=12))),
        ]
    return once(w + dash + r, [
        key(0, pose(**GUARD), "ease-out"),
        key(t(8, pct), pose(**dict(CHARGE, torso=18, body=12)), "ease-in-out"),
        # a stamp of the front foot, then set
        key(t(14, pct), pose(**dict(CHARGE, lf=(40, -30), root=(-8, -40), plant=False)), "ease-in"),
        key(t(18, pct), pose(**CHARGE), "ease-in-out"),
        *run,
        # skids to a stop braced on the front leg, leaning back, then straightens
        key(w + dash + 2, pose(**dict(CHARGE, torso=-6, head=0, lf=(44, 20), lb=(-20, -30), af=(-20, 0, 280), body=14)), "ease-out"),
        key(w + dash + t(12, pct), pose(**dict(GUARD, torso=0, lf=(30, 14), body=12)), "ease-in-out"),
        key(w + dash + r, pose(**GUARD)),
    ])


def slam(pct):
    return once(t(20, pct), [
        key(0, pose(**GUARD), "ease-out"),
        key(t(8, pct), pose(**dict(CROUCH, body=14, lf=(40, -10), lb=(10, -40))), "ease-in-out"),
        key(t(20, pct), pose(**CROUCH)),
    ])


def slam_air():
    # the leap is the same in both phases (only its crouch and landing are quicker)
    air = dict(plant=False)
    return once(90, [
        # pushed off: legs straightening under him, the axe still back
        key(0, pose(**dict(CROUCH, torso=10, lf=(20, 0), lb=(-10, -20), root=(0, 0)), **air), "ease-out"),
        # tucked at the rise, the axe swung up over the head and back
        key(5, pose(torso=-10, head=-6, af=(176, 200, 240), ab=(-80, -40), lf=(70, 6), lb=(40, -40), root=(0, -30), body=6, **air), "ease-in-out"),
        key(12, pose(torso=-14, head=-8, af=(184, 210, 252), ab=(-90, -50), lf=(62, 4), lb=(30, -44), root=(0, -30), body=6, **air), "ease-in"),
        # falling: the axe coming over, the legs reaching for the floor
        key(19, pose(torso=16, head=4, af=(130, 130, 140), ab=(-50, -30), lf=(40, 0), lb=(-10, -30), root=(0, -10), body=10, **air)),
    ])


def slam_land(pct):
    r = t(30, pct)
    return once(r, [
        key(0, pose(**dict(LAND, af=(90, 90, 80), body=20))),
        key(1, pose(**LAND), "ease-out"),
        key(t(14, pct), pose(**dict(LAND, torso=36, body=26)), "ease-in-out"),
        key(r, pose(**GUARD)),
    ])


def roar():
    shake = [key(10 + 4 * i, pose(**dict(ROAR, torso=ROAR["torso"] + (3 if i % 2 else -3), head=ROAR["head"] + (2 if i % 2 else -2))))
             for i in range(7)]
    return once(40, [
        key(0, pose(**GUARD), "ease-out"),
        key(4, pose(**dict(GUARD, torso=20, head=10, body=18)), "ease-in-out"),
        key(10, pose(**ROAR), "linear"),
        *shake,
        key(40, pose(**GUARD)),
    ])


def walk():
    # a heavy, short-stepped stomp; the client advances it by distance walked (RIG_SIZE in
    # bodyView.ts holds the two steps of these keys at game size)
    a = dict(GUARD, lf=(16, 8), lb=(-14, -26), ab=(8, 22), robe=-3)
    b = dict(GUARD, lf=(0, 0), lb=(4, -24), ab=(-12, 0), body=14)
    c = dict(GUARD, lf=(-14, -26), lb=(16, 8), ab=(-30, -20), robe=3)
    d = dict(GUARD, lf=(4, -24), lb=(0, 0), ab=(-12, 0), body=14)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def down():
    # lying on the back, head toward the attacker's side: the whole figure turned onto its back
    p = pose(torso=4, head=-10, af=(150, 160, 130), ab=(160, 175), lf=(-4, 2), lb=(-10, -4), plant=False)
    p["rotate"]["root"] = -90
    p["translate"]["root"] = [0, -170]
    return p


def clips():
    out = {
        "idle": loop(2.2, [key(0, pose(**GUARD)), key(1.1, pose(**GUARD_IN)), key(2.2, pose(**GUARD))]),
        "walk": walk(),
        "slamAir": slam_air(),
        "slamAirF": slam_air(),
        "roar": roar(),
        # snapped back at the waist, the head whipped, knocked a step back
        "hurt": once(6, [
            key(0, pose(**GUARD), "ease-out"),
            key(1, pose(torso=-18, head=-16, af=(-10, 60, 120), ab=(-50, -40), lf=(22, 8), lb=(-8, -12), root=(-16, 0))),
            key(6, pose(torso=-10, head=-8, af=(0, 100, 170), ab=(-34, -20), lf=(18, 6), lb=(-14, -16), root=(-12, 0))),
        ]),
        "down": once(1, [key(0, down())]),
        "getup": once(10, [
            key(0, pose(torso=30, head=-6, af=(40, 70, 60), ab=(10, 30), lf=(70, -10), lb=(-30, -110), root=(0, 160), body=10, plant=False), "ease-out"),
            key(10, pose(**GUARD)),
        ]),
    }
    for sfx, pct in (("", 100), ("F", 65)):
        out[f"chop{sfx}"] = chop(pct)
        out[f"charge{sfx}"] = charge(pct)
        out[f"slam{sfx}"] = slam(pct)
        out[f"slamLand{sfx}"] = slam_land(pct)
    return out


def main():
    spec = {
        "name": "chief",
        "parts": "parts",
        "rig": "rig.json",
        "origin": [455, 1112],
        "scale": 0.34,
        "animations": clips(),
    }
    with open(os.path.join(HERE, "chief_tao.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)


if __name__ == "__main__":
    main()
