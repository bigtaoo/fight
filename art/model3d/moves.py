# Keys a body's own move clips on the Tripo 41-bone skeleton, one tick a frame (30 fps), so they
# play on every chapter-1 body (all share the template's rest rotations) and line up with the
# engine's move timing (engine/content.ts). The clips set every bone outright, like the archer's.
#
#   blender -b --python art/model3d/moves.py -- [<set>] [<body>]    # set: a key of SETS (woodcutter)
#   MOVES_ONLY=down,getup blender ...                                 # strips of these clips only
#
# Writes art/model3d/moves/<set>.glb (the skeleton and its clips, no mesh) and a frame strip of
# each clip on <body> (default: the set's own) for a look. A pose is a handful of numbers on top of
# the archer's idle (which also gives the quarter turn every clip has at the hips): the hips dropped,
# shifted and turned; the spine leant and twisted; the wrists and ankles placed, and the arms and
# legs bent to reach them (two-bone IK). Poses are eased between keys and sampled every tick.
import bpy, math, os, sys
import numpy as np
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHER_IDLE = os.path.join(HERE, '..', 'archer3d', 'model', 'anim_idle.glb')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SET = args[0] if args else 'woodcutter'

# ---- the poses -------------------------------------------------------------------------------
# Body axes: f forward, l the body's left, u up; lengths in model units (a body is about 1 tall).
# hands: wrist targets from the base of the neck, in the hips' axes (upright: a lean moves the neck,
# not where `up` is); elbows: which way each elbow bends, in the same axes; feet: ankle offsets from where the
# archer's idle puts them, in the hips' axes but on the floor (a foot only lifts with `u`).
# drop/shift: the hips lowered / moved forward; turn: the hips' yaw (+ turns left); lean: the
# chest pitched forward (degrees, over the three spine bones); twist: the chest's yaw on the hips;
# tilt: the chest bent to its left; nod: the head pitched down; shake: a tremble (raised arms
# held under strain); blade: which way a sword in the right hand points (hips' axes; None: the hand
# follows the forearm); roll: the blade turned about itself (0: its flat to the camera and its edge
# leading a cut forward and down; 180: leading a cut up).
# fall: the whole posed body then tipped back about the hips (degrees; 90 lies it on its back), so
# hands, feet and blade are given as if it stood and turn with it; floor: 0..1, how far it is let
# down onto the ground (1: its lowest joint, padded for flesh, rests on the floor).
STANCE = dict(
    drop=0.025, shift=0.0, turn=0.0, lean=12.0, twist=0.0, tilt=0.0, nod=-6.0, shake=0.0, blade=None, roll=0.0,
    fall=0.0, floor=0.0,
    lh=(0.08, 0.25, -0.28), rh=(0.08, -0.25, -0.28),
    le=(-0.6, 0.6, -0.4), re=(-0.6, -0.6, -0.4),
    lf=(0.03, 0.03, 0.0), rf=(-0.03, -0.03, 0.0),
)

def P(**kw):
    p = dict(STANCE); p.update(kw); return p

# both hands on the haft, high behind the head; elbows forward and out
OVERHEAD = dict(lh=(-0.08, 0.05, 0.34), rh=(-0.10, -0.03, 0.31), le=(0.6, 0.8, 0.3), re=(0.6, -0.8, 0.3))
# both hands down at the end of a chop, far out in front and low
CHOPPED = dict(lh=(0.30, 0.05, -0.30), rh=(0.27, -0.03, -0.34), le=(-0.2, 0.9, 0.2), re=(-0.2, -0.9, 0.2))
# the haft gripped in front of the belly
GRIP = dict(lh=(0.22, 0.04, -0.24), rh=(0.18, -0.04, -0.28), le=(-0.3, 1, -0.2), re=(-0.3, -1, -0.2))
# for a sweep, the hands low behind the right hip / far out to the left
SWEEP_R = dict(lh=(-0.18, -0.16, -0.30), rh=(-0.30, -0.26, -0.28), le=(0.2, 0.6, -0.8), re=(-0.5, -0.6, -0.4))
SWEEP_L = dict(lh=(0.24, 0.40, -0.36), rh=(0.34, 0.28, -0.38), le=(-0.6, 0.6, -0.3), re=(0.4, -0.2, -0.8))

# (tick, pose, how it is reached: 'io' eased, 'out' a fast start that settles, 'lin')
def chop():
    """The hack (engine: windup 26, active 27..30, through by 31, total 56): a dip to grip the
    haft, the axe lifted high behind the head with the chest thrown back and the front foot
    stepped in, held trembling, then brought down with the whole body into a crouch."""
    up = P(drop=0.0, lean=-24, twist=-8, nod=-14, shift=-0.02, lf=(0.10, 0.04, 0.0), rf=(-0.08, -0.04, 0.0), **OVERHEAD)
    return 56, [
        (0, P(), 'lin'),
        (7, P(drop=0.06, lean=26, nod=8, **GRIP), 'io'),
        (19, up, 'io'),
        (26, P(**{**up, 'lean': -28, 'drop': -0.01, 'shake': 1.0}), 'io'),
        (30, P(drop=0.13, lean=46, twist=10, nod=16, shift=0.06, lf=(0.12, 0.04, 0.0), rf=(-0.12, -0.04, 0.0), **CHOPPED), 'out'),
        (33, P(drop=0.15, lean=50, twist=10, nod=18, shift=0.06, lf=(0.12, 0.04, 0.0), rf=(-0.12, -0.04, 0.0),
               **{**CHOPPED, 'lh': (0.30, 0.05, -0.36), 'rh': (0.27, -0.03, -0.40)}), 'out'),
        (42, P(drop=0.12, lean=40, twist=6, nod=12, shift=0.04, lf=(0.10, 0.04, 0.0), rf=(-0.10, -0.04, 0.0), **CHOPPED), 'io'),
        (56, P(), 'io'),
    ]


