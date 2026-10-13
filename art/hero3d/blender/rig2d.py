"""Render the hero's 3D model as the parts of its 2D cut-out skeleton, in the ink look.
usage: blender -b --python art/hero3d/blender/rig2d.py -- parts <outdir>
       blender -b --python art/hero3d/blender/rig2d.py -- debug <outdir>

parts: one full-frame render per part (<outdir>/parts/<part>.png) in the rest pose, plus
<outdir>/rest.json: each part's pivot and angle there in render pixels and the ground point
between the feet. art/hero3d/rig2d_spec.py turns them into a pack_tao spec with the clips of
art/rig_r3/anims.py, so only the images change, not the moves.
debug: the whole body in the rest pose (full.png) and the parts in flat colours (cut.png).

The rest pose is rig_r3's: side-on, facing right, the arms hanging a little forward and back,
the legs straight, a sword in the near (front, R) hand. The frame is drawn at rig_r3's scale
(sole to topknot 1042 px, sole at y 1115), so the clips' offsets keep their size.
Bones are the hero's: no feet (the shin carries the boot), plus robe (the skirt below the
sash), sash (its hanging ties) and scarf, cut from the mesh by colour and position; the sword
is modelled here, the model's hands are empty.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', 'model')
argv = sys.argv[sys.argv.index('--') + 1:]
WHAT, OUT = argv[0], argv[1]

PX_H = 1042                  # sole to topknot, render px (rig_r3's painting)
RES_X, RES_Y = 1900, 1250
AT = (620, 1115)             # where the ground point lands

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(MODEL, 'rig_v1.glb'))
sc = bpy.context.scene
for o in list(sc.objects):
    if o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o)
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
mesh = next(o for o in sc.objects if o.type == 'MESH')
P = arm.pose.bones
MW = arm.matrix_world
MWi = MW.inverted()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def upd():
    bpy.context.view_layer.update()


def wpos(name, tail=False):
    pb = P[name]
    return MW @ (pb.tail if tail else pb.head)


def rot_about(pb, q, pivot):
    """Turn a bone (and its children) by the world rotation q about a world point."""
    R = (MWi.to_3x3() @ q.to_matrix() @ MW.to_3x3()).normalized().to_4x4()
    piv = MWi @ pivot
    pb.matrix = Matrix.Translation(piv) @ R @ Matrix.Translation(-piv) @ pb.matrix
    upd()


def aim(name, child, target):
    """Swing a bone the least way so that its child's head lands on the line to target."""
    h = wpos(name)
    rot_about(P[name], (wpos(child) - h).rotation_difference(target - h), h)


def screen_dir(deg, out=0.0):
    """A direction in the camera plane, degrees from straight down toward the facing side (+x),
    tipped `out` of the plane (toward +y)."""
    a = math.radians(deg)
    return Vector((math.sin(a), out, -math.cos(a))).normalized()


# ---- fingers (as the archer: Tripo's hands are open flat plates) --------------------------
def add_fingers():
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    toarm = MWi @ mesh.matrix_world
    for side in 'LR':
        hb = eb[f'{side}_Hand']
        h, u = hb.head.copy(), hb.tail - hb.head
        g = mesh.vertex_groups[f'{side}_Hand']
        vs = []
        for v in mesh.data.vertices:
            w = next((e.weight for e in v.groups if e.group == g.index), 0.0)
            if w > 0:
                vs.append((v, w, (toarm @ v.co - h).dot(u) / u.length_squared))
        tip = max(p for _, w, p in vs if w > 0.3)
        k1 = 0.53 * tip
        k2 = k1 + 0.45 * (tip - k1)
        prev = hb
        for i, (a, b) in enumerate(((k1, k2), (k2, tip))):
            fb = eb.new(f'{side}_Fingers{i + 1}')
            fb.head, fb.tail = h + u * a, h + u * b
            fb.roll = hb.roll
            fb.parent = prev
            prev = fb
        groups = [g] + [mesh.vertex_groups.new(name=f'{side}_Fingers{i}') for i in (1, 2)]
        step = lambda p, k: min(1.0, max(0.0, (p - k) / 0.08 + 0.5))
        for v, w, p in vs:
            t1, t2 = step(p, k1), step(p, k2)
            for grp, x in zip(groups, (1 - t1, t1 - t2, t2)):
                if x > 0:
                    grp.add([v.index], w * x, 'REPLACE')
                elif grp is g:
                    grp.remove([v.index])
    bpy.ops.object.mode_set(mode='OBJECT')


