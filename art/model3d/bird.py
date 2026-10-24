# Rigs a Tripo bird (or beast) on a small skeleton of its own and keys its clips, one tick a frame (30 fps),
# on the engine's move timing (engine/content.ts). Birds do not fit the 41-bone humanoid, so they
# carry their own clips: idle, walk, hit and fall, and their moves (client pose.ts CLIP_OF).
#
#   blender -b --python art/model3d/bird.py -- <name>        # name: a key of BIRDS
#
# Writes art/model3d/<name>/rig_v1.glb (mesh, skeleton and clips) and a frame strip of each clip
# (<name>/strip_<clip>.png) for a look. The mesh is turned to face +x (three's +x, the way the
# actor faces), cut down to the bird's triangle budget and skinned by region: every vertex weighed
# between the body and the bone of the part it lies in (a wing, the head, the tail), ramped across
# a band so the joins bend. Poses are a rotation per bone in the body's own axes (f forward,
# l left, u up; degrees about f, l, u in that order) plus the body's lift, eased between keys.
import bpy, math, os, sys
from mathutils import Matrix, Vector, Quaternion, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index('--') + 1:]
NAME = args[0]


def ramp(x, a, b):
    """0 below a, 1 above b, smooth between."""
    k = max(0.0, min(1.0, (x - a) / (b - a)))
    return k * k * (3 - 2 * k)


def sine(t, period, phase=0.0):
    return math.sin(2 * math.pi * (t / period + phase))


def pulse(t, a, b):
    """0 outside a..b, up to 1 and back down inside it."""
    return math.sin(math.pi * max(0.0, min(1.0, (t - a) / (b - a))))


def blend(a, b, k):
    """Pose a eased into pose b by k (0..1)."""
    out = {}
    for n in set(a) | set(b):
        if n in ('lift', 'open'):
            out[n] = a.get(n, 0.0) + (b.get(n, 0.0) - a.get(n, 0.0)) * k
        else:
            p, q = a.get(n, (0.0, 0.0, 0.0)), b.get(n, (0.0, 0.0, 0.0))
            out[n] = tuple(p[i] + (q[i] - p[i]) * k for i in range(3))
    return out


# ---- the birds -------------------------------------------------------------------------------
# turn: degrees about up to bring the model's beak round to +x; tris: the budget; size: the
# height (model units) drawn as the engine body's height, the body without its spread wings (kept
# on the rig as `size` for the client); shift: moved by this after the turn, to stand the feet on
# the origin; frame: the strip camera's width; bones: head and tail of each (model units, after the
# turn and shift), parent; weigh: a vertex's (x, y, z) to its bones' weights (the rest goes to
# 'Body'). clips: name -> (ticks, pose(t) -> {bone: (f, l, u) degrees, 'lift': up}), the bird's
# own idle/walk/hit/fall and one per move clip.

def finch_weigh(v):
    x, y, z = v
    w = ramp(abs(y), 0.07, 0.14)
    return {'WingL' if y > 0 else 'WingR': w}


def flap(t, period, up=25.0, down=-45.0, phase=0.0):
    """A wing's angle up about f through a flap: a quick downstroke, a slower lift."""
    p = (t / period + phase) % 1.0
    k = ramp(p, 0.0, 0.4) if p < 0.4 else 1 - ramp(p, 0.4, 1.0)
    return up + (down - up) * k


def wings(a, sweep=0.0):
    """Both wings at `a` degrees up (mirrored), swept back `sweep` degrees."""
    return {'WingL': (a, 0.0, sweep), 'WingR': (-a, 0.0, -sweep)}


def finch_clip(name):
    if name == 'idle':
        # a hover: quick beats, the body bobbing with them
        return 24, lambda t: {**wings(flap(t, 6)), 'lift': 0.015 * sine(t, 6, 0.25)}
    if name == 'walk':
        # flying along: the body pitched a little forward
        return 24, lambda t: {**wings(flap(t, 5, 30, -50)), 'Body': (0, 12, 0), 'lift': 0.02 * sine(t, 5, 0.25)}
    if name == 'hit':
        # knocked back, wings flung up
        return 12, lambda t: {**wings(40 - 20 * ramp(t, 3, 12)), 'Body': (0, -30 * (1 - ramp(t, 2, 12)), 0)}
    if name == 'fall':
        # tumbling down limp: rolled onto its back by the end
        return 20, lambda t: {**wings(10 - 60 * ramp(t, 0, 10), 30 * ramp(t, 0, 12)), 'Body': (0, -100 * ramp(t, 0, 16), 0),
                              'lift': -0.12 * ramp(t, 4, 18)}
    if name == 'flash':
        # a flash as it hovers: wings flung wide and held, a shiver
        return 12, lambda t: {**wings(35 + 6 * sine(t, 2)), 'Body': (0, -15, 0)}
    if name == 'dive':
        # the dive: wings tucked back, beak down, steered by the brain
        return 40, lambda t: {**wings(-60 * ramp(t, 0, 5), 50 * ramp(t, 0, 5)), 'Body': (0, 55 * ramp(t, 0, 6), 0)}
    if name == 'peck':
        # on the ground: two pecks, wings half folded
        return 20, lambda t: {**wings(-40, 30), 'Body': (0, 45 * abs(sine(t, 10)), 0)}
    raise KeyError(name)


def bigfinch_weigh(v):
    x, y, z = v
    wing = ramp(abs(y), 0.12, 0.19) * ramp(z, 0.26, 0.32)
    tail = ramp(-x, 0.09, 0.15) * (1 - ramp(z, 0.18, 0.24)) * (1 - wing)
    head = ramp(z, 0.37, 0.42) * ramp(x, -0.06, 0.0) * (1 - wing)
    return {'WingL' if y > 0 else 'WingR': wing, 'Tail': tail, 'Head': head}


