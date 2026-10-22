# Rigs a Tripo H2.5 model on the Tripo 41-bone skeleton of art/hero3d/model/rig_v1.glb, so the
# archer's clips (art/archer3d/model/anim_*.glb) play on it unchanged.
#
#   blender -b --python art/model3d/rig.py -- <name> [<out_dir>]     # name: a key of joints.json
#
# The clips set every bone's local rotation outright, so the new skeleton must share the template's
# rest rotations bone for bone; only the bone lengths may differ. So: bones are laid along the
# model's own joints (joints.json), the mesh is skinned there with automatic weights, then every bone
# is posed back to the template's rest orientation and that pose (with the mesh it deforms) becomes
# the new rest. Writes <out_dir>/rig_v1.glb (default: next to the model) and a front render.
import bpy, json, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, '..', 'hero3d', 'model', 'rig_v1.glb')
args = sys.argv[sys.argv.index('--') + 1:]
NAME = args[0]
J = json.load(open(os.path.join(HERE, 'joints.json')))[NAME]
OUT = args[1] if len(args) > 1 else os.path.join(HERE, os.path.dirname(J['glb']))


def joint(key, side=''):
    """Landmark `key`; side 'R' mirrors the left one unless R_<key> is given."""
    if side == 'R':
        if 'R_' + key in J: return Vector(J['R_' + key])
        x, y, z = J[key]
        return Vector((x, -y, z))
    return Vector(J[key])


def lerp(a, b, t): return a + (b - a) * t


def layout():
    """Head and tail of every bone, from the landmarks."""
    P, N, H = joint('pelvis'), joint('neck'), joint('head')
    s1, s2 = lerp(P, N, 0.21), lerp(P, N, 0.63)
    b = {
        'Waist': (P, s1), 'Spine01': (s1, s2), 'Spine02': (s2, N),
        'NeckTwist01': (N, lerp(N, H, 0.3)), 'NeckTwist02': (lerp(N, H, 0.3), lerp(N, H, 0.5)),
        'Head': (lerp(N, H, 0.5), H),
    }
    for s in 'LR':
        sh, el, wr, ha = (joint(k, s) for k in ('shoulder', 'elbow', 'wrist', 'hand'))
        hp, kn, an, to = (joint(k, s) for k in ('hip', 'knee', 'ankle', 'toe'))
        cl = Vector((N.x, sh.y * 0.25, N.z))
        ball = Vector((lerp(an.x, to.x, 0.5), lerp(an.y, to.y, 0.5), to.z))
        b.update({
            f'{s}_Clavicle': (cl, sh),
            f'{s}_Upperarm': (sh, el), f'{s}_UpperarmTwist01': (sh, lerp(sh, el, 0.5)), f'{s}_UpperarmTwist02': (lerp(sh, el, 0.5), el),
            f'{s}_Forearm': (el, wr), f'{s}_ForearmTwist01': (el, lerp(el, wr, 0.5)), f'{s}_ForearmTwist02': (lerp(el, wr, 0.5), wr),
            f'{s}_Hand': (wr, ha),
            f'{s}_Thigh': (hp, kn), f'{s}_ThighTwist01': (hp, lerp(hp, kn, 0.5)), f'{s}_ThighTwist02': (lerp(hp, kn, 0.5), kn),
            f'{s}_Calf': (kn, an), f'{s}_CalfTwist01': (kn, lerp(kn, an, 0.5)), f'{s}_CalfTwist02': (lerp(kn, an, 0.5), an),
            f'{s}_Foot': (an, ball), f'{s}_ToeBase': (ball, to),
        })
    return b


def mode(obj, m):
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode=m)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=TEMPLATE)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH']: bpy.data.objects.remove(o)
rest = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}   # template rest orientations

bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, J['glb']))
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
mesh.data.transform(mesh.matrix_world); mesh.matrix_world = Matrix()
mesh.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))   # Tripo models face -Y; the rig faces +X
mesh.name = NAME
mode(mesh, 'EDIT')
bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0005)
mode(mesh, 'OBJECT')
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
if tris > J['tris']:
    d = mesh.modifiers.new('dec', 'DECIMATE'); d.ratio = J['tris'] / tris
    bpy.ops.object.modifier_apply(modifier='dec')

# bones along the model's joints, each turned from its template direction the shortest way (keeps the roll)
mode(arm, 'EDIT')
eb = arm.data.edit_bones
for e in eb: e.use_connect = False
lay = layout()
P = joint('pelvis')
for e in eb:
    h0, t0, z0 = e.head.copy(), e.tail.copy(), e.z_axis.copy()
    if e.name in lay: h, t = lay[e.name]
    elif e.name == 'Root': h = Vector((P.x, P.y, 0)); t = h + (t0 - h0)
    else: h = P; t = P + (t0 - h0)   # Hip, Pelvis
    e.head, e.tail = h, t
    e.align_roll((t0 - h0).rotation_difference(t - h) @ z0)

mode(mesh, 'OBJECT')
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# bone heat leaves stray bits (loose shells, thin cloth) unweighted; three.js would pull them to the
# origin, so they go whole to the nearest bone
loose = [v for v in mesh.data.vertices if not any(g.weight > 0 for g in v.groups)]
def seg_dist(p, b):
    h, t = b.head_local, b.tail_local
    d = t - h
    k = max(0.0, min(1.0, (p - h).dot(d) / d.length_squared))
    return (p - (h + d * k)).length
for v in loose:
    b = min(arm.data.bones, key=lambda b: seg_dist(v.co, b))
    mesh.vertex_groups[b.name].add([v.index], 1.0, 'REPLACE')
print(f'RIG {NAME}: {len(mesh.data.vertices)} verts, {len(loose)} unweighted fixed')
# a hat (J['headAbove']: the height its brim starts at) rides on the head alone; bone heat lets the
# brim follow the shoulders, and the head then pokes through it
if 'headAbove' in J:
    hat = [v.index for v in mesh.data.vertices if v.co.z >= J['headAbove']]
    for g in mesh.vertex_groups: g.remove(hat)
    mesh.vertex_groups['Head'].add(hat, 1.0, 'REPLACE')
    print(f'RIG {NAME}: {len(hat)} hat verts on the head')

# pose every bone back to the template's rest orientation, parents first, then make that the rest
mode(arm, 'POSE')
def back(b):
    pb = arm.pose.bones[b.name]
    bpy.context.view_layer.update()
    pb.matrix = Matrix.Translation(pb.matrix.translation) @ rest[b.name].to_4x4()
    for c in b.children: back(c)
for b in arm.data.bones:
    if b.parent is None: back(b)
mode(mesh, 'OBJECT')
mod = next(m for m in mesh.modifiers if m.type == 'ARMATURE')
bpy.ops.object.modifier_apply(modifier=mod.name)
mode(arm, 'POSE')
bpy.ops.pose.armature_apply(selected=False)
mode(mesh, 'OBJECT')
mesh.modifiers.new('Armature', 'ARMATURE').object = arm

os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'rig_v1.glb'), export_format='GLB', use_selection=True, export_animations=False)

# front render at the new rest, for a look
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 600, 630
sc.render.film_transparent = True
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.05
cam.location = (3, 0, 0.525); cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
sc.render.filepath = os.path.join(OUT, 'rig_v1.front.png'); bpy.ops.render.render(write_still=True)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
print(f'RIG {NAME}: {tris} tris -> {OUT}')