def sweep():
    """The sweep (engine: windup 22, active 23..48 as it wades in, a hit again every 9 ticks,
    total 74): the axe drawn low behind the right hip in a crouch, then swung flat across and back
    three times, a step under each swing; a stumble to a stop."""
    wound = P(drop=0.11, lean=30, turn=-25, twist=-40, nod=4, shift=-0.03, lf=(0.12, 0.05, 0.0), rf=(-0.12, -0.06, 0.0), **SWEEP_R)
    keys = [
        (0, P(), 'lin'),
        (16, wound, 'io'),
        (22, P(**{**wound, 'shake': 0.8}), 'io'),
    ]
    # three swings, the feet stepping in under them
    run = [((0.14, 0.05, 0.05), (-0.12, -0.05, 0.0)), ((-0.12, 0.05, 0.0), (0.14, -0.05, 0.05))]
    for i, t in enumerate((30, 39, 48)):
        lf, rf = run[i % 2]
        side = SWEEP_L if i % 2 == 0 else SWEEP_R
        keys.append((t, P(drop=0.12, lean=36, turn=20 if i % 2 == 0 else -20, twist=45 if i % 2 == 0 else -40, nod=6,
                          shift=0.04, lf=lf, rf=rf, **side), 'out'))
    keys += [
        (56, P(drop=0.10, lean=40, turn=10, twist=20, nod=10, shift=0.06, lf=(0.16, 0.05, 0.0), rf=(-0.06, -0.05, 0.0), **GRIP), 'io'),
        (74, P(), 'io'),
    ]
    return 74, keys


def rush():
    """The rush (engine: windup 22, active 23..48 while it charges along its lane, total 74): a
    crouch with the axe gripped low, then head down and a shoulder first, the axe trailing, the
    feet running under it; skids to a stop and straightens."""
    crouch = P(drop=0.14, lean=38, turn=-15, twist=-20, nod=6, shift=-0.04, lf=(0.10, 0.05, 0.0), rf=(-0.12, -0.06, 0.0), **GRIP)
    keys = [
        (0, P(), 'lin'),
        (16, crouch, 'io'),
        (22, P(**{**crouch, 'shake': 0.8}), 'io'),
    ]
    # a stride every 4 ticks across the dash
    run = [((0.16, 0.05, 0.06), (-0.14, -0.05, 0.0)), ((-0.14, 0.05, 0.0), (0.16, -0.05, 0.06))]
    for i, t in enumerate(range(25, 49, 4)):
        lf, rf = run[i % 2]
        keys.append((t, P(drop=0.10 if i % 2 else 0.12, lean=48, turn=15, twist=20, nod=-8, shift=0.05, lf=lf, rf=rf,
                          lh=(-0.10, 0.20, -0.32), rh=(-0.22, -0.18, -0.30), le=(-0.6, 0.6, -0.4), re=(-0.6, -0.6, -0.4)),
                     'out' if i == 0 else 'io'))
    keys += [
        (56, P(drop=0.12, lean=30, turn=5, twist=10, nod=4, shift=0.02, lf=(0.18, 0.05, 0.0), rf=(-0.10, -0.05, 0.0), **GRIP), 'out'),
        (74, P(), 'io'),
    ]
    return 74, keys


def leap():
    """The leap's crouch (engine: 22 ticks) then, in the air, the axe lifted overhead (32 on: held)."""
    return 32, [
        (0, P(), 'lin'),
        (18, P(drop=0.16, lean=34, nod=6, lf=(0.06, 0.05, 0.0), rf=(-0.06, -0.05, 0.0), **SWEEP_R, turn=-10, twist=-15), 'io'),
        (22, P(drop=0.17, lean=36, nod=6, lf=(0.06, 0.05, 0.0), rf=(-0.06, -0.05, 0.0), **SWEEP_R, turn=-10, twist=-15, shake=0.6), 'io'),
        (30, P(drop=-0.02, lean=-26, nod=-14, lf=(0.0, 0.05, 0.12), rf=(-0.10, -0.05, 0.16), **OVERHEAD), 'out'),
        (32, P(drop=-0.02, lean=-28, nod=-14, lf=(0.0, 0.05, 0.12), rf=(-0.10, -0.05, 0.16), **OVERHEAD), 'io'),
    ]


def roar():
    """The second phase's roar (engine: 40 ticks under super armour): arms flung wide, chest up."""
    wide = P(drop=0.05, lean=-20, nod=-26, lh=(0.0, 0.44, 0.04), rh=(0.0, -0.44, 0.04), le=(-0.5, 0.3, -0.8), re=(-0.5, -0.3, -0.8),
             lf=(0.06, 0.06, 0.0), rf=(-0.06, -0.06, 0.0))
    return 40, [
        (0, P(), 'lin'),
        (6, P(drop=0.08, lean=34, nod=14, **GRIP), 'io'),
        (12, wide, 'out'),
        (32, P(**{**wide, 'shake': 1.6}), 'lin'),
        (40, P(), 'io'),
    ]


def idle():
    """A heavy breath, hunched over (60 ticks, loops)."""
    out = P(drop=0.03, lean=15, nod=-4, lh=(0.08, 0.25, -0.29), rh=(0.08, -0.25, -0.29))
    return 60, [(0, P(), 'lin'), (30, out, 'io'), (60, P(), 'io')]


def walk():
    """A heavy, stomping walk (36 ticks, loops): each foot planted for half the cycle and swung
    forward through the other half; the hips dip on each landing and roll over the planted foot.
    The stride is the engine's walk speed (2.4 a tick on a 300-tall body) over a half cycle."""
    n, s = 36, 2.4 / 300 * 18 / 2
    keys = []
    for i in range(5):
        t = i * 9
        # the left foot: back of its plant at 0, swung through to the front by 18, planted back to 36
        lx = [-s, 0.0, s, 0.0][i % 4]
        lu = [0.0, 0.05, 0.0, 0.0][i % 4]
        rx = [s, 0.0, -s, 0.0][i % 4]
        ru = [0.0, 0.0, 0.0, 0.05][i % 4]
        # the right foot plants at 0, the left at 18: the hips lowest just after
        dip = [0.055, 0.025, 0.055, 0.025][i % 4]
        sway = [6, 0, -6, 0][i % 4]
        arm = [1, 0, -1, 0][i % 4]
        keys.append((t, P(drop=dip, lean=16, turn=sway * 0.5, twist=-sway, tilt=[-4, 0, 4, 0][i % 4],
                          lf=(lx, 0.035, lu), rf=(rx, -0.035, ru),
                          lh=(0.07 - 0.07 * arm, 0.25, -0.27), rh=(0.07 + 0.07 * arm, -0.25, -0.27)), 'lin' if i == 0 else 'io'))
    return n, keys