def bigfinch_clip(name):
    # standing, its wings held half open (the model has them raised)
    stand = wings(-35, 25)
    if name == 'idle':
        # pecking at the dirt now and then, the wings breathing
        return 40, lambda t: {**wings(-35 + 4 * sine(t, 40), 25), 'Body': (0, 25 * pulse(t, 20, 34), 0),
                              'Head': (0, 45 * pulse(t, 22, 32), 0), 'Tail': (0, 10 * pulse(t, 20, 34), 0)}
    if name == 'walk':
        # a hop a step, the wings flicked as it lands
        def walk(t):
            k = abs(math.sin(math.pi * t / 12))
            return {**wings(-35 + 25 * (1 - k), 20), 'Body': (0, 8, 0), 'Tail': (0, 20 * (1 - k), 0), 'lift': 0.06 * k}
        return 24, walk
    if name == 'hit':
        # knocked back, wings flung up
        return 12, lambda t: blend({**wings(20), 'Body': (0, -25, 0), 'Head': (0, -20, 0)}, stand, ramp(t, 2, 12))
    if name == 'fall':
        # knocked over onto its back, wings splayed
        return 20, lambda t: {**wings(-35 + 40 * ramp(t, 0, 8), 25 - 15 * ramp(t, 0, 8)), 'Body': (0, -85 * ramp(t, 0, 12), 0),
                              'Head': (0, -20 * ramp(t, 4, 14), 0), 'lift': -0.04 * ramp(t, 4, 12)}
    if name == 'pecks':
        # reared back (16 ticks), a burst of pecks through the active ticks, then settled again
        back = {**wings(5, 10), 'Body': (0, -22, 0), 'Head': (0, -30, 0), 'Tail': (0, 15, 0)}

        def pecks(t):
            if t < 16:
                return blend(stand, back, ramp(t, 0, 14))
            if t < 26:
                k = abs(math.sin(math.pi * (t - 16) / 3.3))
                return {**wings(-5 + 10 * k, 15), 'Body': (0, -5 + 30 * k, 0), 'Head': (0, 45 * k, 0), 'Tail': (0, 15 * k, 0)}
            return blend({**wings(-5, 15), 'Body': (0, -5, 0)}, stand, ramp(t, 27, 44))
        return 44, pecks
    raise KeyError(name)


def pheasant_weigh(v):
    x, y, z = v
    head = ramp(z, 0.52, 0.56) * ramp(x, 0.06, 0.10)
    neck = ramp(z, 0.40, 0.46) * ramp(x, 0.04, 0.09) * (1 - head)
    tails = ramp(-x, 0.18, 0.28)
    far = ramp(-x, 0.42, 0.55)
    leg = ramp(0.15 - z, 0.0, 0.05) * ramp(x, -0.14, -0.10) * (1 - tails)
    wing = (ramp(abs(y), 0.055, 0.09) * ramp(x, -0.26, -0.20) * (1 - ramp(x, 0.06, 0.12))
            * ramp(z, 0.22, 0.27) * (1 - ramp(z, 0.40, 0.45)) * (1 - tails) * (1 - neck - head))
    w = {'Head': head, 'Neck': neck, 'Tail': tails * (1 - far), 'Tail2': tails * far,
         'LegL' if y > 0 else 'LegR': leg, 'WingL' if y > 0 else 'WingR': wing}
    total = sum(w.values())
    return {n: k / total for n, k in w.items()} if total > 1 else w


def pheasant_clip(name):
    def wings(a):
        # Tripo's wings, folded along the back: opened a little by swinging the tips up, then out
        return {'WingL': (0.0, 0.6 * a, -a), 'WingR': (0.0, 0.6 * a, a)}

    def spread(a, sweep=0.0, bend=0.0, k=1.0):
        # the hand-built wings (pheasant_wings): `a` degrees up, swept back `sweep`, the hand bent
        # `bend` more; out by k (0 folded away into the shoulder, swept back as they go)
        k = max(0.0, min(1.0, k))
        sw = sweep + 75 * (1 - k)
        return {'ArmL': (a * k, 0.0, sw), 'ArmR': (-a * k, 0.0, -sw), 'HandL': (bend * k, 0.0, 10 * (1 - k)),
                'HandR': (-bend * k, 0.0, -10 * (1 - k)), 'open': k}

    def beat(t, period, up=80.0, down=-55.0, phase=0.0):
        # a whole flap: the arm through `flap`, the hand trailing it a little
        return spread(flap(t, period, up, down, phase), 0.0, 0.35 * (flap(t, period, up, down, phase - 0.12) - flap(t, period, up, down, phase)))
    rest = spread(0, k=0)
    # the fan's two holds: reared back with the tail raised and the wings mantled high, and the
    # tail whipped over to throw with a downstroke
    rear = {**wings(20), **spread(55, -10, 20), 'Body': (0, -25, 0), 'Neck': (0, -15, 0), 'Tail': (0, 45, 0), 'Tail2': (0, 25, 0)}
    whip = {**wings(20), **spread(-35, 10, -20), 'Body': (0, 25, 0), 'Neck': (0, 20, 0), 'Tail': (0, 85, 0), 'Tail2': (0, 40, 0)}

    def legs(a, b=None):
        return {'LegL': (0, a, 0), 'LegR': (0, -a if b is None else b, 0)}
    if name == 'idle':
        # the head bobbing, the long tail swaying
        return 48, lambda t: {'Neck': (0, 6 * sine(t, 48), 0), 'Tail': (0, 4 * sine(t, 24), 0), 'Tail2': (0, 0, 6 * sine(t, 48))}
    if name == 'walk':
        # stepping, the head pecking forward each step
        return 20, lambda t: {**legs(30 * sine(t, 20)), 'Neck': (0, 12 * abs(sine(t, 20)), 0), 'Tail2': (0, 0, 6 * sine(t, 20)),
                              'lift': 0.01 * abs(sine(t, 20))}
    if name == 'hit':
        return 12, lambda t: blend({**wings(40), 'Body': (0, -20, 0), 'Neck': (0, -25, 0), 'Tail': (0, 20, 0)}, rest, ramp(t, 2, 12))
    if name == 'fall':
        # rolled onto its side, wings flopped open, legs kicked back
        return 20, lambda t: {**wings(30 * ramp(t, 0, 10)), **legs(-60 * ramp(t, 0, 10), -50 * ramp(t, 0, 10)),
                              'Body': (-80 * ramp(t, 0, 12), 0, 0), 'Neck': (0, 25 * ramp(t, 6, 16), 0), 'lift': -0.06 * ramp(t, 4, 12)}
    if name == 'tail':
        # coiled away (21 ticks), a whole turn round on the spot through the active ticks with the
        # tail swung level and trailing, then settled
        coil = {**wings(25), 'Body': (0, 0, -40), 'Tail': (0, 20, 0), 'Tail2': (0, 0, 20), 'lift': -0.03}
        swung = {**wings(35), 'Body': (0, 0, 360), 'Tail': (0, -5, 0), 'Tail2': (0, 0, -30)}

        def tail(t):
            if t < 21:
                return blend(rest, coil, ramp(t, 0, 18))
            if t < 27:
                return {**swung, 'Body': (0, 0, -40 + 400 * (t - 21) / 6), 'lift': -0.02}
            return blend(swung, {'Body': (0, 0, 360)}, ramp(t, 29, 50))
        return 50, tail
    if name == 'soar':
        # a crouch with the wings swinging out and up, then the spring on a downstroke
        crouch = {**wings(20), **spread(80, -10, 25), **legs(-30, -30), 'Body': (0, 20, 0), 'Tail': (0, 15, 0), 'lift': -0.05}
        spring = {**wings(20), **spread(-50, 5, -25), **legs(50, 50), 'Body': (0, -25, 0), 'Tail': (0, -10, 0), 'lift': 0.04}
        return 18, lambda t: blend(rest, crouch, ramp(t, 0, 10)) if t < 10 else blend(crouch, spring, ramp(t, 10, 15))
    if name == 'soarAir':
        # in the air about 27 ticks (hop up 50 against gravity 3.6): two big beats up out of reach,
        # a hover at the top on short quick ones, then the dive on the hero, wings swept back
        # half closed, beak down and talons out; the dive held however long the fall
        fly = {**wings(15), **legs(60, 60), 'Body': (0, -15, 0), 'Tail': (0, -5, 0)}
        dive = {**wings(10), **spread(30, 55, 25), **legs(-45, -45), 'Body': (0, 35, 0), 'Neck': (0, 10, 0), 'Tail': (0, -20, 0),
                'Tail2': (0, -10, 0)}

        def air(t):
            if t < 14:
                # from the spring's downstroke: lift, beat, lift, beat
                return {**fly, **beat(t, 7, 85, -55, 0.4), 'Tail2': (0, -10 * sine(t, 7, 0.3), 0), 'lift': 0.02 * sine(t, 7, 0.55)}
            if t < 19:
                return {**fly, **beat(t, 3, 70, 30), 'Body': (0, -25, 0), 'Tail': (0, 10, 0), 'Tail2': (0, 8 * sine(t, 3), 0)}
            return blend({**fly, **spread(60), 'Body': (0, -25, 0)}, dive, ramp(t, 19, 24))
        return 90, air
    if name == 'soarLand':
        # comes down hard with the wings flung wide and forward, mantles over the hero, then folds them
        slam = {**wings(30), **spread(15, -30, -10), **legs(-20, -20), 'Body': (0, 35, 0), 'Neck': (0, 20, 0), 'Tail': (0, 40, 0),
                'lift': -0.05}
        mantle = {**slam, **spread(45, -10, 25)}
        return 34, lambda t: (blend({**wings(10), **spread(30, 55, 25), 'Body': (0, 35, 0)}, slam, ramp(t, 0, 3)) if t < 4 else
                              blend(slam, mantle, ramp(t, 4, 12)) if t < 12 else blend(mantle, rest, ramp(t, 12, 34)))
    if name == 'fan':
        # reared back, wings mantled, then the tail whipped over to throw (tick 20) on a downstroke,
        # held reared for the next
        return 26, lambda t: (blend(rest, rear, ramp(t, 0, 16)) if t < 16 else
                              blend(rear, whip, ramp(t, 16, 20)) if t < 20 else blend(whip, rear, ramp(t, 20, 26)))
    if name == 'fan2':
        return 14, lambda t: blend(rear, whip, ramp(t, 5, 8)) if t < 8 else blend(whip, rear, ramp(t, 8, 14))
    if name == 'fan3':
        # the last throw (tick 8), then the wings folded away and down to rest
        return 40, lambda t: blend(rear, whip, ramp(t, 5, 8)) if t < 12 else blend(whip, rest, ramp(t, 14, 40))
    if name == 'cry':
        # neck stretched up and beak raised, the wings flung open and shaking
        def cry(t):
            p = ramp(t, 0, 6) * (1 - ramp(t, 28, 36))
            return {**wings(20 * p), **spread(45 + 12 * sine(t, 3), -5, 15, p), 'Neck': (0, -40 * p, 0), 'Head': (0, -30 * p, 0),
                    'Tail': (0, 30 * p, 0)}
        return 36, cry
    raise KeyError(name)