add_fingers()
upd()
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
H = max(p.z for p in pts) - min(p.z for p in pts)


def fist(side):
    """The hollow of the closed hand, where a grip passes through."""
    return (wpos(f'{side}_Fingers1') + wpos(f'{side}_Fingers2', True)) / 2


SIGN = {'L': -1, 'R': 1}  # the palm faces the hand bone's -x on the left, +x on the right


def axis(side, i):
    return (MW @ P[f'{side}_Hand'].matrix).to_3x3().col[i].normalized()


def roll(side, d):
    """Roll the forearm (spread over its twist bones) so the palm faces d."""
    e, w = wpos(f'{side}_Forearm'), wpos(f'{side}_Hand')
    a = (w - e).normalized()
    n = SIGN[side] * axis(side, 0)
    n, d = (n - a * n.dot(a)).normalized(), (d - a * d.dot(a)).normalized()
    ang = math.atan2(n.cross(d).dot(a), n.dot(d))
    rot_about(P[f'{side}_Forearm'], Quaternion(a, ang), e)
    rot_about(P[f'{side}_ForearmTwist01'], Quaternion(a, -ang * 2 / 3), e)
    rot_about(P[f'{side}_ForearmTwist02'], Quaternion(a, ang / 3), wpos(f'{side}_ForearmTwist02'))


def hand(side, palm, curl, bend=0.0):
    """Straighten the wrist along the forearm, roll the palm to face `palm`, bend the hand
    `bend` degrees toward the back (the little finger's side, in the camera plane), then close
    the fingers by `curl` degrees at each joint."""
    e, w = wpos(f'{side}_Forearm'), wpos(f'{side}_Hand')
    h = (wpos(f'{side}_Hand', True) - w).normalized()
    rot_about(P[f'{side}_Hand'], h.rotation_difference((w - e).normalized()), w)
    roll(side, palm)
    if bend:
        rot_about(P[f'{side}_Hand'], Quaternion(Y, math.radians(bend)), w)
    for b in ('Fingers1', 'Fingers2'):
        name = f'{side}_{b}'
        u = (wpos(name, True) - wpos(name)).normalized()
        rot_about(P[name], Quaternion(u.cross(SIGN[side] * axis(side, 0)).normalized(), math.radians(curl)), wpos(name))


# ---- the rest pose ------------------------------------------------------------------------
# rig_r3's rest directions (art/rig_r3/anims.py); the arms swing in the camera plane, held a
# little out from the body so the hands clear the robe
ARMS = {'R': (22, 27), 'L': (-19, -19)}
OUT_Y = {'R': -0.12, 'L': 0.12}
GRIP, LOOSE = 88, 70   # finger curl: round the sword's grip, the empty hand a loose fist
DIP = 30               # the sword hand bent back at the wrist, so the blade points forward-down
TILT = 15              # and the blade tipped further down across the fist


def pose_rest():
    for side in 'LR':
        th, ca, fo = f'{side}_Thigh', f'{side}_Calf', f'{side}_Foot'
        aim(th, ca, wpos(th) + screen_dir(0, (wpos(ca) - wpos(th)).normalized().y))
        aim(ca, fo, wpos(ca) + screen_dir(0, (wpos(fo) - wpos(ca)).normalized().y))
    for side, (up, lo) in ARMS.items():
        aim(f'{side}_Upperarm', f'{side}_Forearm', wpos(f'{side}_Upperarm') + screen_dir(up, OUT_Y[side]))
        aim(f'{side}_Forearm', f'{side}_Hand', wpos(f'{side}_Forearm') + screen_dir(lo, OUT_Y[side] * 0.5))
    # palms to the thighs, thumbs forward
    hand('R', Y, GRIP, DIP)
    hand('L', -Y, LOOSE)