# ---- the swordsman (the hero) ------------------------------------------------------------------
# A ready stance: the left foot forward and the hips turned a little away, the sword held out at
# the belly with its point up at the enemy's throat, the free hand loose by the hip.
GUARD = dict(drop=0.015, turn=-10.0, twist=8.0, lean=8.0, nod=-4.0,
             lf=(0.11, 0.03, 0.0), rf=(-0.11, -0.04, 0.0),
             rh=(0.15, -0.13, -0.20), re=(-0.3, -1.0, -0.4), lh=(0.06, 0.22, -0.30), le=(-0.5, 0.7, -0.4),
             blade=(0.75, 0.0, 0.65))


def G(**kw):
    p = P(**GUARD); p.update(kw); return p


def sw_idle():
    """The guard, breathing (60 ticks, loops)."""
    out = G(drop=0.024, lean=10, rh=(0.15, -0.13, -0.21), blade=(0.78, 0.0, 0.62))
    return 60, [(0, G(), 'lin'), (30, out, 'io'), (60, G(), 'io')]


def sw_walk():
    """A light walk with the sword kept out in front (24 ticks, loops): the stride is the hero's
    walk speed is more than its short legs can stride, so the steps are quick (16 ticks a cycle) and
    the feet slide a little; the free arm swings."""
    n, s = 16, 0.11
    keys = []
    for i in range(5):
        t = i * 4
        lx = [-s, 0.0, s, 0.0][i % 4]
        lu = [0.0, 0.07, 0.0, 0.0][i % 4]
        rx = [s, 0.0, -s, 0.0][i % 4]
        ru = [0.0, 0.0, 0.0, 0.07][i % 4]
        dip = [0.03, 0.012, 0.03, 0.012][i % 4]
        sway = [5, 0, -5, 0][i % 4]
        swing = [-1, 0, 1, 0][i % 4]
        keys.append((t, G(drop=dip, lean=10, turn=-6 + sway * 0.5, twist=6 - sway, tilt=[-3, 0, 3, 0][i % 4],
                          lf=(lx, 0.035, lu), rf=(rx, -0.035, ru),
                          rh=(0.15, -0.13, -0.20 - 0.4 * (dip - 0.02)),
                          lh=(0.04 + 0.09 * swing, 0.22, -0.31)), 'lin'))
    return n, keys


# the first cut's end, where the second starts: low out in front, the left foot stepped in
CUT1 = dict(rh=(0.30, -0.06, -0.20), re=(-0.2, -1.0, 0.1), blade=(0.75, 0.0, -0.55), lean=22, twist=18, turn=5,
            shift=0.05, drop=0.05, nod=6, lf=(0.15, 0.04, 0.0), rf=(-0.10, -0.04, 0.0), lh=(-0.05, 0.22, -0.30))


def sw_atk1():
    """The first cut (engine: 11 ticks, active 3..5): the sword drawn up over the right shoulder
    and brought down across the front, a step in with the left foot."""
    up = G(rh=(0.02, -0.16, 0.10), re=(-0.5, -0.8, 0.0), blade=(-0.5, 0.0, 0.85), lean=-4, twist=-15, turn=-20,
           lh=(0.18, 0.20, -0.12), le=(-0.3, 0.8, -0.5))
    return 11, [
        (0, G(), 'lin'),
        (2, up, 'io'),
        (5, G(**CUT1), 'out'),
        (7, G(**{**CUT1, 'blade': (0.7, 0.0, -0.62), 'drop': 0.055}), 'io'),
        (11, G(), 'io'),
    ]


CUT2 = dict(rh=(0.26, -0.10, 0.12), re=(-0.3, -0.9, -0.3), blade=(0.45, 0.0, 0.9), roll=180.0, twist=20, turn=10,
            lean=-6, drop=0.02, shift=0.04, lf=(0.13, 0.04, 0.0), rf=(-0.06, -0.04, 0.0), lh=(0.02, 0.24, -0.26))


def sw_atk2():
    """The second (12 ticks, active 3..5): from low in front, the blade turned over and swept back
    past the right hip, then cut up through the enemy to over the head."""
    low = G(rh=(-0.05, -0.20, -0.36), re=(-0.3, -0.9, 0.3), blade=(-0.85, 0.0, -0.25), roll=180.0, twist=-25, turn=-20,
            lean=16, drop=0.045, shift=0.03, lf=(0.14, 0.04, 0.0), rf=(-0.08, -0.04, 0.0), lh=(0.20, 0.20, -0.20))
    return 12, [
        (0, G(**CUT1), 'lin'),
        (2, low, 'io'),
        (5, G(**CUT2), 'out'),
        (7, G(**{**CUT2, 'blade': (0.35, 0.0, 0.94)}), 'io'),
        (12, G(), 'io'),
    ]


def sw_atk3():
    """The third (18 ticks, active 4..7): the sword raised high behind the head, the body thrown
    back, then a lunge with everything brought down into a deep crouch."""
    up = G(rh=(-0.06, -0.08, 0.30), re=(0.4, -0.9, 0.3), blade=(-0.7, 0.0, 0.6), lean=-16, nod=-10, drop=0.0,
           twist=-10, turn=-15, lh=(0.30, 0.15, 0.02), le=(-0.4, 0.8, -0.4), lf=(0.06, 0.04, 0.0), rf=(-0.12, -0.04, 0.0))
    slam = G(rh=(0.40, -0.04, -0.34), re=(-0.2, -1.0, 0.2), blade=(0.85, 0.0, -0.45), lean=34, nod=10, drop=0.085,
             shift=0.07, twist=15, turn=5, lf=(0.18, 0.04, 0.0), rf=(-0.12, -0.05, 0.0), lh=(-0.12, 0.24, -0.18), le=(-0.6, 0.6, 0.2))
    return 18, [
        (0, G(**CUT2), 'lin'),
        (3, up, 'io'),
        (6, slam, 'out'),
        (11, G(**{**slam, 'drop': 0.09, 'blade': (0.82, 0.0, -0.52)}), 'io'),
        (18, G(), 'io'),
    ]


# ---- the swordsman's skills (engine/content.ts; each clip keyed on the move's own ticks) ---------
# the sword raised over the right shoulder, the windup of every downward cut
RAISED = dict(rh=(0.02, -0.16, 0.10), re=(-0.5, -0.8, 0.0), blade=(-0.5, 0.0, 0.85), lean=-4, twist=-15, turn=-20,
              lh=(0.18, 0.20, -0.12), le=(-0.3, 0.8, -0.5))