# ---- the beasts ------------------------------------------------------------------------------
# Four-legged and the crane: the same own-skeleton rig as the birds. Legs, where they step, are
# one bone each from the hip or shoulder down, swung about l.

def legs4(front, back):
    """Front legs `front` degrees forward (l negative swings the foot ahead), back legs `back`, each
    pair (left, right)."""
    return {'LegFL': (0, -front[0], 0), 'LegFR': (0, -front[1], 0), 'LegBL': (0, -back[0], 0), 'LegBR': (0, -back[1], 0)}


def buffalo_weigh(v):
    x, y, z = v
    head = ramp(x, 0.3, 0.36)
    neck = ramp(x, 0.14, 0.22) * ramp(z, 0.3, 0.38) * (1 - head)
    # the tail hangs just off the rump, which reaches further back higher up
    edge = 0.42 + 0.03 * ramp(z, 0.35, 0.5)
    tail = ramp(-x, edge, edge + 0.015)
    far = ramp(0.36 - z, 0.0, 0.06)
    leg = ramp(0.24 - z, 0.0, 0.05) * (1 - tail)
    side = 'L' if y > 0 else 'R'
    return {'Head': head, 'Neck': neck, 'Tail': tail * (1 - far), 'Tail2': tail * far,
            ('LegF' if x > -0.1 else 'LegB') + side: leg}


def buffalo_clip(name):
    if name == 'idle':
        # chewing the cud: the head bobbing a little, the tail flicking now and then
        return 90, lambda t: {'Neck': (0, 4 + 3 * sine(t, 45), 0), 'Head': (0, 4 * sine(t, 15), 0),
                              'Tail': (12 * pulse(t, 50, 70) * sine(t, 10), 0, 0), 'Tail2': (18 * pulse(t, 52, 74) * sine(t, 10, -0.15), 0, 0),
                              'lift': 0.004 * sine(t, 45)}
    if name == 'graze':
        # head down into the grass, cropping it, and up again
        def graze(t):
            p = ramp(t, 0, 24) * (1 - ramp(t, 96, 120))
            return {'Neck': (0, 65 * p, 0), 'Head': (0, 35 * p + 8 * p * abs(sine(t, 16)), 6 * p * sine(t, 32)),
                    'LegFL': (0, -6 * p, 0), 'LegFR': (0, -6 * p, 0)}
        return 120, graze
    if name == 'swish':
        # a fly on the flank: the tail lashed side to side, the head turned round at it
        return 36, lambda t: {'Tail': (35 * sine(t, 12) * pulse(t, 0, 36), 0, 0), 'Tail2': (45 * sine(t, 12, -0.15) * pulse(t, 0, 36), 0, 0),
                              'Neck': (0, 0, -20 * pulse(t, 0, 36)), 'Head': (0, 0, -10 * pulse(t, 4, 32))}
    if name == 'walk':
        # a slow walk: legs in diagonal pairs, the head nodding each step
        return 40, lambda t: {**legs4((18 * sine(t, 40), -18 * sine(t, 40)), (-18 * sine(t, 40), 18 * sine(t, 40))),
                              'Neck': (0, 5 + 4 * sine(t, 20), 0), 'Tail2': (10 * sine(t, 40), 0, 0), 'lift': 0.006 * abs(sine(t, 20))}
    raise KeyError(name)


