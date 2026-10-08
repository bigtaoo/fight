"""Write hero_tao.json, the pack spec with the hero's clips.
usage: python -I art/rig_r3/anims.py

Poses are written as absolute limb directions, not bone rotations, because that is how a pose
is thought about ("sword straight up") and it keeps a key valid when its parent changes.
A direction is in degrees from straight down, positive toward the facing side (+x): 0 hangs
down, 90 points forward, 180 points up, -90 points back. pose() turns them into the clockwise
bone rotations pack_tao.py wants. Attack clips are in ticks, keyed to the frame data in
engine/content.ts (windup up to active[0], the cut over the active ticks, recovery to total).
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# limb directions of the rest pose (the painting), measured from the split's pivots
REST = {
    "arm_f_upper": 16, "arm_f_lower": 27, "sword": 52,
    "arm_b_upper": -19, "arm_b_lower": -19,
    "leg_f_thigh": 0, "leg_f_shin": 0, "leg_b_thigh": 0, "leg_b_shin": 0,
}


# leg lengths in painting pixels: hip pivot to knee pivot, knee pivot to sole (rest sole at y 1115)
THIGH, SHIN = 255, 240


def planted(lf, lb):
    """Root drop that keeps the lower foot on the ground for these leg directions."""
    def drop(d):
        return THIGH * (1 - math.cos(math.radians(d[0]))) + SHIN * (1 - math.cos(math.radians(d[1])))
    return round(min(drop(lf), drop(lb)), 1)


def chain(names, dirs, base=0.0):
    """Bone rotations that point each bone of a parent -> child chain along `dirs`; `base`
    is the rotation the chain's parent already has."""
    out, acc = {}, base
    for n, d in zip(names, dirs):
        if d is None:
            continue
        r = REST[n] - d - acc
        out[n] = round(r, 1)
        acc += r
    return out


def pose(torso=4, head=-2, af=(25, 55, 75), ab=(-10, 8), lf=(6, 3), lb=(-6, -5),
         root=None, body=0, robe=0, sash=0, scarf=0, hand_f=0, plant=True):
    """One key. af: front arm (upper, forearm, sword); ab: back arm (upper, forearm);
    lf/lb: front/back leg (thigh, shin); body: torso and robe pushed down (a breath, a crouch).
    With plant, root=(x, dy) is added to the drop that keeps the feet on the ground (so a wide
    stance sinks instead of floating); without it root is used as given (airborne, kneeling)."""
    root = root or (0, 0)
    if plant:
        root = root[0], round(planted(lf, lb) + root[1], 1)
    rot = {"torso": torso, "head": head, "robe": robe, "sash": sash, "scarf": scarf, "hand_f": hand_f}
    rot.update(chain(["arm_f_upper", "arm_f_lower"], af[:2], torso))
    acc = torso + rot["arm_f_upper"] + rot["arm_f_lower"] + hand_f
    rot["sword"] = round(REST["sword"] - af[2] - acc, 1)
    rot.update(chain(["arm_b_upper", "arm_b_lower"], ab, torso))
    rot.update(chain(["leg_f_thigh", "leg_f_shin"], lf))
    rot.update(chain(["leg_b_thigh", "leg_b_shin"], lb))
    return {"rotate": rot, "translate": {"root": list(root), "torso": [0, body], "robe": [0, body]}}


def key(t, p, ease=None):
    k = {"t": t, **p}
    if ease:
        k["ease"] = ease
    return k


# Combat poses. Force reads from the whole body, not the arm: a low wide stance, the torso
# thrown into the cut and the back arm flung the other way, a short tick of anticipation
# leaning away from the target, then the cut snaps through and is held past the end before
# the slow recovery. The hit pose lands on the first active tick, which hitstop freezes on.
GUARD = dict(torso=8, head=-4, af=(40, 70, 100), ab=(-20, 10), lf=(24, 4), lb=(-22, -18), body=4, sash=4)
GUARD_IN = dict(GUARD, torso=10, head=-5, af=(36, 66, 96), body=9, sash=7, scarf=2)
HIT1 = dict(torso=26, head=8, af=(72, 78, 58), ab=(-100, -110), lf=(54, 12), lb=(-52, -54), root=(24, 0), body=10, robe=8, sash=34, scarf=-8)
HIT2 = dict(torso=-14, head=-10, af=(150, 165, 175), ab=(-75, -65), lf=(42, 6), lb=(-42, -40), root=(16, 0), body=2, robe=6, sash=-14)
HIT3 = dict(torso=34, head=10, af=(68, 74, 72), ab=(40, 20), lf=(64, 18), lb=(-60, -64), root=(30, 0), body=18, robe=10, sash=44, scarf=-10)
THRUST = dict(torso=34, head=-14, af=(88, 90, 92), ab=(-100, -110), lf=(66, 20), lb=(-68, -76), root=(20, 0), body=6, robe=12, sash=48, scarf=-12)


def loop(duration, keys, ease="ease-in-out", unit=None):
    a = {"duration": duration, "loop": True, "ease": ease, "keys": keys}
    if unit:
        a["unit"] = unit
    return a