# ---- the sword: a jian, its grip through the near fist -------------------------------------
BLADE, GRIP_LEN = 0.62, 0.10   # in body heights
# ink-black like the painted hero's sword: the blade a shade off the outline, the hilt warmer
STEEL, DARK = (0.012, 0.011, 0.014), (0.03, 0.02, 0.016)


def box(name, size, at, color):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(at)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    me.materials.append(m)
    return ob


def make_sword():
    """Built along +x from the grip's middle at the origin, then placed in the fist."""
    h = H
    parts = [
        box('s_grip', (GRIP_LEN * h, 0.016 * h, 0.022 * h), (0, 0, 0), DARK),
        box('s_pommel', (0.018 * h, 0.026 * h, 0.03 * h), (-GRIP_LEN / 2 * h - 0.009 * h, 0, 0), DARK),
        box('s_guard', (0.016 * h, 0.03 * h, 0.075 * h), (GRIP_LEN / 2 * h + 0.008 * h, 0, 0), DARK),
    ]
    # the blade: a flat strip narrowing to a point
    bm = bmesh.new()
    x0 = GRIP_LEN / 2 * h + 0.016 * h
    w0, w1, t = 0.019 * h, 0.012 * h, 0.004 * h
    L = BLADE * h
    ring = []
    for x, w in ((x0, w0), (x0 + L * 0.93, w1)):
        ring.append([bm.verts.new((x, s * t, z * w)) for s, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    tip = bm.verts.new((x0 + L, 0, 0))
    bm.faces.new(ring[0][::-1])
    for i in range(4):
        bm.faces.new((ring[0][i], ring[0][(i + 1) % 4], ring[1][(i + 1) % 4], ring[1][i]))
        bm.faces.new((ring[1][i], ring[1][(i + 1) % 4], tip))
    me = bpy.data.meshes.new('s_blade')
    bm.to_mesh(me)
    bm.free()
    blade = bpy.data.objects.new('s_blade', me)
    m = bpy.data.materials.new('s_blade')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*STEEL, 1)
    me.materials.append(m)
    parts.append(blade)
    for ob in parts:
        sc.collection.objects.link(ob)
    # join into one object
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[-1]
    bpy.ops.object.join()
    sword = bpy.context.view_layer.objects.active
    sword.name = 'sword'
    return sword


def place_sword(sword):
    """Grip through the fist along the knuckles (the hand's forward axis in the camera plane)."""
    w = wpos('R_Hand')
    d = (wpos('R_Hand', True) - w)
    d.y = 0
    d.normalize()
    fwd = Vector((-d.z, 0, d.x))  # d turned a quarter toward the facing side
    if fwd.x < 0:
        fwd = -fwd
    fwd = Quaternion(Y, math.radians(TILT)) @ fwd
    q = X.rotation_difference(fwd)
    sword.matrix_world = Matrix.Translation(fist('R')) @ q.to_matrix().to_4x4()
    upd()
    return fwd


# ---- ink look (render.py's: two flat tones and an inverted-hull outline) ------------------
SHADE, SAT, INK = 0.62, 0.8, (0.012, 0.010, 0.008)
LINE = 0.009


def toon(m):
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
    N = nt.nodes.new
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    dif = N('ShaderNodeBsdfDiffuse')
    rgb = N('ShaderNodeShaderToRGB')
    nt.links.new(dif.outputs[0], rgb.inputs[0])
    ramp = N('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (SHADE, SHADE, SHADE, 1)
    ramp.color_ramp.elements[1].position = 0.22
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    bw = N('ShaderNodeRGBToBW')
    nt.links.new(rgb.outputs[0], bw.inputs[0])
    nt.links.new(bw.outputs[0], ramp.inputs[0])
    hs = N('ShaderNodeHueSaturation')
    hs.inputs['Saturation'].default_value = SAT
    if link:
        nt.links.new(link.from_socket, hs.inputs['Color'])
    else:
        hs.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
    mul = N('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(hs.outputs[0], mul.inputs['A'])
    nt.links.new(ramp.outputs[0], mul.inputs['B'])
    em = N('ShaderNodeEmission')
    nt.links.new(mul.outputs['Result'], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs['Surface'])


def ink_look(objs):
    ink = bpy.data.materials.new('ink')
    ink.use_nodes = True
    ink.use_backface_culling = True
    nt = ink.node_tree
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs[0].default_value = (*INK, 1)
    nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
    for m in {s.material for o in objs for s in o.material_slots if s.material}:
        toon(m)
        m.use_backface_culling = True
    for o in objs:
        o.data.materials.append(ink)
        sol = o.modifiers.new('outline', 'SOLIDIFY')
        sol.thickness = LINE * H
        sol.offset = 1
        sol.use_flip_normals = True
        sol.use_rim = False
        sol.material_offset = len(o.data.materials) - 1


# ---- camera ---------------------------------------------------------------------------------
def setup_camera(ground):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(35), math.radians(40), math.radians(-20))
    sc.collection.objects.link(sun)
    cam = bpy.data.cameras.new('c')
    cam.type = 'ORTHO'
    cam.ortho_scale = RES_X / PX_H * H
    co = bpy.data.objects.new('c', cam)
    sc.collection.objects.link(co)
    k = PX_H / H
    co.location = Vector((ground.x + (RES_X / 2 - AT[0]) / k, ground.y - 5, ground.z + (AT[1] - RES_Y / 2) / k))
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = co
    return co


def px(p):
    """World point -> render pixel (y down)."""
    k = PX_H / H
    c = sc.camera.location
    return [RES_X / 2 + (p.x - c.x) * k, RES_Y / 2 - (p.z - c.z) * k]


# ---- parts: the mesh cut by vertex groups, colour and position -----------------------------
SIDES = {'b': 'L', 'f': 'R'}
GROUPS = {
    'torso': ['Hip', 'Pelvis', 'Waist', 'Spine01', 'Spine02', 'L_Clavicle', 'R_Clavicle'],
    'head': ['NeckTwist01', 'NeckTwist02', 'Head'],
}
for s, S in SIDES.items():
    GROUPS[f'arm_{s}_upper'] = [f'{S}_Upperarm', f'{S}_UpperarmTwist01', f'{S}_UpperarmTwist02']
    GROUPS[f'arm_{s}_lower'] = [f'{S}_Forearm', f'{S}_ForearmTwist01', f'{S}_ForearmTwist02']
    GROUPS[f'hand_{s}'] = [f'{S}_Hand', f'{S}_Fingers1', f'{S}_Fingers2']
    GROUPS[f'leg_{s}_thigh'] = [f'{S}_Thigh', f'{S}_ThighTwist01', f'{S}_ThighTwist02']
    GROUPS[f'leg_{s}_shin'] = [f'{S}_Calf', f'{S}_CalfTwist01', f'{S}_CalfTwist02', f'{S}_Foot', f'{S}_ToeBase']
OVERLAP = 0.25
REACH = {'arm': 0.07, 'hand': 0.08}


def bones2d():
    """Each part's pivot and a second point that gives its angle."""
    out = {
        'torso': (wpos('Waist'), wpos('NeckTwist01')),
        'robe': (wpos('Waist'), (wpos('L_Calf') + wpos('R_Calf')) / 2),
        'head': (wpos('NeckTwist01'), wpos('Head', True)),
        'scarf': (wpos('NeckTwist01'), wpos('Head', True)),
    }
    knot = Vector((wpos('L_Thigh').x / 2 + wpos('R_Thigh').x / 2 + APRON_X * H * 2, 0, GROUND.z + BELT_Z * H))
    out['sash'] = (knot, knot - Z)
    for s, S in SIDES.items():
        out[f'arm_{s}_upper'] = (wpos(f'{S}_Upperarm'), wpos(f'{S}_Forearm'))
        out[f'arm_{s}_lower'] = (wpos(f'{S}_Forearm'), wpos(f'{S}_Hand'))
        out[f'hand_{s}'] = (wpos(f'{S}_Hand'), fist(S))
        out[f'leg_{s}_thigh'] = (wpos(f'{S}_Thigh'), wpos(f'{S}_Calf'))
        out[f'leg_{s}_shin'] = (wpos(f'{S}_Calf'), wpos(f'{S}_Foot'))
    return out


def seg_dist(p, a, b):
    d = b - a
    t = max(0.0, min(1.0, (p - a).dot(d) / d.length_squared))
    return (p - (a + d * t)).length


def vertex_colours():
    """Each vertex's texture colour (the mean over its loops), linear RGB."""
    img = next(i for i in bpy.data.images if i.name.startswith('Color'))
    w, h = img.size
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    uv = mesh.data.uv_layers.active.data
    acc = np.zeros((len(mesh.data.vertices), 4), dtype=np.float32)
    for lp in mesh.data.loops:
        u, v = uv[lp.index].uv
        c = pix[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w)))]
        acc[lp.vertex_index, :3] += c[:3]
        acc[lp.vertex_index, 3] += 1
    return acc[:, :3] / np.maximum(acc[:, 3:], 1)