def crane_weigh(v):
    x, y, z = v
    head = ramp(z, 0.88, 0.92) * ramp(x, 0.15, 0.2)
    neck = ramp(z, 0.7, 0.78) * ramp(x, 0.13, 0.17) * (1 - head)
    wing = ramp(z, 0.7, 0.78) * (1 - ramp(x, 0.1, 0.14))
    tail = ramp(-x, 0.08, 0.12) * (1 - ramp(z, 0.6, 0.66)) * ramp(z, 0.28, 0.32)
    return {'Head': head, 'Neck': neck, 'WingL' if y > 0.02 else 'WingR': wing, 'Tail': tail}


def crane_clip(name):
    if name == 'idle':
        # standing: the neck swaying, a look round now and then, the wings breathing
        return 90, lambda t: {'Neck': (0, 3 * sine(t, 90), 0), 'Head': (0, 0, 25 * pulse(t, 40, 75)),
                              'WingL': (2 * sine(t, 45), 0, 0), 'WingR': (-2 * sine(t, 45), 0, 0), 'Tail': (0, 3 * sine(t, 45), 0)}
    if name == 'dip':
        # the neck dipped forward and down to the water, a sip, and up
        def dip(t):
            p = ramp(t, 0, 18) * (1 - ramp(t, 42, 64))
            return {'Neck': (0, 85 * p, 0), 'Head': (0, 40 * p + 10 * p * pulse(t, 24, 36), 0),
                    'Tail': (0, -15 * p, 0)}
        return 64, dip
    if name == 'spread':
        # the wings opened wide, two slow beats, and folded back
        def spread(t):
            p = pulse(t, 0, 72)
            a = 40 * p + 25 * p * sine(t, 24, 0.25)
            return {'WingL': (-a, 0, 15 * p), 'WingR': (a, 0, -15 * p), 'Neck': (0, -15 * p, 0), 'Head': (0, -20 * p, 0),
                    'Tail': (0, 10 * p, 0), 'lift': 0.01 * p}
        return 72, spread
    raise KeyError(name)


def cub_weigh(v):
    x, y, z = v
    head = ramp(z, 0.5, 0.56) * ramp(x, -0.05, 0.02)
    tail = ramp(-x, 0.33, 0.37) * ramp(z, 0.46, 0.52)
    leg = ramp(0.26 - z, 0.0, 0.06)
    side = 'L' if y > 0 else 'R'
    return {'Head': head, 'Tail': tail, ('LegF' if x > -0.05 else 'LegB') + side: leg}


def cub_clip(name):
    if name == 'idle':
        # the big head bobbing, the tail wagging
        return 40, lambda t: {'Head': (0, 4 * sine(t, 40), 5 * sine(t, 80)), 'Tail': (15 * sine(t, 20), 0, 0), 'lift': 0.006 * sine(t, 20)}
    if name == 'walk':
        # a bouncing trot
        return 16, lambda t: {**legs4((25 * sine(t, 16), -25 * sine(t, 16)), (-25 * sine(t, 16), 25 * sine(t, 16))),
                              'Head': (0, 5 * sine(t, 8), 0), 'Tail': (20 * sine(t, 16), 0, 0), 'lift': 0.02 * abs(sine(t, 8))}
    if name == 'hit':
        return 12, lambda t: blend({'Body': (0, -20, 0), 'Head': (0, -20, 0), 'Tail': (0, 20, 0)}, {}, ramp(t, 2, 12))
    if name == 'fall':
        # rolled over onto its side, paws up
        return 20, lambda t: {'Body': (-85 * ramp(t, 0, 12), 0, 0), **legs4((30 * ramp(t, 4, 14),) * 2, (-30 * ramp(t, 4, 14),) * 2),
                              'Head': (0, 15 * ramp(t, 6, 16), 0), 'lift': -0.02 * ramp(t, 4, 12)}
    if name == 'bite':
        # the ink cub's pounce-bite: crouched (12 ticks), the spring and the snap (3), landed and shaken off
        crouch = {'Body': (0, 12, 0), 'Head': (0, 10, 0), **legs4((-20, -20), (25, 25)), 'Tail': (0, -20, 0), 'lift': -0.05}
        leap = {'Body': (0, -15, 0), 'Head': (0, 20, 0), **legs4((50, 50), (-40, -40)), 'Tail': (0, 30, 0), 'lift': 0.08}

        def bite(t):
            if t < 12: return blend({}, crouch, ramp(t, 0, 10))
            if t < 15: return blend(crouch, leap, ramp(t, 12, 15))
            return blend(leap, {}, ramp(t, 15, 31))
        return 31, bite
    raise KeyError(name)


def lioness_weigh(v):
    x, y, z = v
    head = ramp(z, 0.6, 0.68) * ramp(x, -0.02, 0.05)
    tail = ramp(-x, 0.33, 0.38)
    leg = ramp(0.42 - z, 0.0, 0.06) * ramp(x, 0.12, 0.18)
    return {'Head': head, 'Tail': tail, 'LegFL' if y > 0 else 'LegFR': leg}


