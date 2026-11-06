# Rigs a Tripo H2.5 model on the Tripo 41-bone skeleton of art/hero3d/model/rig_v1.glb, so the
# archer's clips (art/archer3d/model/anim_*.glb) play on it unchanged.
#
#   blender -b --python art/model3d/rig.py -- <name> [<out_dir>]     # name: a key of joints.json
#   python art/model3d/pad.py <out_dir>/rig_v1.glb                     # then pad its picture's islands
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


def stretch(z):
    """J['stretch'] [[z0, z1, s], ...] (bottom up): each band of the model drawn out s times, what
    lies above it lifted with it. The game sizes a body by its height, so longer legs make it
    slimmer too."""
    out = z
    for z0, z1, s in J.get('stretch', ()):
        if z > z0: out += (min(z, z1) - z0) * (s - 1)
    return out


def reach_out(y, z):
    """J['armStretch'] [y0, y1, s, z0, z1]: the arms (out along y in the T-pose, between heights
    z0..z1 before any stretch) drawn out s times from y0 to y1, the hands carried out with them;
    Tripo's bodies come with short arms that cannot bring a sword in to the belly."""
    if 'armStretch' not in J: return y
    y0, y1, s, z0, z1 = J['armStretch']
    a = abs(y)
    if not (z0 <= z <= z1) or a <= y0: return y
    a += (min(a, y1) - y0) * (s - 1)
    return math.copysign(a, y)