def once(duration, keys, ease="linear"):
    return {"duration": duration, "unit": "tick", "ease": ease, "keys": keys}


def walk():
    # one cycle is two steps; the client advances it by distance walked, so the keys only set
    # the shape. Root drops when the legs straddle so the planted foot stays on the ground.
    a = dict(lf=(22, 14), lb=(-20, -38), ab=(20, 35), af=(12, 45, 70), torso=5, sash=6, robe=-2)
    b = dict(lf=(0, 0), lb=(5, -30), ab=(-5, 5), af=(20, 52, 75), torso=6, sash=0)
    c = dict(lf=(-20, -38), lb=(22, 14), ab=(-30, -25), af=(28, 60, 80), torso=5, sash=-6, robe=2)
    d = dict(lf=(5, -30), lb=(0, 0), ab=(-5, 5), af=(20, 52, 75), torso=6, sash=0)
    return loop(1.0, [key(0, pose(**a)), key(0.25, pose(**b)), key(0.5, pose(**c)), key(0.75, pose(**d)), key(1.0, pose(**a))], ease="linear")


def run():
    # root as given: the body rises in the flight phase instead of keeping a foot down
    common = dict(torso=14, head=-8, af=(-35, -15, -70), plant=False)
    a = dict(common, lf=(42, 22), lb=(-35, -85), root=(0, -6), ab=(45, 95), sash=22, scarf=-4)
    b = dict(common, lf=(12, -18), lb=(10, -60), root=(0, 18), ab=(0, 40), sash=30, scarf=-2)
    c = dict(common, lf=(-35, -85), lb=(42, 22), root=(0, -6), ab=(-40, -10), af=(-25, -5, -65), sash=22, scarf=-4)
    d = dict(common, lf=(10, -60), lb=(12, -18), root=(0, 18), ab=(0, 40), sash=30, scarf=-2)
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
            key(2, pose(torso=-18, head=-8, af=(170, 200, 240), ab=(35, 60), lf=(32, 6), lb=(-28, -24), root=(-12, 0), body=6, robe=-4, sash=-8), "ease-in"),
            key(3, pose(torso=14, af=(120, 110, 100), ab=(-20, 0), lf=(40, 8), lb=(-38, -34), body=6, sash=12)),
            key(4, pose(**HIT1), "ease-out"),
            key(7, pose(**dict(HIT1, torso=28, af=(64, 68, 44), body=12)), "ease-in-out"),
            key(11, pose(**GUARD)),
        ]),
        # rising backhand from low behind
        "atk2": once(12, [
            key(0, pose(**HIT1), "ease-out"),
            key(2, pose(torso=26, head=4, af=(20, -5, -40), ab=(30, 40), lf=(46, 14), lb=(-42, -40), body=12, sash=20), "ease-in"),
            key(3, pose(torso=10, af=(80, 95, 110), ab=(-20, -10), lf=(40, 10), lb=(-40, -36), body=6, sash=8)),
            key(4, pose(**HIT2), "ease-out"),
            key(7, pose(**dict(HIT2, af=(160, 178, 190))), "ease-in-out"),
            key(12, pose(**GUARD)),
        ]),
        # the finisher: both hands over the head, rise, slam down into a deep lunge
        "atk3": once(18, [
            key(0, pose(**HIT2), "ease-out"),
            key(3, pose(torso=-26, head=-12, af=(195, 215, 250), ab=(165, 195), lf=(20, 0), lb=(-16, -12), root=(-14, -18), robe=-4, sash=-12), "ease-in"),
            key(4, pose(torso=10, af=(140, 135, 130), ab=(110, 120), lf=(40, 10), lb=(-40, -40), body=6)),
            key(5, pose(**HIT3), "ease-out"),
            key(11, pose(**dict(HIT3, torso=32, af=(62, 66, 62), body=14, sash=34)), "ease-in-out"),
            key(18, pose(**GUARD)),
        ]),
        "jumpAtk": once(14, [
            key(0, pose(**JUMP_UP), "ease-out"),
            key(1, pose(**dict(JUMP_UP, torso=-10, af=(170, 195, 230), ab=(20, 40))), "ease-in"),
            key(2, pose(**dict(JUMP_UP, torso=10, af=(120, 115, 110)))),
            key(4, pose(**dict(JUMP_UP, torso=30, head=6, af=(40, 20, -10), ab=(-70, -60), lf=(60, -20), lb=(-20, -70), sash=30)), "ease-out"),
            key(8, pose(**dict(JUMP_UP, torso=26, af=(35, 15, -20), ab=(-60, -50), lf=(50, -10), lb=(-20, -60), sash=24)), "ease-in-out"),
            key(14, pose(**JUMP_DOWN)),
        ]),
        # crouch with the blade low, then rip it up and rise onto the toes
        "upper": once(20, [
            key(0, pose(**GUARD), "ease-out"),
            key(3, pose(torso=30, head=6, af=(10, -15, -45), ab=(-30, -10), lf=(55, -5), lb=(-40, -60), body=14, sash=24), "ease-in"),
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