def lioness_clip(name):
    def paws(a, b): return {'LegFL': (0, -a, 0), 'LegFR': (0, -b, 0)}
    if name == 'idle':
        # sitting guard: breathing, the head turning, the tail flicking
        return 60, lambda t: {'Body': (0, 1.5 * sine(t, 60), 0), 'Head': (0, 3 * sine(t, 60, 0.2), 18 * pulse(t, 25, 55)),
                              'Tail': (0, 0, 15 * sine(t, 30))}
    if name == 'walk':
        # stalking forward: the paws reaching in turn, the body rolling with them
        return 24, lambda t: {**paws(25 * sine(t, 24), -25 * sine(t, 24)), 'Body': (4 * sine(t, 24), 3 * abs(sine(t, 12)), 0),
                              'Tail': (0, 0, 12 * sine(t, 24)), 'lift': 0.015 * abs(sine(t, 12))}
    if name == 'hit':
        return 12, lambda t: blend({'Body': (0, -12, 0), 'Head': (0, -25, 0), **paws(15, 15)}, {}, ramp(t, 2, 12))
    if name == 'fall':
        return 24, lambda t: {'Body': (-80 * ramp(t, 0, 14), -10 * ramp(t, 0, 14), 0), **paws(40 * ramp(t, 4, 16), 20 * ramp(t, 4, 16)),
                              'Head': (0, 20 * ramp(t, 8, 18), 0), 'lift': -0.04 * ramp(t, 4, 14)}
    if name == 'swipe':
        # the paw slap: reared (16 ticks), the near paw slapped down (3), held, back down (24)
        rear = {'Body': (0, -15, 0), 'Head': (0, -10, 0), **paws(70, 10), 'lift': 0.02}
        slap = {'Body': (0, 12, 0), 'Head': (0, 15, 0), **paws(-15, 10)}
        return 43, lambda t: (blend({}, rear, ramp(t, 0, 14)) if t < 16 else blend(rear, slap, ramp(t, 16, 19)) if t < 19
                              else blend(slap, {}, ramp(t, 22, 43)))
    if name == 'roar':
        # the ink roar: drawn back (26 ticks), the head thrust out with the roar shaking it, settled
        back = {'Body': (0, -10, 0), 'Head': (0, -25, 0), 'Tail': (0, 0, 30)}
        roar = {'Body': (0, 10, 0), 'Head': (0, 10, 0), 'Tail': (0, -20, 0)}

        def r(t):
            if t < 26: return blend({}, back, ramp(t, 0, 22))
            if t < 50: return {**blend(back, roar, ramp(t, 26, 30)), 'Head': (4 * sine(t, 3), 10, 0)}
            return blend(roar, {}, ramp(t, 50, 66))
        return 66, r
    raise KeyError(name)


def seal_weigh(v):
    x, y, z = v
    # the block is the seal itself (Body, rigid); the beast on top is the knob
    knob = ramp(z, 0.37, 0.42)
    head = ramp(z, 0.74, 0.8) * ramp(x, -0.04, 0.02)
    tail = ramp(-x, 0.15, 0.2) * ramp(z, 0.46, 0.5) * (1 - head)
    paw = ramp(x, 0.15, 0.2) * (1 - ramp(z, 0.6, 0.66))
    w = {'Head': knob * head, 'Tail': knob * tail, 'PawL' if y > 0 else 'PawR': knob * paw}
    w['Knob'] = knob * max(0.0, 1 - head - tail - paw)
    return w


def seal_clip(name):
    if name == 'idle':
        # the knob beast alive on a still block: looking about, the tail curling
        return 60, lambda t: {'Knob': (0, 3 * sine(t, 60), 0), 'Head': (0, 4 * sine(t, 30), 20 * pulse(t, 20, 50)),
                              'Tail': (0, 10 * sine(t, 30), 0)}
    if name == 'hit':
        return 12, lambda t: blend({'Body': (0, -6, 0), 'Knob': (0, -15, 0), 'Head': (0, -20, 0)}, {}, ramp(t, 2, 12))
    if name == 'fall':
        # toppled onto its side
        return 30, lambda t: {'Body': (-90 * ramp(t, 4, 18) ** 2, 0, 0), 'Knob': (0, 20 * ramp(t, 0, 10), 0), 'Head': (0, 25 * ramp(t, 6, 16), 0)}
    if name == 'stamp':
        # the stamp: risen high (30 ticks), slammed face down (2), pressed into the ground, lifted off (36)
        up = {'Body': (0, -8, 0), 'Knob': (0, -15, 0), 'Head': (0, -25, 0), 'PawL': (0, -40, 0), 'PawR': (0, -40, 0), 'lift': 0.45}
        down = {'Knob': (0, 10, 0), 'Head': (0, 15, 0), 'lift': -0.02}
        return 68, lambda t: (blend({}, up, ramp(t, 0, 26)) if t < 30 else blend(up, down, ramp(t, 30, 32)) if t < 32
                              else blend(down, {}, ramp(t, 50, 68)))
    raise KeyError(name)


# ---- the pheasant's spread wings ------------------------------------------------------------------
# Tripo drew the pheasant with its wings folded on its back, so a beat barely showed. Its flying
# wings are built here instead: a fan of feathers each side, every feather a thin pillow (the
# rachis raised a little above and below its edges, so the ink outline goes round it), painted
# in a band added under the model's picture, one cell per feather. They hang on bones of their
# own (Arm, Hand) and are folded away into the shoulder (Arm scaled to nothing) while it stands.
# A feather: (s along the span from the shoulder, c back from the leading edge, degrees back from
# the span, length, half width, kind), from the bottom layer up.
PHEASANT_FEATHERS = (
    [(0.31 - 0.024 * i, 0.012, 10 + 12 * i, 0.23 - 0.007 * i, 0.034, 'primary') for i in range(7)]
    + [(0.155 - 0.028 * j, 0.02, 82 + 2 * j, 0.17, 0.038, 'secondary') for j in range(6)]
    + [(0.27 - 0.046 * k, 0.0, 68, 0.1, 0.04, 'covert') for k in range(6)]
    + [(0.0, -0.004, 5, 0.33, 0.03, 'marginal')]
)
WING_ROOT = (0.05, 0.035, 0.41)
# the feathers above drawn this much bigger, so a beat reads from the camera
WING_SCALE = 1.2
WING_BAND = 256


def feather_paint(kind, i, a, b):
    """sRGB colour (numpy arrays r, g, b) of a feather at a (0 base .. 1 tip), b (-1 .. 1 across):
    gongbi cinnabar and gold, ink at the tips, a fine rachis and barbs, its edge drawn in."""
    import numpy as np
    def mix(c0, c1, k):
        k = np.clip(k, 0, 1)[..., None]
        return np.array(c0) * (1 - k) + np.array(c1) * k
    red, deep, gold, ink = (0.84, 0.12, 0.09), (0.55, 0.06, 0.06), (0.96, 0.74, 0.38), (0.16, 0.13, 0.12)
    ab = np.abs(b)
    if kind == 'primary':
        c = mix(gold, red, a / 0.35)
        c = mix(c, deep, (a - 0.5) / 0.25)
        c = mix(c, ink, (a - 0.72) / 0.15)
        c = c * (1 - 0.35 * ((np.sin(a * 44) > 0.55) & (a > 0.3) & (a < 0.75)))[..., None]
    elif kind == 'secondary':
        c = mix(red, gold, (ab - 0.62) / 0.2)
        c = mix(c, ink, (a - 0.8) / 0.1)
        c = c * (1 - 0.3 * ((np.sin(a * 38) > 0.6) & (a < 0.78)))[..., None]
    elif kind == 'covert':
        c = mix((0.98, 0.62, 0.22), gold, ab)
        c = mix(c, red, (a - 0.55) / 0.2)
        c = mix(c, ink, (a + 0.25 * ab - 0.86) / 0.08)
    else:
        c = mix(gold, (0.62, 0.6, 0.6), (a - 0.2) / 0.6)
        c = mix(c, ink, (ab - 0.55) / 0.3)
    barbs = 0.92 + 0.08 * np.sin(a * 90 + ab * 30 + i)
    c = c * barbs[..., None]
    c = mix(c, (0.23, 0.13, 0.09), 1 - ab / 0.07)
    c = mix(c, (0.23, 0.13, 0.09), (ab - 0.82) / 0.12)
    return c