# swept back low past the right hip, the windup of every rising cut
LOW = dict(rh=(-0.05, -0.20, -0.36), re=(-0.3, -0.9, 0.3), blade=(-0.85, 0.0, -0.25), roll=180.0, twist=-25, turn=-20,
           lean=16, drop=0.045, shift=0.03, lh=(0.20, 0.20, -0.20))
# the feet drawn up under the body, in the air
TUCK = dict(lf=(0.08, 0.04, 0.10), rf=(-0.05, -0.04, 0.06))
# a long step in, the front knee bent
LUNGE = dict(lf=(0.20, 0.04, 0.0), rf=(-0.14, -0.04, 0.0), drop=0.06, shift=0.07)


def sw_jumpAtk():
    """A cut down from the air (14 ticks, active 2..8), the feet tucked."""
    return 14, [
        (0, G(**TUCK, **RAISED), 'lin'),
        (2, G(**TUCK, **{**RAISED, 'lean': -10}), 'io'),
        (6, G(**{**CUT1, 'drop': 0.0, 'shift': 0.0, 'lean': 30, **TUCK}), 'out'),
        (9, G(**{**CUT1, 'drop': 0.0, 'shift': 0.0, 'lean': 30, 'blade': (0.6, 0.0, -0.8), **TUCK}), 'io'),
        (14, G(**TUCK), 'io'),
    ]


def sw_tri1():
    """The triple slash, first (14 ticks, active 3..7): a dash and a cut down across the front."""
    return 14, [
        (0, G(), 'lin'),
        (2, G(**{**RAISED, 'lean': 6}), 'io'),
        (5, G(**{**CUT1, **LUNGE, 'lean': 26}), 'out'),
        (8, G(**{**CUT1, **LUNGE, 'lean': 26, 'blade': (0.6, 0.0, -0.8)}), 'io'),
        (14, G(**CUT1), 'io'),
    ]


def sw_tri2():
    """Second (14 ticks, active 3..7): the blade turned over and cut back up."""
    return 14, [
        (0, G(**CUT1), 'lin'),
        (2, G(**LOW), 'io'),
        (5, G(**{**CUT2, **LUNGE, 'drop': 0.03}), 'out'),
        (8, G(**{**CUT2, **LUNGE, 'drop': 0.03, 'blade': (0.3, 0.0, 0.95)}), 'io'),
        (14, G(**CUT2), 'io'),
    ]


def sw_tri3():
    """Third (20 ticks, active 3..8): up on the toes, the sword over the head, and the whole body
    brought down behind it."""
    up = G(rh=(-0.06, -0.08, 0.30), re=(0.4, -0.9, 0.3), blade=(-0.6, 0.0, 0.75), lean=-18, nod=-10, drop=-0.01,
           twist=-10, turn=-15, lh=(0.30, 0.15, 0.02), le=(-0.4, 0.8, -0.4), lf=(0.08, 0.04, 0.02), rf=(-0.10, -0.04, 0.03))
    slam = G(rh=(0.40, -0.04, -0.34), re=(-0.2, -1.0, 0.2), blade=(0.85, 0.0, -0.45), lean=36, nod=10, drop=0.09,
             shift=0.08, twist=15, turn=5, lf=(0.20, 0.04, 0.0), rf=(-0.14, -0.05, 0.0), lh=(-0.12, 0.24, -0.18), le=(-0.6, 0.6, 0.2))
    return 20, [
        (0, G(**CUT2), 'lin'),
        (2, up, 'io'),
        (5, slam, 'out'),
        (12, G(**{**slam, 'blade': (0.82, 0.0, -0.52)}), 'io'),
        (20, G(), 'io'),
    ]


# a thrust: the arm out straight, the blade level, the body behind it
THRUST = dict(rh=(0.36, -0.08, -0.06), re=(-0.1, -1.0, 0.0), blade=(1.0, 0.0, 0.04), lean=26, twist=22, turn=8,
              nod=4, lh=(-0.12, 0.22, -0.24), le=(-0.6, 0.6, 0.2), **LUNGE)


def sw_dragon():
    """One of the first three dragon dashes (9 ticks, active 2..7): drawn back, then run through."""
    back = G(rh=(-0.02, -0.15, -0.10), re=(-0.4, -0.9, 0.0), blade=(1.0, 0.0, 0.1), lean=14, twist=-20, turn=-15,
             lh=(0.16, 0.20, -0.16), lf=(0.12, 0.04, 0.0), rf=(-0.12, -0.04, 0.0), drop=0.05)
    return 9, [
        (0, G(), 'lin'),
        (2, back, 'io'),
        (4, G(**THRUST), 'out'),
        (8, G(**{**THRUST, 'rh': (0.38, -0.08, -0.07)}), 'io'),
        (9, G(**THRUST), 'io'),
    ]


def sw_dragon4():
    """The last dash (20 ticks, active 2..8): run through and torn up out of the body, launching it."""
    rise = G(rh=(0.18, -0.08, 0.34), re=(-0.2, -0.9, -0.3), blade=(0.25, 0.0, 0.97), roll=180.0, lean=-14, nod=-8,
             twist=20, turn=10, drop=-0.01, shift=0.06, lf=(0.16, 0.04, 0.02), rf=(-0.10, -0.04, 0.04), lh=(-0.04, 0.24, -0.20))
    return 20, [
        (0, G(**THRUST), 'lin'),
        (2, G(**{**THRUST, 'roll': 180.0, 'blade': (0.95, 0.0, -0.3), 'rh': (0.30, -0.10, -0.18)}), 'io'),
        (6, rise, 'out'),
        (12, G(**{**rise, 'blade': (0.1, 0.0, 1.0)}), 'io'),
        (20, G(), 'io'),
    ]


def sw_upper():
    """The rising slash (20 ticks, active 4..7): crouched with the blade low behind, then the
    body stood up behind a cut straight up."""
    crouch = G(**{**LOW, 'drop': 0.08, 'lean': 24, 'blade': (-0.8, 0.0, -0.5)}, lf=(0.15, 0.04, 0.0), rf=(-0.12, -0.04, 0.0))
    rise = G(rh=(0.18, -0.08, 0.36), re=(-0.2, -0.9, -0.3), blade=(0.15, 0.0, 0.99), roll=180.0, lean=-16, nod=-10,
             twist=20, turn=10, drop=-0.01, shift=0.04, lf=(0.13, 0.04, 0.02), rf=(-0.10, -0.04, 0.03), lh=(-0.04, 0.24, -0.20))
    return 20, [
        (0, G(), 'lin'),
        (3, crouch, 'io'),
        (6, rise, 'out'),
        (12, G(**{**rise, 'blade': (0.05, 0.0, 1.0)}), 'io'),
        (20, G(), 'io'),
    ]