def joint(key, side=''):
    """Landmark `key`; side 'R' mirrors the left one unless R_<key> is given."""
    if side == 'R':
        if 'R_' + key in J: x, y, z = J['R_' + key]
        else:
            x, y, z = J[key]; y = -y
    else: x, y, z = J[key]
    return Vector((x, reach_out(y, z), stretch(z)))


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
def clothe_arms():
    """J['armCloth'] [y0, y1, z0, z1]: the bare skin of the upper arm (inside the wide sleeve and
    the gap down to the bracer, out along y in the T-pose) is given the sleeve's cloth by moving its
    UVs onto a texel of it; drawn out by armStretch, that skin read as a bare grey arm."""
    if 'armCloth' not in J: return
    y0, y1, z0, z1 = J['armCloth']
    me = mesh.data
    img = next(n.image for m in me.materials for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.outputs['Color'].links)
    W, H = img.size; px = img.pixels[:]
    uv = me.uv_layers.active.data
    def col(li):
        u, w = uv[li].uv
        i = (int(w % 1 * H) % H * W + int(u % 1 * W) % W) * 4
        return px[i], px[i + 1], px[i + 2]
    red, skin = [], []
    # whole faces only: a face moved in part smears the cloth texel across its other corners
    for p in me.polygons:
        if not all(y0 < abs(me.vertices[i].co.y) < y1 and z0 < me.vertices[i].co.z < z1 for i in p.vertices): continue
        cs = [col(li) for li in p.loop_indices]
        if all(r > 2 * g and r > 0.25 for r, g, b in cs): red.extend(p.loop_indices)
        elif all(r > 0.3 and g > 0.2 and r < 1.8 * g for r, g, b in cs): skin.extend(p.loop_indices)
    if not red: return
    rgb = [col(li) for li in red]
    mid = sorted(range(len(red)), key=lambda i: rgb[i][0])[len(red) // 2]   # a middling red, not a highlight
    tex = uv[red[mid]].uv.copy()
    for li in skin: uv[li].uv = tex
    print(f'RIG {NAME}: {len(skin)} arm skin loops clothed')
clothe_arms()
for v in mesh.data.vertices:
    v.co.y = reach_out(v.co.y, v.co.z)
    v.co.z = stretch(v.co.z)
# the game reads only the base colour; newer Tripo exports also carry 4096 normal and
# roughness maps, so those go and the colour is brought down to the older models' 2048
for mat in mesh.data.materials:
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for key in ('Normal', 'Metallic', 'Roughness'):
        for l in list(bsdf.inputs[key].links): nt.links.remove(l)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.9
    for n in [n for n in nt.nodes if n.type in ('NORMAL_MAP', 'SEPARATE_COLOR')]: nt.nodes.remove(n)
    for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE' and not n.outputs['Color'].links]: nt.nodes.remove(n)
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and n.image.size[0] > 2048: n.image.scale(2048, 2048)
mode(mesh, 'EDIT')
bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0005)
mode(mesh, 'OBJECT')
def decimate():
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    if tris > J['tris']:
        d = mesh.modifiers.new('dec', 'DECIMATE'); d.ratio = J['tris'] / tris
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')
# weightFull: bone heat fails on some decimated meshes (thin cloth turned non-manifold), so those
# are weighted at full detail and decimated after (the decimation carries the weights over)
if not J.get('weightFull'): decimate()

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
# wide sleeves (J['sleeve']: [y0, y1, z0]): bone heat gives a sleeve's root to the chest, so the
# cloth stays out level when the arm comes down to the rest pose and squares the shoulders; above
# z0, from |y| = y0 out to y1, it is handed over smoothly to the upper arm
if 'sleeve' in J:
    y0, y1, z0 = J['sleeve']; n = 0
    names = {g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        ay = abs(v.co.y)
        if v.co.z < stretch(z0) or ay <= y0: continue
        k = min(1.0, (ay - y0) / (y1 - y0)); k = k * k * (3 - 2 * k)
        side = 'L' if v.co.y > 0 else 'R'
        up = f'{side}_UpperarmTwist01' if f'{side}_UpperarmTwist01' in names else f'{side}_Upperarm'
        arm_bones = {f'{side}_{b}' for b in ('Upperarm', 'UpperarmTwist01', 'UpperarmTwist02', 'Forearm', 'ForearmTwist01', 'ForearmTwist02', 'Hand')}
        low = {f'{side}_{b}' for b in ('Forearm', 'ForearmTwist01', 'ForearmTwist02', 'Hand')}
        # the forearm and hand keep theirs (bone heat shares them out among a bone and its twists,
        # so it is their sum that counts); only the chest's share of the rest moves to the upper arm,
        # what the upper arm already holds stays
        if sum(g.weight for g in v.groups if mesh.vertex_groups[g.group].name in low) > 0.5: continue
        moved = 0.0
        for g in v.groups:
            if mesh.vertex_groups[g.group].name in arm_bones: continue
            moved += g.weight * k; g.weight *= 1 - k
        if moved <= 0: continue
        mesh.vertex_groups[up].add([v.index], moved, 'ADD'); n += 1
    print(f'RIG {NAME}: {n} sleeve verts handed to the upper arms')

# a hat (J['headAbove']: the height its brim starts at) rides on the head alone; bone heat lets the
# brim follow the shoulders, and the head then pokes through it
if 'headAbove' in J:
    hat = {v.index for v in mesh.data.vertices if v.co.z >= stretch(J['headAbove'])}
    # hatBrim [z0, r0, r1]: a tilted brim dips below headAbove; it is grown from there along the
    # mesh's edges through the ring r0..r1 off the head's axis above z0 (the sleeves meet the head
    # only inside r0, so they stay out)
    if 'hatBrim' in J:
        z0, r0, r1 = J['hatBrim']
        vs = mesh.data.vertices
        ok = lambda v: v.co.z >= stretch(z0) and r0 <= math.hypot(v.co.x, v.co.y) <= r1
        nb = {}
        for e in mesh.data.edges:
            a, b = e.vertices
            nb.setdefault(a, []).append(b); nb.setdefault(b, []).append(a)
        st = [i for i in hat if ok(vs[i])]; n0 = len(hat)
        while st:
            i = st.pop()
            for j in nb.get(i, ()):
                if j not in hat and ok(vs[j]): hat.add(j); st.append(j)
        print(f'RIG {NAME}: {len(hat) - n0} brim verts below headAbove')
    hat = sorted(hat)
    # hatShrink [r0, k]: the brim drawn in toward the head's axis past r0 (the brim out past the
    # shoulders reads as the hat sunk onto them)
    if 'hatShrink' in J:
        r0, k = J['hatShrink']
        hx, hy = J['head'][0], J['head'][1]
        for i in hat:
            co = mesh.data.vertices[i].co
            dx, dy = co.x - hx, co.y - hy
            r = math.hypot(dx, dy)
            if r > r0:
                f = (r0 + (r - r0) * k) / r
                co.x, co.y = hx + dx * f, hy + dy * f
    for g in mesh.vertex_groups: g.remove(hat)
    mesh.vertex_groups['Head'].add(hat, 1.0, 'REPLACE')
    print(f'RIG {NAME}: {len(hat)} hat verts on the head')
if J.get('weightFull'):
    mode(mesh, 'OBJECT'); decimate()

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
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'rig_v1.glb'), export_format='GLB', use_selection=True, export_animations=False,
                          export_image_format='JPEG')

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