def pheasant_wings(mesh):
    """Builds both wings into `mesh` (its UVs moved up to make room for the band) and adds the band
    to its picture."""
    import bmesh
    import numpy as np
    n = len(PHEASANT_FEATHERS)
    # the picture: the model's squeezed into the top, the feathers' cells along the bottom band
    mat = mesh.data.materials[0]
    tex = next(nd for nd in mat.node_tree.nodes if nd.type == 'TEX_IMAGE')
    old = tex.image
    W, H = old.size
    top = old.copy()
    top.scale(W, H - WING_BAND)
    px = np.zeros((H, W, 4), dtype=np.float32)
    px[WING_BAND:] = np.array(top.pixels[:], dtype=np.float32).reshape(H - WING_BAND, W, 4)
    cw = W // n
    v, u = np.mgrid[0:WING_BAND, 0:cw]
    a = (v + 0.5) / WING_BAND
    b = ((u + 0.5) / cw * 2 - 1) / 0.9
    for i, f in enumerate(PHEASANT_FEATHERS):
        px[:WING_BAND, i * cw:(i + 1) * cw, :3] = feather_paint(f[5], i, a, b)
    px[:WING_BAND, :, 3] = 1
    img = bpy.data.images.new('pheasant_wings', W, H)
    img.pixels = px.ravel()
    img.file_format = 'JPEG'
    img.pack()
    tex.image = img
    squeeze = (H - WING_BAND) / H
    uvs = mesh.data.uv_layers.active
    for d in uvs.data:
        d.uv = (d.uv[0], WING_BAND / H + d.uv[1] * squeeze)

    # the feathers, one pillow each: stations along it, the rachis raised above and below
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new(uvs.name)
    dl = bm.verts.layers.deform.verify()
    names = [g.name for g in mesh.vertex_groups]
    for gn in ('ArmL', 'HandL', 'ArmR', 'HandR'):
        if gn not in names: mesh.vertex_groups.new(name=gn); names.append(gn)
    STATIONS = ((0.0, 0.6), (0.35, 1.0), (0.72, 0.95), (0.9, 0.62), (1.0, 0.0))
    for side in (1, -1):
        arm, hand = names.index('ArmL' if side > 0 else 'ArmR'), names.index('HandL' if side > 0 else 'HandR')
        for i, (s0, c0, deg, length, hw, kind) in enumerate(PHEASANT_FEATHERS):
            s0, c0, length, hw = (x * WING_SCALE for x in (s0, c0, length, hw))
            th = math.radians(deg)
            d = Vector((math.cos(th), math.sin(th)))
            nrm = Vector((-d.y, d.x))
            z = WING_ROOT[2] + 0.0022 * i
            bulge = 0.0035
            rows = []
            for a_, w in STATIONS:
                p = Vector((s0, c0)) + d * (a_ * length)
                row = []
                for bb, dz in ((-1, 0), (0, bulge), (0, -bulge), (1, 0)):
                    q = p + nrm * (bb * w * hw)
                    if a_ == 1.0 and row: row.append(row[0]); continue
                    vert = bm.verts.new((WING_ROOT[0] - q.y, side * (WING_ROOT[1] + q.x), z + dz))
                    k = ramp(q.x / WING_SCALE, 0.15, 0.21)
                    vert[dl][arm] = 1 - k
                    if k > 0: vert[dl][hand] = k
                    row.append((vert, (i + 0.5 + 0.45 * bb) * cw / W, a_ * WING_BAND / H))
                rows.append(row)

            def face(*corners):
                seen = set()
                corners = [c for c in corners if not (c[0] in seen or seen.add(c[0]))]
                vs = [c[0] for c in corners]
                if len(vs) < 3: return
                f = bm.faces.new(vs[::side])
                for loop, c in zip(f.loops, corners[::side]):
                    loop[uvl].uv = (c[1], c[2])
            for r0, r1 in zip(rows, rows[1:]):
                # top: left edge, raised rachis, right edge; bottom the same under it
                face(r0[0], r0[1], r1[1], r1[0]); face(r0[1], r0[3], r1[3], r1[1])
                face(r0[0], r1[0], r1[2], r0[2]); face(r0[2], r1[2], r1[3], r0[3])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    faces = len(bm.faces)
    me = bpy.data.meshes.new('wings')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('wings', me)
    bpy.context.scene.collection.objects.link(ob)
    for gn in names: ob.vertex_groups.new(name=gn)
    ob.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.join()
    print(f'BIRD pheasant: wings of {2 * n} feathers, {faces} faces')