# the extra cloth parts, by position (in body heights over the ground) and colour: the scarf is
# the red below the topknot's tie; the robe the skirt from the belt to the hem, away from the
# trouser legs; the sash the short front apron hanging from the knot (it swings on its own)
BELT_Z = 0.585           # the belt's lower edge
APRON_Z = 0.38           # the front apron's hem
APRON_X = 0.02           # the apron hangs in front of this (past the hips' middle)
TROUSER = 0.045          # a trouser leg's reach from its thigh bone
HEM_Z = 0.25
# the hem's ragged strips hang close round the knees: down there only the trouser's core stays
# on the leg, or the strips swing with the thighs in a wide stance
STRIPS_Z, STRIPS_TROUSER = 0.36, 0.03
ARMS_ = [g for p, gs in GROUPS.items() if p.startswith(('arm', 'hand')) for g in gs]
LEGS_ = [g for p, gs in GROUPS.items() if p.startswith('leg') for g in gs]


def classify(pos, col, weight):
    """Vertex index sets for scarf, sash and robe, and the leg-weighted cloth above the belt
    (it goes with the torso), which leave the parts they are weighted to."""
    red = (col[:, 0] > 2.0 * col[:, 1]) & (col[:, 0] > 0.04)
    cx = (wpos('L_Thigh').x + wpos('R_Thigh').x) / 2
    scarf, sash, robe, belt = set(), set(), set(), set()
    thighs = [(wpos(f'{S}_Thigh'), wpos(f'{S}_Calf')) for S in 'LR']
    for i, p in enumerate(pos):
        z = (p.z - GROUND.z) / H
        w = weight[i]
        armed = sum(w.get(g, 0) for g in ARMS_) > 0.1
        if red[i] and 0.6 < z < 0.9 and not armed:
            scarf.add(i)
        elif armed:
            continue
        elif z >= BELT_Z:
            if sum(w.get(g, 0) for g in LEGS_) > 0:
                belt.add(i)
        elif z > APRON_Z and p.x > cx + APRON_X * H:
            sash.add(i)
        elif z > HEM_Z and min(seg_dist(p, a, b) for a, b in thighs) > (STRIPS_TROUSER if z < STRIPS_Z else TROUSER) * H:
            robe.add(i)
    return scarf, sash, robe, belt


