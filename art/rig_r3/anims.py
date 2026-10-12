"""Write hero_tao.json, the pack spec with the hero's clips.
usage: python -I art/rig_r3/anims.py

Poses are limb directions (see tools/rigpose.py). Attack and skill clips are in ticks, each
named as its move and keyed to the frame data in engine/content.ts (windup up to active[0],
the cut over the active ticks, recovery to total).
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


def P(base, **over):
    return pose(**dict(base, **over))


# The skills, each part its own clip named as its move. A part chained from the one before
# (follow, then) starts on the pose that one holds when it may chain, so nothing snaps. The
# blade follows the brush arc the client draws for the move (ARCS in bodyView.ts): an arc angle
# a (radians from forward, negative up) is the weapon direction 90 - a in degrees.

# triple slash: three cuts, each dashing a long way in (advance 18-20 a tick), so deeper lunges
# than the basic combo, the body thrown flat along the dash
TRI1 = dict(torso=32, head=8, af=(74, 80, 64), ab=(-60, -40), lf=(64, 16), lb=(-62, -66), root=(32, 0), body=12, robe=10, sash=42, scarf=-10)
TRI1_HOLD = dict(TRI1, torso=34, af=(66, 70, 54), body=14)
TRI2 = dict(torso=-16, head=-12, af=(152, 168, 176), ab=(-40, -10), lf=(56, 10), lb=(-56, -56), root=(26, 0), body=6, robe=8, sash=-16, scarf=6)
TRI2_HOLD = dict(TRI2, af=(160, 176, 186))
TRI3 = dict(torso=40, head=10, af=(66, 72, 58), ab=(24, 40), lf=(70, 20), lb=(-68, -72), root=(38, 0), body=20, robe=12, sash=50, scarf=-12)


def tri():
    return {
        # a diagonal cut down from over the shoulder, stepping in as it falls
        "tri1": once(14, [
            key(0, pose(**GUARD), "ease-out"),
            key(1.5, P(TRI1, torso=-12, head=-8, af=(165, 196, 236), ab=(0, 40), lf=(36, 4), lb=(-30, -30), root=(0, 0), body=6, robe=-4, sash=-6), "ease-in"),
            key(2.5, P(TRI1, torso=14, af=(118, 124, 104), root=(16, 0))),
            key(3, pose(**TRI1), "ease-out"),
            key(8, pose(**TRI1_HOLD), "ease-in-out"),
            key(14, pose(**GUARD)),
        ]),
        # the backhand back up, from low behind, the body rearing as it rises
        "tri2": once(14, [
            key(0, pose(**TRI1_HOLD), "ease-out"),
            key(1.5, P(TRI1, torso=30, af=(-20, -6, 12), ab=(-40, -20), root=(20, 0)), "ease-in"),
            key(2.3, P(TRI2, torso=10, af=(84, 98, 112))),
            key(3, pose(**TRI2), "ease-out"),
            key(8, pose(**TRI2_HOLD), "ease-in-out"),
            key(14, pose(**GUARD)),
        ]),
        # the blade carried on up over the head and brought down in the deepest lunge
        "tri3": once(20, [
            key(0, pose(**TRI2_HOLD), "ease-out"),
            key(1.5, P(TRI2, torso=-26, head=-12, af=(196, 216, 252), ab=(100, 130), root=(4, -16), robe=-4, sash=-14), "ease-in"),
            key(2.5, P(TRI3, torso=12, af=(140, 136, 128), root=(20, -4))),
            key(3, pose(**TRI3), "ease-out"),
            key(9, P(TRI3, torso=42, af=(60, 66, 50), body=22), "ease-in-out"),
            key(13, P(TRI3, torso=34, af=(56, 64, 50), body=16), "ease-in-out"),
            key(20, pose(**GUARD)),
        ]),
    }


# dragon dashes: three thrusts at a dash (30 a tick), striding alternately like running, the
# blade chambered between them; the fourth rips up out of the dash and launches
STAB = dict(torso=36, head=-14, af=(88, 90, 90), ab=(-104, -98), root=(22, 0), body=8, robe=12, sash=54, scarf=-14)
CHAMBER = dict(torso=20, head=-8, af=(-40, 34, 88), ab=(30, 60), body=8, robe=6, sash=40, scarf=-8)


def dragon():
    out = {}
    for i in (1, 2, 3):
        # the front foot leads the first and third, the back foot the second
        legs = dict(lf=(64, 18), lb=(-66, -76)) if i % 2 else dict(lf=(-58, -70), lb=(62, 14))
        out[f"dragon{i}"] = once(9, [
            key(0, P(CHAMBER, **legs) if i > 1 else pose(**GUARD), "ease-in"),
            key(1, P(CHAMBER, **legs)),
            key(2, P(STAB, **legs), "ease-out"),
            key(7, P(STAB, torso=38, af=(86, 88, 86), **legs), "ease-in"),
            key(9, P(CHAMBER, **legs)),
        ])
    # crouched low out of the last dash, then the blade torn up from the floor in front
    out["dragon4"] = once(20, [
        key(0, P(CHAMBER, torso=34, head=4, af=(-20, -10, -70), lf=(62, -10), lb=(-44, -66), body=16), "ease-in"),
        key(1, P(CHAMBER, torso=12, af=(80, 96, 112), lf=(40, 0), lb=(-30, -30), root=(10, -8))),
        key(2, pose(torso=-20, head=-14, af=(172, 186, 194), ab=(-70, -56), lf=(16, 10), lb=(-34, -44), root=(16, -34), robe=-6, sash=-24, scarf=8), "ease-out"),
        key(9, pose(torso=-16, head=-12, af=(170, 182, 192), ab=(-60, -50), lf=(14, 10), lb=(-30, -40), root=(16, -14), sash=-14, scarf=4), "ease-in-out"),
        key(20, pose(**GUARD)),
    ])
    return out


# crushing blow: a shoulder ram, the blade trailing low behind and the back fist tucked in,
# then the one-handed rising cut out of the crouch it ends in
RAM = dict(torso=44, head=12, af=(-36, -24, -96), ab=(36, 80), lf=(66, 16), lb=(-66, -72), root=(18, 0), body=20, robe=10, sash=46, scarf=-10)
RAM_END = dict(RAM, torso=34, head=6, af=(-24, -10, -80), lf=(64, -14), lb=(-40, -70), root=(10, 0), body=22)


def crush():
    return {
        "crush1": once(12, [
            key(0, pose(**GUARD), "ease-out"),
            key(2, P(RAM, torso=20, head=0, lf=(40, 0), lb=(-30, -40), root=(-8, 0), body=12), "ease-in"),
            key(4, pose(**RAM), "ease-out"),
            # a driving stride on the way through
            key(6, P(RAM, lf=(-40, -60), lb=(56, 10), body=16)),
            key(8, pose(**RAM), "ease-in-out"),
            key(12, pose(**RAM_END)),
        ]),
        "crush2": once(20, [
            key(0, pose(**RAM_END), "ease-in"),
            key(2, pose(torso=10, head=-2, af=(70, 86, 100), ab=(0, 30), lf=(40, 2), lb=(-34, -40), root=(8, -10), body=6)),
            key(3, pose(torso=-22, head=-16, af=(178, 192, 202), ab=(-84, -70), lf=(12, 10), lb=(-30, -40), root=(12, -38), robe=-6, sash=-26, scarf=8), "ease-out"),
            key(10, pose(torso=-18, head=-12, af=(176, 188, 198), ab=(-74, -62), lf=(12, 10), lb=(-28, -38), root=(12, -18), sash=-16, scarf=4), "ease-in-out"),
            key(20, pose(**GUARD)),
        ]),
    }


# the gathered cut: sinking into a deep crouch with the blade drawn far back and held still
# (the cue), then one cut over the top and out wide in front, the body flung after it
GATHER = dict(torso=20, head=-10, af=(-56, -74, 250), ab=(44, 74), lf=(56, -22), lb=(-42, -72), body=24, robe=4, sash=-6, scarf=6)
IAI = dict(torso=38, head=8, af=(80, 86, 62), ab=(-112, -104), lf=(72, 18), lb=(-72, -76), root=(42, 0), body=20, robe=12, sash=54, scarf=-14)


def iai():
    return once(34, [
        key(0, pose(**GUARD), "ease-out"),
        key(7, pose(**GATHER), "ease-in-out"),
        key(12.5, P(GATHER, torso=24, af=(-60, -80, 256), body=28, sash=-10), "ease-in"),
        key(13.4, P(IAI, torso=4, head=-6, af=(130, 150, 176), root=(20, 0), body=10)),
        key(14, pose(**IAI), "ease-out"),
        key(22, P(IAI, torso=40, af=(76, 82, 54), body=22), "ease-in-out"),
        key(25, P(IAI, torso=36, af=(70, 80, 60), body=18), "ease-in-out"),
        key(34, pose(**GUARD)),
    ])


# the phantom dance: eight cuts of 6 ticks from tick 4, down and back up in turn (phantomA,
# phantomB), shifting its feet a little each time; then over the head for the heavy cut the
# wave leaves on (tick 56)
DOWN = dict(torso=26, head=6, af=(70, 76, 52), ab=(-46, -26), lf=(54, 12), lb=(-52, -56), root=(24, 0), body=12, robe=8, sash=36, scarf=-8)
UP = dict(torso=-14, head=-10, af=(148, 166, 164), ab=(-32, 0), lf=(46, 8), lb=(-46, -46), root=(18, 0), body=6, robe=6, sash=-14, scarf=6)
HEAVY = dict(TRI3, root=(30, 0))


def phantom():
    keys = [
        key(0, pose(**GUARD), "ease-out"),
        key(3, P(UP, af=(150, 170, 160)), "ease-in"),
    ]
    # the stance drifts a step in and back, and the lean varies, so the flurry is not a loop
    shift = [0, 10, 4, 14, 6, 12, 2, 8]
    lean = [0, 4, -2, 6, 2, -4, 4, 0]
    for k in range(8):
        cut = DOWN if k % 2 == 0 else UP
        at = 4 + 6 * k
        p = dict(cut, torso=cut["torso"] + lean[k], root=(cut["root"][0] + shift[k], 0))
        drift = -6 if k % 2 == 0 else 6
        keys += [
            key(at + 2, pose(**p), "ease-out"),
            key(at + 5, pose(**dict(p, af=tuple(a + drift for a in p["af"]))), "ease-in"),
        ]
    keys += [
        key(54, P(UP, torso=-26, head=-12, af=(196, 216, 252), ab=(100, 130), root=(8, -16), sash=-16), "ease-in"),
        key(55.5, P(HEAVY, torso=12, af=(140, 136, 128))),
        key(56, pose(**HEAVY), "ease-out"),
        key(61, P(HEAVY, torso=42, af=(60, 66, 50), body=22), "ease-in-out"),
        key(66, pose(**GUARD)),
    ]
    return once(66, keys)


def phantom_end():
    # jumped out of the dance: straight to the heavy cut, the wave leaving on tick 3
    return once(14, [
        key(0, P(UP, torso=-24, head=-12, af=(192, 212, 248), ab=(100, 130), root=(4, -14), sash=-14), "ease-in"),
        key(2, P(HEAVY, torso=12, af=(140, 136, 128))),
        key(3, pose(**HEAVY), "ease-out"),
        key(8, P(HEAVY, torso=42, af=(60, 66, 50), body=22), "ease-in-out"),
        key(14, pose(**GUARD)),
    ])


def skills():
    return {
        **tri(), **dragon(), **crush(),
        "iai": iai(),
        "phantom": phantom(),
        "phantomEnd": phantom_end(),
        # the dodge: not played through, the client picks the time from the vertical speed
        # (0 rising, 1 falling), like the jump. Hopping back, leaning away, the blade kept up in
        # front and the sash blown forward; then the feet reaching for the floor
        "backstep": {"duration": 1, "ease": "ease-in-out", "keys": [
            key(0, pose(torso=-16, head=-4, af=(30, 72, 112), ab=(-64, -36), lf=(44, -14), lb=(8, -54), root=(0, 0), sash=-30, scarf=10, plant=False)),
            key(1, pose(torso=2, head=-4, af=(22, 66, 108), ab=(-40, -16), lf=(26, 8), lb=(-6, -18), root=(0, 0), sash=-10, scarf=4, plant=False)),
        ]},
    }


def clips():
    return {
        **skills(),
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