BIRDS = {
    'finch': dict(
        glb='finch/finch_A_h25.glb', turn=90, tris=1200, size=0.42,
        bones={'Body': ((0, 0, 0.18), (0, 0, 0.36), None),
               'WingL': ((0, 0.08, 0.36), (0, 0.45, 0.55), 'Body'),
               'WingR': ((0, -0.08, 0.36), (0, -0.45, 0.55), 'Body')},
        weigh=finch_weigh, clip=finch_clip,
        clips=['idle', 'walk', 'hit', 'fall', 'flash', 'dive', 'peck'],
    ),
    'bigfinch': dict(
        glb='bigfinch/bigfinch_A_h25.glb', turn=90, tris=1500, size=0.5,
        bones={'Body': ((0, 0, 0.12), (0, 0, 0.32), None),
               'Head': ((0.04, 0, 0.38), (0.08, 0, 0.5), 'Body'),
               'Tail': ((-0.1, 0, 0.12), (-0.25, 0.15, 0.07), 'Body'),
               'WingL': ((0, 0.12, 0.36), (0, 0.47, 0.58), 'Body'),
               'WingR': ((0, -0.12, 0.36), (0, -0.47, 0.58), 'Body')},
        weigh=bigfinch_weigh, clip=bigfinch_clip,
        clips=['idle', 'walk', 'hit', 'fall', 'pecks'],
    ),
    # Tripo's mesh stands at y 0.09 with its feet at x 0.25, beak to +x
    'pheasant': dict(
        glb='pheasant/pheasant_C_h25.glb', turn=0, shift=(-0.25, -0.09, 0), tris=3000, size=0.64, frame=1.8,
        bones={'Body': ((0.02, 0, 0.18), (0.02, 0, 0.4), None),
               'Neck': ((0.12, 0, 0.42), (0.17, 0, 0.54), 'Body'),
               'Head': ((0.17, 0, 0.54), (0.23, 0, 0.62), 'Neck'),
               'Tail': ((-0.2, 0, 0.32), (-0.45, 0, 0.42), 'Body'),
               'Tail2': ((-0.45, 0, 0.42), (-0.75, 0, 0.6), 'Tail'),
               'WingL': ((0.05, 0.08, 0.38), (-0.2, 0.1, 0.3), 'Body'),
               'WingR': ((0.05, -0.08, 0.38), (-0.2, -0.1, 0.3), 'Body'),
               'LegL': ((0.03, 0.04, 0.17), (0.03, 0.04, 0.0), 'Body'),
               'LegR': ((0.03, -0.04, 0.17), (0.03, -0.04, 0.0), 'Body'),
               # the spread wings' (pheasant_wings): the shoulder out to the wrist, the hand on
               'ArmL': ((0.05, 0.035, 0.41), (0.05, 0.25, 0.41), 'Body'),
               'HandL': ((0.05, 0.25, 0.41), (0.05, 0.59, 0.41), 'ArmL'),
               'ArmR': ((0.05, -0.035, 0.41), (0.05, -0.25, 0.41), 'Body'),
               'HandR': ((0.05, -0.25, 0.41), (0.05, -0.59, 0.41), 'ArmR')},
        weigh=pheasant_weigh, clip=pheasant_clip, extra=pheasant_wings, image='JPEG',
        clips=['idle', 'walk', 'hit', 'fall', 'tail', 'soar', 'soarAir', 'soarLand', 'fan', 'fan2', 'fan3', 'cry'],
    ),
    # the beasts: buffalo and crane drawn facing -y, the rest facing -x (Tripo's default)
    'buffalo': dict(
        glb='buffalo/buffalo_A_h25.glb', turn=180, tris=4000, size=0.65, frame=1.6, image='JPEG',
        bones={'Body': ((-0.15, 0, 0.4), (0.12, 0, 0.42), None),
               'Neck': ((0.14, 0, 0.45), (0.3, 0, 0.5), 'Body'),
               'Head': ((0.3, 0, 0.5), (0.48, 0, 0.42), 'Neck'),
               'Tail': ((-0.44, 0, 0.55), (-0.47, 0, 0.36), 'Body'),
               'Tail2': ((-0.47, 0, 0.36), (-0.48, 0, 0.12), 'Tail'),
               'LegFL': ((0.1, 0.08, 0.28), (0.1, 0.08, 0.0), 'Body'),
               'LegFR': ((0.1, -0.08, 0.28), (0.1, -0.08, 0.0), 'Body'),
               'LegBL': ((-0.35, 0.08, 0.3), (-0.37, 0.08, 0.0), 'Body'),
               'LegBR': ((-0.35, -0.08, 0.3), (-0.37, -0.08, 0.0), 'Body')},
        weigh=buffalo_weigh, clip=buffalo_clip, clips=['idle', 'graze', 'swish', 'walk'],
    ),
    # the crane stands off to its left of the origin by 0.08; its wings are modelled raised
    'crane': dict(
        glb='crane/crane_A_h25.glb', turn=180, shift=(0, -0.08, 0), tris=3000, size=1.0, frame=1.8, image='JPEG',
        bones={'Body': ((-0.05, 0, 0.5), (0.12, 0, 0.62), None),
               'Neck': ((0.14, 0, 0.62), (0.22, 0.02, 0.85), 'Body'),
               'Head': ((0.22, 0.02, 0.85), (0.38, 0.04, 1.0), 'Neck'),
               'WingL': ((0.08, 0.06, 0.72), (-0.35, 0.15, 0.95), 'Body'),
               'WingR': ((0.08, -0.04, 0.72), (-0.15, -0.35, 0.95), 'Body'),
               'Tail': ((-0.1, 0, 0.52), (-0.2, 0, 0.38), 'Body')},
        weigh=crane_weigh, clip=crane_clip, clips=['idle', 'dip', 'spread'],
    ),
    'cub': dict(
        glb='cub/cub_A_h25.glb', turn=90, tris=3000, size=1.0, frame=1.8, image='JPEG',
        bones={'Body': ((-0.35, 0, 0.35), (0.15, 0, 0.4), None),
               'Head': ((0.12, 0, 0.5), (0.35, 0, 0.8), 'Body'),
               'Tail': ((-0.36, 0, 0.48), (-0.45, 0, 0.78), 'Body'),
               'LegFL': ((0.22, 0.12, 0.3), (0.22, 0.12, 0.0), 'Body'),
               'LegFR': ((0.22, -0.12, 0.3), (0.22, -0.12, 0.0), 'Body'),
               'LegBL': ((-0.3, 0.12, 0.3), (-0.3, 0.12, 0.0), 'Body'),
               'LegBR': ((-0.3, -0.12, 0.3), (-0.3, -0.12, 0.0), 'Body')},
        weigh=cub_weigh, clip=cub_clip, clips=['idle', 'walk', 'hit', 'fall', 'bite'],
    ),
    # a guardian lioness sat on her haunches; only the front paws step
    'lioness': dict(
        glb='lioness/lioness_A_h25.glb', turn=90, tris=5000, size=1.0, frame=1.8, image='JPEG',
        bones={'Body': ((-0.25, 0, 0.3), (0.2, 0, 0.6), None),
               'Head': ((0.2, 0, 0.66), (0.45, 0, 0.85), 'Body'),
               'Tail': ((-0.33, 0, 0.3), (-0.46, 0, 0.4), 'Body'),
               'LegFL': ((0.28, 0.13, 0.45), (0.33, 0.13, 0.0), 'Body'),
               'LegFR': ((0.28, -0.13, 0.45), (0.33, -0.13, 0.0), 'Body')},
        weigh=lioness_weigh, clip=lioness_clip, clips=['idle', 'walk', 'hit', 'fall', 'swipe', 'roar'],
    ),
    # the false seal: a stone seal whose knob is a crouched beast
    'seal': dict(
        glb='seal/seal_A_h25.glb', turn=90, tris=6000, size=1.0, frame=1.8, image='JPEG',
        bones={'Body': ((0, 0, 0.0), (0, 0, 0.36), None),
               'Knob': ((0, 0, 0.4), (0.05, 0, 0.65), 'Body'),
               'Head': ((0.1, 0, 0.74), (0.25, 0, 0.95), 'Knob'),
               'Tail': ((-0.17, 0, 0.55), (-0.3, 0, 0.7), 'Knob'),
               'PawL': ((0.2, 0.1, 0.6), (0.27, 0.1, 0.42), 'Knob'),
               'PawR': ((0.2, -0.1, 0.6), (0.27, -0.1, 0.42), 'Knob')},
        weigh=seal_weigh, clip=seal_clip, clips=['idle', 'hit', 'fall', 'stamp'],
    ),
}
B = BIRDS[NAME]
OUT = os.path.join(HERE, NAME)

