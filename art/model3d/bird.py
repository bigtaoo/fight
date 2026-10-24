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


# ---- the birds -------------------------------------------------------------------------------
# turn: degrees about up to bring the model's beak round to +x; tris: the budget; size: the
# height (model units) drawn as the engine body's height, the body without its spread wings (kept
# on the rig as `size` for the client); bones: head and
# tail of each (model units, after the turn), parent; weigh: a vertex's (x, y, z) to its bones'
# weights (the rest goes to 'Body'). clips: name -> (ticks, pose(t) -> {bone: (f, l, u) degrees,
# 'lift': up}), the bird's own idle/walk/hit/fall and one per move clip.

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


BIRDS = {
    'finch': dict(
        glb='finch/finch_A_h25.glb', turn=90, tris=1200, size=0.42,
        bones={'Body': ((0, 0, 0.18), (0, 0, 0.36), None),
               'WingL': ((0, 0.08, 0.36), (0, 0.45, 0.55), 'Body'),
               'WingR': ((0, -0.08, 0.36), (0, -0.45, 0.55), 'Body')},
        weigh=finch_weigh, clip=finch_clip,
        clips=['idle', 'walk', 'hit', 'fall', 'flash', 'dive', 'peck'],
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
mesh.matrix_world = Matrix.Rotation(math.radians(B['turn']), 4, 'Z') @ mesh.matrix_world
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
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.3
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