def sw_crush1():
    """Crushing charge, the ram (12 ticks, active 4..8): the sword held low behind, the left shoulder
    driven in first."""
    set_ = G(rh=(-0.06, -0.18, -0.24), re=(-0.4, -0.9, 0.2), blade=(-0.85, 0.0, -0.4), roll=180.0, twist=-35, turn=-25,
             lean=22, drop=0.07, lh=(0.08, 0.16, -0.06), le=(-0.6, 0.6, -0.2), lf=(0.12, 0.04, 0.0), rf=(-0.12, -0.04, 0.0))
    ram = G(**{**set_, 'lean': 32, 'twist': -40, 'nod': 8, 'lf': (0.22, 0.04, 0.0), 'rf': (-0.14, -0.04, 0.0), 'shift': 0.08})
    return 12, [
        (0, G(), 'lin'),
        (3, set_, 'io'),
        (6, ram, 'out'),
        (12, G(**{**ram, 'lean': 26}), 'io'),
    ]


def sw_crush2():
    """The cut that follows (20 ticks, active 3..6): one hand, from low behind up over the head."""
    rise = G(rh=(0.20, -0.08, 0.36), re=(-0.2, -0.9, -0.3), blade=(0.3, 0.0, 0.95), roll=180.0, lean=-16, nod=-10,
             twist=25, turn=12, drop=0.0, shift=0.06, lf=(0.16, 0.04, 0.0), rf=(-0.10, -0.04, 0.03), lh=(-0.10, 0.26, -0.16))
    return 20, [
        (0, G(rh=(-0.06, -0.18, -0.24), blade=(-0.85, 0.0, -0.4), roll=180.0, twist=-40, turn=-25, lean=26, drop=0.07,
              lh=(0.08, 0.16, -0.06), lf=(0.22, 0.04, 0.0), rf=(-0.14, -0.04, 0.0), shift=0.08), 'lin'),
        (5, rise, 'out'),
        (11, G(**{**rise, 'blade': (0.15, 0.0, 0.99)}), 'io'),
        (20, G(), 'io'),
    ]


def sw_iai():
    """The drawing cut (34 ticks, active 14..16): crouched still, the sword back along the left hip
    as if sheathed and the left hand on it; then one wide cut level across and held."""
    draw = G(rh=(0.02, 0.10, -0.18), re=(-0.2, -1.0, -0.2), blade=(-0.95, 0.15, -0.2), lean=24, nod=8, twist=-30, turn=-20,
             drop=0.07, lh=(0.04, 0.14, -0.18), le=(-0.4, 0.8, -0.3), lf=(0.16, 0.04, 0.0), rf=(-0.13, -0.04, 0.0))
    cut = G(rh=(0.34, -0.20, -0.08), re=(-0.1, -1.0, 0.1), blade=(0.93, -0.32, 0.12), lean=18, nod=4, twist=35, turn=15,
            drop=0.08, shift=0.08, lh=(-0.16, 0.26, -0.20), le=(-0.6, 0.6, 0.2), lf=(0.22, 0.04, 0.0), rf=(-0.15, -0.05, 0.0))
    return 34, [
        (0, G(), 'lin'),
        (6, draw, 'io'),
        (13, G(**{**draw, 'drop': 0.075, 'lean': 26}), 'io'),
        (15, cut, 'out'),
        (26, G(**{**cut, 'blade': (0.93, -0.3, 0.06)}), 'io'),
        (34, G(), 'io'),
    ]


def sw_phantom():
    """The phantom flurry (66 ticks, active 4..51, a hit every 3): cut down and up again and again
    on the spot, then the sword raised and the wave sent off with a last cut (fired at 56)."""
    keys = [(0, G(), 'lin'), (3, G(**RAISED), 'io')]
    for i, t in enumerate(range(5, 51, 3)):
        a = CUT1 if i % 2 == 0 else CUT2
        keys.append((t, G(**{**a, **LUNGE, 'drop': 0.05, 'twist': a['twist'] + (6 if i % 4 < 2 else -6)}), 'out'))
    up = G(rh=(-0.06, -0.08, 0.30), re=(0.4, -0.9, 0.3), blade=(-0.6, 0.0, 0.75), lean=-18, nod=-10, drop=0.0,
           twist=-10, turn=-15, lh=(0.30, 0.15, 0.02), le=(-0.4, 0.8, -0.4), lf=(0.08, 0.04, 0.0), rf=(-0.12, -0.04, 0.0))
    slam = G(rh=(0.40, -0.04, -0.30), re=(-0.2, -1.0, 0.2), blade=(0.9, 0.0, -0.35), lean=32, nod=10, drop=0.085,
             shift=0.08, twist=15, turn=5, lf=(0.20, 0.04, 0.0), rf=(-0.14, -0.05, 0.0), lh=(-0.12, 0.24, -0.18), le=(-0.6, 0.6, 0.2))
    keys += [(53, up, 'io'), (56, slam, 'out'), (60, slam, 'io'), (66, G(), 'io')]
    return 66, keys


def sw_phantomEnd():
    """The flurry cut short (14 ticks, wave at 3): straight to the last cut."""
    return 14, [
        (0, G(**RAISED), 'lin'),
        (3, G(rh=(0.40, -0.04, -0.30), re=(-0.2, -1.0, 0.2), blade=(0.9, 0.0, -0.35), lean=32, nod=10, drop=0.085,
              shift=0.08, twist=15, turn=5, lf=(0.20, 0.04, 0.0), rf=(-0.14, -0.05, 0.0), lh=(-0.12, 0.24, -0.18)), 'out'),
        (14, G(), 'io'),
    ]