# ---- the mesh --------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, B['glb']))
meshes = [o for o in sc.objects if o.type == 'MESH']
for o in sc.objects: o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
mesh.parent = None
mesh.matrix_world = (Matrix.Translation(B.get('shift', (0, 0, 0))) @ Matrix.Rotation(math.radians(B['turn']), 4, 'Z')
                     @ mesh.matrix_world)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(sc.objects):
    if o is not mesh: bpy.data.objects.remove(o)
# the game reads only the base colour; newer Tripo exports also carry 4096 normal and roughness
# maps, so those go and the colour comes down to 2048 (as in rig.py)
for mat in mesh.data.materials:
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None: continue
    for key in ('Normal', 'Metallic', 'Roughness'):
        for l in list(bsdf.inputs[key].links): nt.links.remove(l)
    for n in [n for n in nt.nodes if n.type in ('NORMAL_MAP', 'SEPARATE_COLOR')]: nt.nodes.remove(n)
    for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE' and not n.outputs['Color'].links]: nt.nodes.remove(n)
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and n.image.size[0] > 2048: n.image.scale(2048, 2048)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
dec = mesh.modifiers.new('dec', 'DECIMATE')
dec.ratio = B['tris'] / tris
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='dec')
print(f'BIRD {NAME}: {tris} -> {len(mesh.data.polygons)} faces')

# ---- the skeleton ------------------------------------------------------------------------------
arm = bpy.data.objects.new('Rig', bpy.data.armatures.new('Rig'))
sc.collection.objects.link(arm)
arm['size'] = B['size']
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for n, (h, t, parent) in B['bones'].items():
    eb = arm.data.edit_bones.new(n)
    eb.head, eb.tail = Vector(h), Vector(t)
    eb.roll = 0
    if parent: eb.parent = arm.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

# weights by region
groups = {n: mesh.vertex_groups.new(name=n) for n in B['bones']}
for v in mesh.data.vertices:
    w = B['weigh'](tuple(v.co))
    rest = 1.0 - sum(w.values())
    for n, k in w.items():
        if k > 0: groups[n].add([v.index], k, 'REPLACE')
    if rest > 0: groups['Body'].add([v.index], rest, 'REPLACE')
if 'extra' in B: B['extra'](mesh)
mesh.parent = arm
mod = mesh.modifiers.new('arm', 'ARMATURE')
mod.object = arm

# ---- the clips --------------------------------------------------------------------------------
arm.animation_data_create()
pbs = arm.pose.bones
for pb in pbs: pb.rotation_mode = 'QUATERNION'
REST = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in pbs}


def apply(pose):
    for pb in pbs:
        f, l, u = pose.get(pb.name, (0.0, 0.0, 0.0))
        # the turn in the body's axes, brought into the bone's own (see the header)
        r = Euler((math.radians(f), math.radians(l), math.radians(u)), 'XYZ').to_quaternion()
        b = REST[pb.name]
        pb.rotation_quaternion = b.inverted() @ r @ b
        pb.location = (0, 0, 0)
        # wings of a bird's own that fold away (the pheasant's): out by 'open', gone at 0
        pb.scale = (max(pose.get('open', 0.0), 0.001),) * 3 if pb.name in ('ArmL', 'ArmR') else (1, 1, 1)
    body = pbs['Body']
    body.location = REST['Body'].inverted() @ Vector((0, 0, pose.get('lift', 0.0)))


for a in list(bpy.data.actions): bpy.data.actions.remove(a)
acts = []
for name in B['clips']:
    total, pose = B['clip'](name)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for t in range(total + 1):
        apply(pose(t))
        for pb in pbs:
            pb.keyframe_insert('rotation_quaternion', frame=t)
            pb.keyframe_insert('location', frame=t)
            pb.keyframe_insert('scale', frame=t)
    acts.append((name, total, pose))

# ---- a strip of frames, for a look -------------------------------------------------------------
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 320
sc.render.film_transparent = True
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = B.get('frame', 1.3)
# from the game's side, a little above and ahead, so the wings show
aim = bpy.data.objects.new('aim', None); sc.collection.objects.link(aim); aim.location = (0, 0, 0.3)
cam.location = (1.5, -5, 2.0)
cam.constraints.new('TRACK_TO').target = aim
SHOTS = os.path.join(OUT, '_shots')
os.makedirs(SHOTS, exist_ok=True)
for name, total, pose in acts:
    arm.animation_data.action = bpy.data.actions[name]
    frames = sorted({round(i * total / 5) for i in range(6)})
    files = []
    for f in frames:
        sc.frame_set(f)
        sc.render.filepath = os.path.join(SHOTS, f'{f:03d}.png')
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
    imgs = [bpy.data.images.load(p) for p in files]
    w, h = imgs[0].size
    strip = bpy.data.images.new(f'strip_{name}', w * len(imgs), h, alpha=True)
    px = [0.0] * (w * len(imgs) * h * 4)
    for i, im in enumerate(imgs):
        src = list(im.pixels)
        for row in range(h):
            o = (row * w * len(imgs) + i * w) * 4
            px[o:o + w * 4] = src[row * w * 4:(row + 1) * w * 4]
    strip.pixels = px
    strip.filepath_raw = os.path.join(OUT, f'strip_{name}.png')
    strip.file_format = 'PNG'
    strip.save()
for f in os.listdir(SHOTS): os.remove(os.path.join(SHOTS, f))
os.rmdir(SHOTS)

# ---- the model, with its clips ---------------------------------------------------------------
arm.animation_data.action = None
sc.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'rig_v1.glb'), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False, export_extras=True,
    export_image_format=B.get('image', 'AUTO'),
)
print(f'BIRD {NAME}: {", ".join(n for n, _, _ in acts)} -> {OUT}')
