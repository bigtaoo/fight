# Keys a body's own move clips on the Tripo 41-bone skeleton, one tick a frame (30 fps), so they
# play on every chapter-1 body (all share the template's rest rotations) and line up with the
# engine's move timing (engine/content.ts). The clips set every bone outright, like the archer's.
#
#   blender -b --python art/model3d/moves.py -- [<set>] [<body>]    # set: a key of SETS (woodcutter)
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
# held under strain).
STANCE = dict(
    drop=0.025, shift=0.0, turn=0.0, lean=12.0, twist=0.0, tilt=0.0, nod=-6.0, shake=0.0,
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
        lu = [0.0, 0.07, 0.0, 0.0][i % 4]
        rx = [s, 0.0, -s, 0.0][i % 4]
        ru = [0.0, 0.0, 0.0, 0.07][i % 4]
        # the right foot plants at 0, the left at 18: the hips lowest just after
        dip = [0.055, 0.025, 0.055, 0.025][i % 4]
        sway = [6, 0, -6, 0][i % 4]
        arm = [1, 0, -1, 0][i % 4]
        keys.append((t, P(drop=dip, lean=16, turn=sway * 0.5, twist=-sway, tilt=[-4, 0, 4, 0][i % 4],
                          lf=(lx, 0.035, lu), rf=(rx, -0.035, ru),
                          lh=(0.07 - 0.07 * arm, 0.25, -0.27), rh=(0.07 + 0.07 * arm, -0.25, -0.27)), 'lin' if i == 0 else 'io'))
    return n, keys


SETS = {'woodcutter': {'body': 'wood', 'clips': {'chop': chop, 'sweep': sweep, 'rush': rush, 'leap': leap, 'roar': roar, 'idle': idle, 'walk': walk}}}
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
mesh = next(o for o in objs if o.type == 'MESH')
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
LEN = {n: (arm.data.bones[n].tail_local - arm.data.bones[n].head_local).length for n in ORDER}
print(f'MOVES {SET} on {BODY}: forward {tuple(round(v, 3) for v in F)}')


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
OUT = os.path.join(HERE, 'moves')
os.makedirs(OUT, exist_ok=True)
SHOTS = os.path.join(OUT, '_frames')


def strip(name, ticks):
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


acts = {}
for name, fn in CLIPS.items():
    total, keys = fn()
    acts[name] = key_clip(name, total, keys)
    n = 8
    strip(name, sorted({round(i * total / (n - 1)) for i in range(n)} | {k[0] for k in keys}))
    print(f'MOVES {name}: {total} ticks')

# ---- the clips, on the skeleton alone ----------------------------------------------------------
arm.animation_data.action = None
bpy.data.objects.remove(mesh)
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