def sw_backstep():
    """The dodge (30 ticks): a crouch, a hop back with the feet drawn up and the sword kept on
    guard, and a landing that sinks and comes up."""
    return 30, [
        (0, G(), 'lin'),
        (2, G(drop=0.06, lean=16), 'io'),
        (6, G(drop=-0.01, lean=-10, nod=-6, lf=(0.12, 0.04, 0.08), rf=(-0.02, -0.04, 0.12), lh=(-0.06, 0.24, -0.18)), 'out'),
        (18, G(drop=0.0, lean=-6, lf=(0.10, 0.04, 0.05), rf=(-0.06, -0.04, 0.03), lh=(-0.04, 0.24, -0.22)), 'io'),
        (22, G(drop=0.06, lean=14), 'io'),
        (30, G(), 'io'),
    ]


# ---- knocked down and getting up (engine/content.ts WORLD; client actor.ts plays these on the state's ticks)
# lying on the back, one knee up, the free arm flung out; the sword kept in hand along the near side,
# its point toward the feet and a little up off the floor (given as if standing: up is toward the
# head, forward is up off the floor)
LIE = dict(fall=88.0, floor=1.0, drop=0.0, turn=0.0, lean=0.0, twist=0.0, nod=10.0,
           lf=(0.04, 0.05, 0.14), rf=(0.0, -0.04, 0.02), le=(0.2, 0.6, 0.6), re=(0.3, -1.0, 0.0),
           lh=(0.02, 0.36, -0.06), rh=(0.06, -0.26, -0.30), blade=(0.12, -0.12, -0.98))
# thrown back through the air: the chest curled, the legs trailing forward, the sword held up
TUMBLE = dict(fall=42.0, drop=0.0, turn=0.0, twist=-6.0, lean=14.0, nod=10.0,
              lf=(0.14, 0.05, 0.12), rf=(0.03, -0.04, 0.05), le=(0.4, 0.6, 0.2), re=(0.0, -1.0, 0.2),
              lh=(-0.10, 0.32, 0.04), rh=(0.04, -0.28, -0.04), blade=(0.6, -0.1, 0.78))


def sw_air():
    """Thrown by a blow (engine 'air', replayed from 0 on every hit in a juggle; held at the end
    however long the flight): the head snapped back, then the body tumbling back."""
    snap = G(lean=-14, nod=-14, fall=8, drop=0.0, rh=(0.10, -0.22, -0.12), blade=(0.7, -0.1, 0.6), lh=(-0.02, 0.30, -0.10))
    return 16, [
        (0, snap, 'lin'),
        (5, P(**TUMBLE), 'out'),
        (16, P(**{**TUMBLE, 'fall': 58.0, 'lean': 8.0}), 'io'),
    ]


def sw_down():
    """Landed (engine 'down', 24 ticks; a death holds the end): the back slams down with the legs
    thrown up, then settles to lie still."""
    slam = {**LIE, 'fall': 96.0, 'nod': -4.0, 'lf': (0.10, 0.05, 0.22), 'rf': (0.06, -0.04, 0.14),
            'lh': (0.0, 0.38, 0.02), 'blade': (0.2, -0.12, -0.97)}
    return 24, [
        (0, P(**{**TUMBLE, 'fall': 62.0, 'floor': 1.0}), 'lin'),
        (3, P(**slam), 'out'),
        (8, P(**LIE), 'io'),
        (24, P(**{**LIE, 'nod': 14.0, 'lf': (0.03, 0.05, 0.12)}), 'io'),
    ]


def sw_getup():
    """Up off the floor (engine 'getup', 10 ticks, the quick rise too): sits up with the knees
    drawn in, rolls forward onto the feet in a crouch, and rises into the guard."""
    sit = P(**{**LIE, 'lean': 62.0, 'nod': 0.0, 'lf': (0.04, 0.05, 0.24), 'rf': (0.0, -0.04, 0.18),
               'lh': (-0.30, 0.20, 0.04), 'le': (0.6, 0.6, 0.0), 'rh': (-0.14, -0.22, -0.24), 'blade': (0.35, -0.12, -0.92)})
    crouch = G(fall=12.0, floor=1.0, drop=0.16, lean=34.0, nod=6.0, lf=(0.10, 0.04, 0.0), rf=(-0.12, -0.05, 0.0),
               lh=(0.20, 0.20, -0.36), le=(-0.6, 0.7, 0.0), rh=(0.18, -0.14, -0.28), blade=(0.85, 0.0, 0.35))
    return 10, [
        (0, P(**LIE), 'lin'),
        (4, P(**sit), 'io'),
        (7, crouch, 'io'),
        (10, G(), 'io'),
    ]


SETS = {
    'woodcutter': {'body': 'wood', 'clips': {'chop': chop, 'sweep': sweep, 'rush': rush, 'leap': leap, 'roar': roar, 'idle': idle, 'walk': walk}},
    'swordsman': {'body': 'sword', 'clips': {'idle': sw_idle, 'walk': sw_walk, 'atk1': sw_atk1, 'atk2': sw_atk2, 'atk3': sw_atk3,
                                                 'jumpAtk': sw_jumpAtk, 'tri1': sw_tri1, 'tri2': sw_tri2, 'tri3': sw_tri3,
                                                 'dragon': sw_dragon, 'dragon4': sw_dragon4, 'upper': sw_upper,
                                                 'crush1': sw_crush1, 'crush2': sw_crush2, 'iai': sw_iai,
                                                 'phantom': sw_phantom, 'phantomEnd': sw_phantomEnd, 'backstep': sw_backstep,
                                                 'air': sw_air, 'down': sw_down, 'getup': sw_getup}},
}
BODY = args[1] if len(args) > 1 else SETS[SET]['body']
CLIPS = SETS[SET]['clips']

# ---- the rig ---------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30


def imp(path):
    before = set(bpy.data.objects)
    # the importer's own bone axes would differ with the bones' lengths; keep glTF's
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    return [o for o in bpy.data.objects if o not in before]


def update(): bpy.context.view_layer.update()


def order(arm):
    out = []
    def walk_(b):
        out.append(b.name)
        for c in b.children: walk_(c)
    for b in arm.data.bones:
        if b.parent is None: walk_(b)
    return out


# the archer's idle, first frame: every bone's orientation in the armature (the clips are absolute)
src = imp(ARCHER_IDLE)
sarm = next(o for o in src if o.type == 'ARMATURE')
sc.frame_set(1)
BASE = {pb.name: pb.matrix.to_3x3().normalized() for pb in sarm.pose.bones}
for o in src: bpy.data.objects.remove(o)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)

