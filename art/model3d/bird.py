# Rigs a Tripo bird on a small skeleton of its own and keys its clips, one tick a frame (30 fps),
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
        if n == 'lift':
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
        # folded along the back, so opened by swinging the tips up, then out
        return {'WingL': (0.0, 0.6 * a, -a), 'WingR': (0.0, 0.6 * a, a)}
    rest = {}
    # the fan's two holds: reared back with the tail raised, and the tail whipped over to throw
    rear = {**wings(50), 'Body': (0, -25, 0), 'Neck': (0, -15, 0), 'Tail': (0, 45, 0), 'Tail2': (0, 25, 0)}
    whip = {**wings(70), 'Body': (0, 25, 0), 'Neck': (0, 20, 0), 'Tail': (0, 85, 0), 'Tail2': (0, 40, 0)}

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
        # a crouch with the wings opening, then the spring
        crouch = {**wings(70), **legs(-30, -30), 'Body': (0, 20, 0), 'Tail': (0, 15, 0), 'lift': -0.05}
        spring = {**wings(20), **legs(50, 50), 'Body': (0, -25, 0), 'Tail': (0, -10, 0), 'lift': 0.04}
        return 18, lambda t: blend(rest, crouch, ramp(t, 0, 10)) if t < 10 else blend(crouch, spring, ramp(t, 10, 15))
    if name == 'soarAir':
        # flying: big slow beats, legs tucked back, the tail streaming
        return 90, lambda t: {**wings(flap(t, 10, 100, 30)), **legs(60, 60), 'Body': (0, -10, 0),
                              'Tail': (0, -5, 0), 'Tail2': (0, -8 * sine(t, 10, 0.3), 0)}
    if name == 'soarLand':
        # comes down hard, wings flung wide, then gathers itself
        slam = {**wings(110), **legs(-20, -20), 'Body': (0, 35, 0), 'Neck': (0, 20, 0), 'Tail': (0, 40, 0), 'lift': -0.05}
        return 34, lambda t: (blend({**wings(100), 'Body': (0, -10, 0)}, slam, ramp(t, 0, 3)) if t < 4 else
                              blend(slam, rest, ramp(t, 6, 34)))
    if name == 'fan':
        # reared back, then the tail whipped over to throw (tick 20), held reared for the next
        return 26, lambda t: (blend(rest, rear, ramp(t, 0, 16)) if t < 16 else
                              blend(rear, whip, ramp(t, 16, 20)) if t < 20 else blend(whip, rear, ramp(t, 20, 26)))
    if name == 'fan2':
        return 14, lambda t: blend(rear, whip, ramp(t, 5, 8)) if t < 8 else blend(whip, rear, ramp(t, 8, 14))
    if name == 'fan3':
        # the last throw (tick 8), then down to rest
        return 40, lambda t: blend(rear, whip, ramp(t, 5, 8)) if t < 12 else blend(whip, rest, ramp(t, 14, 40))
    if name == 'cry':
        # neck stretched up and beak raised, the wings shaking open
        def cry(t):
            p = ramp(t, 0, 6) * (1 - ramp(t, 28, 36))
            return {**wings(p * (60 + 8 * sine(t, 3))), 'Neck': (0, -40 * p, 0), 'Head': (0, -30 * p, 0), 'Tail': (0, 30 * p, 0)}
        return 36, cry
    raise KeyError(name)


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
               'LegR': ((0.03, -0.04, 0.17), (0.03, -0.04, 0.0), 'Body')},
        weigh=pheasant_weigh, clip=pheasant_clip,
        clips=['idle', 'walk', 'hit', 'fall', 'tail', 'soar', 'soarAir', 'soarLand', 'fan', 'fan2', 'fan3', 'cry'],
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
)
print(f'BIRD {NAME}: {", ".join(n for n, _, _ in acts)} -> {OUT}')