def evaluated_positions():
    sol = mesh.modifiers.get('outline')
    if sol:
        sol.show_viewport = False
    upd()
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    pos = [mesh.matrix_world @ v.co for v in ev.data.vertices]
    if sol:
        sol.show_viewport = True
    return pos


def cut_parts(pos, col):
    gi = {g.index: g.name for g in mesh.vertex_groups}
    weight = []
    for v in mesh.data.vertices:
        w = {}
        for e in v.groups:
            w[gi[e.group]] = w.get(gi[e.group], 0) + e.weight
        weight.append(w)
    bones = bones2d()
    scarf, sash, robe, belt = classify(pos, col, weight)
    special = scarf | sash | robe | belt
    owned = {'scarf': scarf, 'sash': sash, 'robe': robe, 'torso': set(belt)}
    for part, groups in GROUPS.items():
        keep = [sum(w.get(g, 0) for g in groups) >= OVERLAP and i not in special for i, w in enumerate(weight)]
        r = REACH.get(part.split('_')[0])
        if r:
            a, b = bones[part]
            for i, p in enumerate(pos):
                if keep[i] and seg_dist(p, a, b) > r * H:
                    keep[i] = False
                    owned.setdefault('torso', set()).add(i)
        owned[part] = owned.get(part, set()) | {i for i, k in enumerate(keep) if k}
    objs = {}
    for part, keep in owned.items():
        ob = mesh.copy()
        ob.data = mesh.data.copy()
        ob.name = part
        sc.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(v.index in keep for v in f.verts)], context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
        objs[part] = ob
    mesh.hide_render = True
    for m in mesh.data.materials:
        if m and m.name != 'ink':
            m.use_backface_culling = False
    return objs