objs = imp(os.path.join(HERE, BODY, 'rig_v1.glb'))
arm = next(o for o in objs if o.type == 'ARMATURE')
# the body (a rig may carry a stray helper mesh too)
mesh = max((o for o in objs if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
if arm.animation_data is None: arm.animation_data_create()
ORDER = order(arm)
pbs = arm.pose.bones
for pb in pbs: pb.rotation_mode = 'QUATERNION'

# the base pose on this skeleton, kept as each bone's own rotation
for n in ORDER:
    pb = pbs[n]
    pb.matrix = Matrix.Translation(pb.matrix.translation) @ BASE[n].to_4x4()
    update()
BASEQ = {n: pbs[n].rotation_quaternion.copy() for n in ORDER}
U = Vector((0, 0, 1))
Lax = pbs['L_Thigh'].head - pbs['R_Thigh'].head
Lax.z = 0; Lax.normalize()
F = Lax.cross(U)
ANK = {s: pbs[f'{s}_Calf'].tail.copy() for s in 'LR'}
# where the game puts a sword in the right hand (actor.ts arm()): from the rest pose, pointing
# forward (the model's -z, Blender's +y) and a little down the forearm's line, its flat to +x
_bn = arm.data.bones
_along = (_bn['R_Hand'].head_local - _bn['R_Forearm'].head_local).normalized()
_dir = (_along * 0.4 + Vector((0, 1, 0))).normalized()
_flat = Vector((1, 0, 0))
_flat = (_flat - _dir * _flat.dot(_dir)).normalized()
SWORD_REST = Matrix((_flat, _dir, _flat.cross(_dir))).transposed()
# the sword's frame in the hand's
SWORD = _bn['R_Hand'].matrix_local.to_3x3().normalized().transposed() @ SWORD_REST
HILT = _along * 0.05
LEN = {n: (arm.data.bones[n].tail_local - arm.data.bones[n].head_local).length for n in ORDER}
print(f'MOVES {SET} on {BODY}: forward {tuple(round(v, 3) for v in F)}, hip {pbs['Hip'].head.z:.3f}, scale {arm.matrix_world.to_scale()[0]:.3f}, top {max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices):.3f}, arm {LEN["R_Upperarm"]:.3f}+{LEN["R_Forearm"]:.3f}, leg {LEN["R_Thigh"]:.3f}+{LEN["R_Calf"]:.3f}')


def axes(R):
    """Body axes turned by R (a 3x3)."""
    return R @ F, R @ Lax, R @ U


def vec(R, v):
    f, l, u = axes(R)
    return f * v[0] + l * v[1] + u * v[2]


def turn(n, R):
    """Turns bone n by R (armature space) about its head."""
    pb = pbs[n]
    M = pb.matrix
    pb.matrix = Matrix.Translation(M.translation) @ (R @ M.to_3x3()).to_4x4()
    update()


def aim(n, d):
    pb = pbs[n]
    turn(n, (pb.tail - pb.head).rotation_difference(d).to_matrix())


def reach(upper, lower, target, pole):
    """Two-bone IK: bends upper and lower (bones) so lower's tail reaches target, bending toward pole."""
    S = pbs[upper].head.copy()
    l1, l2 = LEN[upper], LEN[lower]
    d = target - S
    dist = max(abs(l1 - l2) + 1e-4, min(d.length, (l1 + l2) * 0.999))
    u = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    v = pole - u * pole.dot(u)
    v = v.normalized() if v.length > 1e-6 else Vector((0, 0, 1))
    E = S + u * a + v * h
    aim(upper, E - S)
    aim(lower, S + u * dist - E)


def rot(axis, deg): return Matrix.Rotation(math.radians(deg), 3, axis)


def apply(p, t):
    for n in ORDER:
        pbs[n].rotation_quaternion = BASEQ[n]
        pbs[n].location = (0, 0, 0)
        pbs[n].scale = (1, 1, 1)
    update()
    sh = p['shake'] * math.sin(t * 2.6)
    # the hips: turned on the spot and moved
    Rh = rot(U, p['turn'])
    hip = pbs['Hip']
    off = F * p['shift'] - U * p['drop']
    hip.matrix = Matrix.Translation(hip.matrix.translation + off) @ (Rh @ hip.matrix.to_3x3()).to_4x4()
    update()
    # the spine: twisted, leant and tilted in three even shares, about the hips' axes
    f, l, u = axes(Rh)
    Rs = rot(u, p['twist'] / 3) @ rot(l, (p['lean'] - sh * 2) / 3) @ rot(f, -p['tilt'] / 3)
    for n in ('Waist', 'Spine01', 'Spine02'): turn(n, Rs)
    Rc = Rs @ Rs @ Rs @ Rh
    # the head keeps looking ahead (half the lean undone) and nods
    fc, lc, uc = axes(Rc)
    turn('NeckTwist01', rot(lc, (p['nod'] - p['lean'] * 0.5) / 2))
    turn('Head', rot(lc, (p['nod'] - p['lean'] * 0.5) / 2))
    # the arms reach for the wrist targets
    neck = pbs['Spine02'].tail.copy()
    for s, hk, ek in (('L', 'lh', 'le'), ('R', 'rh', 're')):
        h = Vector(p[hk]) + Vector((0, 0, sh * 0.012))
        reach(f'{s}_Upperarm', f'{s}_Forearm', neck + vec(Rh, h), vec(Rh, p[ek]))
    # the legs reach for the ankles on the floor, knees forward; the feet keep flat
    fh, lh_, _ = axes(Rh)
    for s, k in (('L', 'lf'), ('R', 'rf')):
        o = p[k]
        target = ANK[s] + fh * o[0] + lh_ * o[1] + U * o[2]
        reach(f'{s}_Thigh', f'{s}_Calf', target, fh + (lh_ if s == 'L' else -lh_) * 0.15)
        foot = pbs[f'{s}_Foot']
        foot.matrix = Matrix.Translation(foot.matrix.translation) @ (Rh @ BASE[f'{s}_Foot']).to_4x4()
        update()
    # the sword: the right hand turned so the blade points where it should, its flat to the side
    if p['blade'] is not None:
        d = vec(Rh, p['blade']).normalized()
        side = vec(Rh, (0, 1, 0))
        flat = side - d * side.dot(d)
        flat = flat.normalized() if flat.length > 1e-4 else vec(Rh, (0, 0, 1))
        flat = Matrix.Rotation(math.radians(p['roll']), 3, d) @ flat
        S = Matrix((flat, d, flat.cross(d))).transposed()
        hand = pbs['R_Hand']
        hand.matrix = Matrix.Translation(hand.matrix.translation) @ (S @ SWORD.transposed()).to_4x4()
        update()
    # the whole body tipped back about the hips (the bones below follow), then let down to the floor
    if p['fall'] or p['floor']:
        hip = pbs['Hip']
        M = hip.matrix
        hip.matrix = Matrix.Translation(M.translation) @ (rot(vec(Rh, (0, 1, 0)), -p['fall']) @ M.to_3x3()).to_4x4()
        update()
        if p['floor']:
            # (the hips' bone hangs down to the root: only its head is flesh)
            low = min(min(pbs[n].head.z, pbs[n].head.z if n == 'Hip' else pbs[n].tail.z) - PAD.get(n, 0.01) for n in ORDER if n != 'Root')
            hip.matrix = Matrix.Translation(-U * low * p['floor']) @ hip.matrix
            update()


# how far each bone's flesh stands out from its line, for `floor` (the rest: 0.01)
PAD = {'Hip': 0.05, 'Waist': 0.05, 'Spine01': 0.05, 'Spine02': 0.05, 'NeckTwist01': 0.03, 'Head': 0.05}


def ease(k, how):
    k = max(0.0, min(1.0, k))
    if how == 'io': return k * k * (3 - 2 * k)
    if how == 'out': return 1 - (1 - k) ** 3
    return k


def sample(keys, t):
    for (t0, p0, _), (t1, p1, how) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = ease((t - t0) / max(1e-6, t1 - t0), how)
            out = {}
            for key in p0:
                a, b = p0[key], p1[key]
                if a is None or b is None:
                    out[key] = b if k > 0.5 else a
                    continue
                out[key] = tuple(x + (y - x) * k for x, y in zip(a, b)) if isinstance(a, tuple) else a + (b - a) * k
            return out
    return keys[-1][1]


def key_clip(name, total, keys):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for t in range(total + 1):
        apply(sample(keys, t), t)
        for n in ORDER:
            pbs[n].keyframe_insert('rotation_quaternion', frame=t)
        pbs['Hip'].keyframe_insert('location', frame=t)
    return act


# ---- a strip of frames, for a look -----------------------------------------------------------
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 360, 420
sc.render.film_transparent = True
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.4
# from the side the game's camera sees, the body facing right
side = F.cross(U)
cam.location = Vector((0, 0, 0.55)) + side * 4 + F * 0.12
cam.rotation_euler = (-side).to_track_quat('-Z', 'Y').to_euler()
# a stand-in sword in the hand, as the game holds it
bpy.ops.mesh.primitive_cube_add(size=1)
blade = bpy.context.active_object
blade.data.transform(Matrix.Translation((0, 0.3, 0)) @ Matrix.Diagonal((0.012, 0.6, 0.05, 1)))
# bone-parented, an object hangs from the bone's tail in the bone's own axes
_hr = _bn['R_Hand'].matrix_local.to_3x3().normalized()
blade.parent = arm; blade.parent_type = 'BONE'; blade.parent_bone = 'R_Hand'
blade.matrix_parent_inverse = Matrix.Identity(4)
blade.matrix_basis = Matrix.Translation((0, -_bn['R_Hand'].length, 0)) @ Matrix.Translation(_hr.transposed() @ HILT) @ SWORD.to_4x4()
OUT = os.path.join(HERE, 'moves')
os.makedirs(OUT, exist_ok=True)
SHOTS = os.path.join(OUT, '_frames')


def lows(total):
    """The lowest point of the body and the sword's tip over every tick, in world units (the floor
    is 0): a body let down onto the ground should sit near 0, and the tip should never go under."""
    body, tip = [], []
    for t in range(total + 1):
        sc.frame_set(t)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co)
        mw = ev.matrix_world
        z = co.reshape(-1, 3) @ np.array(mw.row[2][:3]) + mw.row[2][3]
        ev.to_mesh_clear()
        body.append(float(z.min()))
        tip.append((blade.evaluated_get(dg).matrix_world @ Vector((0, 0.6, 0))).z)
    return body, tip


def strip(name, ticks, wide=False):
    """`wide`: framed for a body lying along the floor (its head well behind its hips)."""
    cam.data.ortho_scale = 1.9 if wide else 1.4
    cam.location = Vector((0, 0, 0.55 + (0.2 if wide else 0))) + side * 4 + F * (-0.18 if wide else 0.12)
    tiles = []
    for t in ticks:
        sc.frame_set(t)
        sc.render.filepath = os.path.join(SHOTS, f'{name}_{t:03d}.png')
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(sc.render.filepath)
        px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)
        rgb = px[..., :3] * px[..., 3:] + (1 - px[..., 3:]) * 0.93   # on paper
        tiles.append(rgb)
        bpy.data.images.remove(img)
    row = np.concatenate(tiles, axis=1)
    h, w = row.shape[:2]
    im = bpy.data.images.new(f'{name}_strip', w, h)
    im.pixels = np.concatenate([row, np.ones((h, w, 1))], axis=2).ravel()
    im.filepath_raw = os.path.join(OUT, f'{SET}_{name}.png'); im.file_format = 'PNG'; im.save()


# MOVES_ONLY=a,b: draw and check only these clips (all are still keyed and exported)
ONLY = [n for n in os.environ.get('MOVES_ONLY', '').split(',') if n]
acts = {}
for name, fn in CLIPS.items():
    total, keys = fn()
    acts[name] = key_clip(name, total, keys)
    if ONLY and name not in ONLY: continue
    n = 8
    strip(name, sorted({round(i * total / (n - 1)) for i in range(n)} | {k[0] for k in keys}), any(k[1]['fall'] > 45 for k in keys))
    body, tip = lows(total)
    print(f'MOVES {name}: {total} ticks, body low {min(body):.3f}..{max(body):.3f}, tip low {min(tip):.3f} at {tip.index(min(tip))}')

# ---- the clips, on the skeleton alone ----------------------------------------------------------
arm.animation_data.action = None
bpy.data.objects.remove(mesh)
bpy.data.objects.remove(blade)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, f'{SET}.glb'), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False,
)
for f in os.listdir(SHOTS): os.remove(os.path.join(SHOTS, f))
os.rmdir(SHOTS)
print(f'MOVES {SET}: {", ".join(acts)} -> {OUT}')