# ---- main -------------------------------------------------------------------------------------
pose_rest()
sword = make_sword()
fwd = place_sword(sword)
pos0 = evaluated_positions()
GROUND = Vector(((wpos('L_Foot').x + wpos('R_Foot').x) / 2, 0, min(p.z for p in pos0)))
ink_look([mesh, sword])
setup_camera(GROUND)


def sample():
    out = {}
    for name, (a, b) in bones2d().items():
        pa, pb = px(a), px(b)
        out[name] = {'pivot': [round(v, 2) for v in pa],
                     'angle': round(math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])), 2),
                     'len': round(math.hypot(pb[0] - pa[0], pb[1] - pa[1]), 2)}
    g = fist('R')
    pa, pb = px(g), px(g + fwd)
    out['sword'] = {'pivot': [round(v, 2) for v in pa],
                    'angle': round(math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])), 2), 'len': 1}
    return out


os.makedirs(OUT, exist_ok=True)
if WHAT == 'debug':
    sc.render.filepath = os.path.join(OUT, 'full.png')
    bpy.ops.render.render(write_still=True)
    # each part in its own flat colour
    objs = cut_parts(pos0, vertex_colours())
    import colorsys
    for i, (name, ob) in enumerate(sorted(objs.items())):
        m = bpy.data.materials.new('flat_' + name)
        m.use_nodes = True
        nt = m.node_tree
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs[0].default_value = (*colorsys.hsv_to_rgb(i / len(objs), 0.8, 0.9), 1)
        nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
        ob.modifiers.remove(ob.modifiers['outline'])
        ob.data.materials.clear()
        ob.data.materials.append(m)
        print('PART', name, len(ob.data.polygons), colorsys.hsv_to_rgb(i / len(objs), 0.8, 0.9))
    sc.render.filepath = os.path.join(OUT, 'cut.png')
    bpy.ops.render.render(write_still=True)
    print('REST', json.dumps(sample()))
else:
    objs = cut_parts(pos0, vertex_colours())
    objs['sword'] = sword
    rest = sample()
    rest['_ground'] = px(GROUND)
    rest['_res'] = [RES_X, RES_Y]
    os.makedirs(os.path.join(OUT, 'parts'), exist_ok=True)
    for part in objs:
        for o in objs.values():
            o.hide_render = o.name != part
        sc.render.filepath = os.path.join(OUT, 'parts', f'{part}.png')
        bpy.ops.render.render(write_still=True)
    json.dump(rest, open(os.path.join(OUT, 'rest.json'), 'w'), indent=1)
    print('parts', len(objs))
