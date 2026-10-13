"""Render one of the archer's clips from the Tripo rig as sprite frames, with the bow.
usage: blender -b --python art/archer3d/blender/render.py -- <clip> <outdir> [frames] [res]

clip: shoot (keyed here, in game ticks: 34, the arrow leaves on 21, as engine/content.ts),
or a retargeted Tripo clip in ../model/anim_<clip>.glb (idle, walk, hit, fall), sampled at
`frames` evenly spaced frames. The camera looks at the archer's right side (it faces screen
right); scale and ground line are the same for every clip so the frames line up in game.
The bow, string and arrow are drawn here, around the rig's hands, not modelled by Tripo.
"""
import bpy, sys, math, os
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', 'model')
argv = sys.argv[sys.argv.index('--') + 1:]
CLIP, OUT = argv[0], argv[1]
NFRAMES = int(argv[2]) if len(argv) > 2 else 8
RES = int(argv[3]) if len(argv) > 3 else 384

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(MODEL, f"anim_{'idle' if CLIP == 'shoot' else CLIP}.glb"))
sc = bpy.context.scene
for o in list(sc.objects):
    if o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o)
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
body = [o for o in sc.objects if o.type == 'MESH']
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


def reach(side, target, pole):
    """Two-bone IK: the wrist to target, the elbow bent toward pole."""
    up, fo, ha = f'{side}_Upperarm', f'{side}_Forearm', f'{side}_Hand'
    s = wpos(up)
    l1, l2 = (wpos(fo) - s).length, (wpos(ha) - wpos(fo)).length
    d = target - s
    dl = min(d.length, (l1 + l2) * 0.999)
    u = d.normalized()
    v = pole - s
    v = (v - u * v.dot(u)).normalized()
    a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl)
    aim(up, fo, s + u * a + v * math.sqrt(max(0.0, l1 * l1 - a * a)))
    aim(fo, ha, s + u * dl)


def lerp(a, b, t):
    return a + (b - a) * t


def ease(t):
    return t * t * (3 - 2 * t)


# ---- fingers ---------------------------------------------------------------------------
# Tripo's rig stops at the wrist and its hands are open and flat, so a bow hand or a drawing
# hand reads as an empty palm held up. Two finger bones per hand (knuckles, middle joints)
# take over the hand's weight past the knuckles; bending them closes the hand.
def add_fingers():
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    mesh = body[0]
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
        k1 = 0.53 * tip  # the knuckles: the palm is about half the hand's length
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

# ---- base pose and measurements --------------------------------------------------------
act = arm.animation_data.action
f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
sc.frame_set(f0)
upd()
pts = [m.matrix_world @ Vector(c) for m in body for c in m.bound_box]
H = max(p.z for p in pts) - min(p.z for p in pts)
GROUND = Vector((wpos('Root').x, wpos('Root').y, min(p.z for p in pts)))
print('H', round(H, 3), 'hand', round((wpos('L_Hand', True) - wpos('L_Hand')).length / H, 3), 'ground', GROUND)


def fist(side):
    """The hollow of the hand: halfway from the knuckles to the fingertips (closed, inside the fist)."""
    return (wpos(f'{side}_Fingers1') + wpos(f'{side}_Fingers2', True)) / 2


# Tripo's hands are open and its arms keep their roll. The bow hand, aiming, turns its palm to
# the archer's front so the fingers close round the upright grip, thumb on top; the drawing
# hand turns its palm to the neck, the back of the hand to the camera.
PALM = {'L': Vector((0, -1, 0)), 'R': Vector((0, 1, 0))}
SIGN = {'L': -1, 'R': 1}  # the palm faces the hand bone's -x on the left, +x on the right
TWISTED = [f'{s}_{b}' for s in 'LR' for b in ('ForearmTwist01', 'ForearmTwist02', 'Fingers1', 'Fingers2')]


def axis(side, i):
    return (MW @ P[f'{side}_Hand'].matrix).to_3x3().col[i].normalized()


def inward(side):
    """At rest the palm faces the thigh: across the body, from this shoulder to the other."""
    d = wpos(f"{'R' if side == 'L' else 'L'}_Upperarm") - wpos(f'{side}_Upperarm')
    d.z = 0
    return d


def hand(side, turn, curl):
    """Roll the forearm so the palm faces the thigh, then by `turn` of the way on to PALM
    (each roll spread along the twist bones), then close the fingers by `curl` degrees at
    each joint. At rest the wrist straightens too: Tripo's hands tip forward, palm up."""
    e, w = wpos(f'{side}_Forearm'), wpos(f'{side}_Hand')
    h = (wpos(f'{side}_Hand', True) - w).normalized()
    rot_about(P[f'{side}_Hand'], Quaternion().slerp(h.rotation_difference((w - e).normalized()), 1 - turn), w)
    roll(side, 1.0, inward(side))
    roll(side, turn, PALM[side])
    for b in ('Fingers1', 'Fingers2'):
        name = f'{side}_{b}'
        u = (wpos(name, True) - wpos(name)).normalized()
        rot_about(P[name], Quaternion(u.cross(SIGN[side] * axis(side, 0)).normalized(), math.radians(curl)), wpos(name))


def roll(side, turn, d):
    e, w = wpos(f'{side}_Forearm'), wpos(f'{side}_Hand')
    a = (w - e).normalized()
    n = SIGN[side] * axis(side, 0)
    n, d = (n - a * n.dot(a)).normalized(), (d - a * d.dot(a)).normalized()
    ang = math.atan2(n.cross(d).dot(a), n.dot(d)) * turn
    rot_about(P[f'{side}_Forearm'], Quaternion(a, ang), e)
    rot_about(P[f'{side}_ForearmTwist01'], Quaternion(a, -ang * 2 / 3), e)
    rot_about(P[f'{side}_ForearmTwist02'], Quaternion(a, ang / 3), wpos(f'{side}_ForearmTwist02'))


# ---- the shot, keyed in ticks ----------------------------------------------------------
# Targets are (anchor, offset in body heights); the anchors move with the body each tick.
# yaw turns the whole body toward the camera (an archer stands side-on to the lane), head
# turns the face back to the lane, lean tips the chest back. wl/wr blend the arms from the
# idle pose to their targets; rc closes the drawing hand's fingers.
REST = 70  # the free hand at rest, a loose fist: open, its palm reads as held out to the camera
BOW_LEN, BRACE = 0.74, 0.09  # bow length and string-to-grip distance at rest, in body heights
QUIVER = ('Rsh', (0.0, 0.07, 0.10))
SHOT = [
    (0, dict(rc=REST, yaw=0, head=0, lean=0, wl=0, wr=0)),
    (5, dict(rc=60, yaw=-65, head=55, lean=0, wl=1, wr=1, L=('Lsh', (0.25, 0, -0.04)), Lp=('Lsh', (0, 0, -1)),
             R=QUIVER, Rp=('Rsh', (-1, 0, -0.4)))),
    (8, dict(rc=80, yaw=-70, head=62, lean=0, wl=1, wr=1, L=('Lsh', (0.29, 0, 0)), Lp=('Lsh', (0, 0, -1)),
             R=('nock', (0, 0, 0)), Rp=('Rsh', (-0.2, 0, -1)))),
    (14, dict(rc=80, yaw=-72, head=64, lean=-2, wl=1, wr=1, L=('Lsh', (0.29, 0, 0)), Lp=('Lsh', (0, 0, -1)),
              R=('cheek', (0, 0, 0)), Rp=('Rsh', (-1, 0.2, 0.05)))),
    (20, dict(rc=80, yaw=-74, head=64, lean=-4, wl=1, wr=1, L=('Lsh', (0.29, 0, 0)), Lp=('Lsh', (0, 0, -1)),
              R=('cheek', (-0.02, 0, 0)), Rp=('Rsh', (-1, 0.2, 0.05)))),
    (21, dict(rc=40, yaw=-74, head=64, lean=-6, wl=1, wr=1, L=('Lsh', (0.30, 0, -0.03)), Lp=('Lsh', (0, 0, -1)),
              R=('cheek', (-0.12, 0.02, 0)), Rp=('Rsh', (-1, 0.2, 0)))),
    (26, dict(rc=60, yaw=-72, head=60, lean=-2, wl=1, wr=1, L=('Lsh', (0.28, 0, -0.04)), Lp=('Lsh', (0, 0, -1)),
              R=('Rsh', (-0.06, 0.03, -0.24)), Rp=('Rsh', (-0.6, 0.2, -1)))),
    (34, dict(rc=REST, yaw=0, head=0, lean=0, wl=0, wr=0)),
]
GRIP = 85  # the bow hand's fingers, closed round the grip, in degrees per joint
DRAWN = (8, 20)  # ticks the drawing hand holds the string
ARROW = (6, 20)  # ticks an arrow is in the hand


def anchor(name):
    if name == 'Lsh':
        return wpos('L_Upperarm')
    if name == 'Rsh':
        return wpos('R_Upperarm')
    if name == 'cheek':  # the jaw on the camera side
        h = wpos('Head')
        return Vector((h.x + 0.025 * H, h.y - 0.04 * H, h.z - 0.005 * H))
    if name == 'nock':  # the string at rest in front of the bow hand
        return fist('L') - X * (BRACE * H)
    raise KeyError(name)


def target(spec):
    a, off = spec
    return anchor(a) + Vector(off) * H


def segment(f):
    for (k0, a), (k1, b) in zip(SHOT, SHOT[1:]):
        if k0 <= f <= k1:
            return a, b, ease((f - k0) / (k1 - k0))
    return SHOT[-1][1], SHOT[-1][1], 0.0


def pose_shot(f):
    a, b, t = segment(f)
    v = lambda k: lerp(a[k], b[k], t)
    rot_about(P['Root'], Quaternion(Z, math.radians(v('yaw'))), wpos('Root'))
    rot_about(P['Spine01'], Quaternion(Y, math.radians(-v('lean'))), wpos('Spine01'))
    for n in ('NeckTwist01', 'Head'):
        rot_about(P[n], Quaternion(Z, math.radians(v('head') / 2)), wpos(n))
    for side, w in (('L', v('wl')), ('R', v('wr'))):
        if w <= 0:
            continue
        cur, elbow = wpos(f'{side}_Hand'), wpos(f'{side}_Forearm')
        ka, kb = a.get(side), b.get(side)
        ta = target(ka) if ka else None
        tb = target(kb) if kb else None
        tt = lerp(ta, tb, t) if ta and tb else (ta or tb)
        pa = target(a[side + 'p']) if ka else None
        pb_ = target(b[side + 'p']) if kb else None
        pp = lerp(pa, pb_, t) if pa and pb_ else (pa or pb_)
        reach(side, lerp(cur, tt, w), lerp(elbow, pp, w))


# ---- bow, string and arrow (poly curves rebuilt each frame) ----------------------------
def curve(name, n, depth, color):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = depth
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    sp.points.add(n - 1)
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    cu.materials.append(m)
    return sp


NB = 41
bow = curve('bow', NB, 0.011 * H, (0.10, 0.055, 0.03))
string = curve('string', 3, 0.0018 * H, (0.30, 0.27, 0.22))
arrow = curve('arrow', 2, 0.0035 * H, (0.55, 0.40, 0.24))
arrowhead = curve('arrowhead', 2, 0.006 * H, (0.25, 0.25, 0.27))


def set_pts(sp, pts, radii=None):
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1)
        sp.points[i].radius = radii[i] if radii else 1.0


def draw_bow(f, aiming):
    grip = fist('L')
    tilt = math.radians(lerp(28, 4, aiming))  # held loose and leaning forward at rest
    up = Quaternion(Y, tilt) @ Z
    fwd = Quaternion(Y, tilt) @ X
    shot = CLIP == 'shoot'
    drawn = shot and DRAWN[0] <= f <= DRAWN[1]
    nock = fist('R') if drawn else None
    pull = 0.0
    if nock is not None:
        pull = max(0.0, min(1.0, ((grip - nock).dot(fwd) / H - BRACE) / 0.25))
    half = BOW_LEN * H / 2
    bend = lerp(0.16, 0.30, pull)
    pts, rad = [], []
    for i in range(NB):
        s = -1 + 2 * i / (NB - 1)
        curl = 0.10 * max(0.0, (abs(s) - 0.72) / 0.28) ** 2
        x = -bend * s * s + curl
        pts.append(grip + up * (s * half) + fwd * (x * half))
        rad.append(1.5 if abs(s) < 0.1 else lerp(1.0, 0.45, abs(s)))
    set_pts(bow, pts, rad)
    top, bot = pts[-1], pts[0]
    mid = nock if nock is not None else (top + bot) / 2
    set_pts(string, [top, mid, bot])
    show = shot and ARROW[0] <= f <= ARROW[1]
    for o in ('arrow', 'arrowhead'):
        bpy.data.objects[o].hide_render = not show
    if show:
        tail = fist('R')
        d = (grip - tail).normalized() if drawn else fwd
        set_pts(arrow, [tail - d * 0.03 * H, tail + d * 0.40 * H])
        set_pts(arrowhead, [tail + d * 0.40 * H, tail + d * 0.44 * H], [1.0, 0.1])


# ---- ink look: two flat tones per colour and a dark brush outline -------------------------
SHADE = 0.62     # the shadow tone, as a fraction of the lit colour
SAT = 0.8        # the texture's saturation, toned down toward the ink backdrops
INK = (0.012, 0.010, 0.008)  # linear: about #1c1a17 on screen


def toon(m):
    """Replace a material with lit/shadow bands of its base colour (texture or constant)."""
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
    alpha = next((l.from_socket for l in nt.links if l.to_socket == bsdf.inputs['Alpha']), None)
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
    shader = em.outputs[0]
    if alpha:
        tr = N('ShaderNodeBsdfTransparent')
        mix = N('ShaderNodeMixShader')
        nt.links.new(alpha, mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        shader = mix.outputs[0]
    nt.links.new(shader, out.inputs['Surface'])


for m in {s.material for o in body for s in o.material_slots if s.material} | \
        {bpy.data.materials[n] for n in ('bow', 'string', 'arrow', 'arrowhead')}:
    toon(m)

# outline: an inverted hull, the mesh pushed out along its normals and drawn back faces only
# (Freestyle draws nothing under EEVEE here)
LINE = 0.009     # outline width, in mesh heights (about 2.3px at 384)
ink = bpy.data.materials.new('ink')
ink.use_nodes = True
ink.use_backface_culling = True
nt = ink.node_tree
em = nt.nodes.new('ShaderNodeEmission')
em.inputs[0].default_value = (*INK, 1)
nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
for o in body:
    for s in o.material_slots:
        if s.material:
            s.material.use_backface_culling = True
    o.data.materials.append(ink)
    sol = o.modifiers.new('outline', 'SOLIDIFY')
    sol.thickness = LINE * H
    sol.offset = 1
    sol.use_flip_normals = True
    sol.use_rim = False
    sol.material_offset = len(o.data.materials) - 1

# ---- camera, light, render -------------------------------------------------------------
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = RES
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'  # flat colours as given, the ink truly dark
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes['Background']
bg.inputs[0].default_value = (1, 1, 1, 1)
bg.inputs[1].default_value = 0.0  # only the sun splits lit from shadow (toon above)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.5
# from above, ahead of the archer (it faces +X) and a little toward the camera: the back and
# the far side fall into the shadow tone
sun.rotation_euler = (math.radians(35), math.radians(40), math.radians(-20))
sc.collection.objects.link(sun)
cam = bpy.data.cameras.new('c')
cam.type = 'ORTHO'
cam.ortho_scale = 1.5 * H
co = bpy.data.objects.new('c', cam)
sc.collection.objects.link(co)
# the feet a tenth of the frame above the bottom edge
co.location = GROUND + Vector((0, -5, 0.6 * H))
co.rotation_euler = (math.radians(90), 0, 0)
sc.camera = co
# imported by rig2d.py for the setup above, the clips rendered only when run directly
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # debugging close-ups: ARCHER_FOCUS=<bone> frames that bone at a tenth of the scale, seen
    # from ARCHER_VIEW degrees round Z (0 is the game camera); ARCHER_TICKS=a,b,.. picks shot ticks
    FOCUS = os.environ.get('ARCHER_FOCUS')
    VIEW = math.radians(float(os.environ.get('ARCHER_VIEW', '0')))

    if CLIP == 'shoot':
        base = {pb.name: pb.matrix_basis.copy() for pb in P}
        arm.animation_data.action = None
        frames = range(0, SHOT[-1][0] + 1)
        if os.environ.get('ARCHER_TICKS'):
            frames = [int(t) for t in os.environ['ARCHER_TICKS'].split(',')]
    else:
        frames = [f0 + round((f1 - f0) * i / max(1, NFRAMES - 1)) for i in range(NFRAMES)]
    for i, f in enumerate(frames):
        if CLIP == 'shoot':
            for pb in P:
                pb.matrix_basis = base[pb.name]
            upd()
            pose_shot(f)
            a, b, t = segment(f)
            hand('L', lerp(a['wl'], b['wl'], t), GRIP)
            hand('R', lerp(a['wr'], b['wr'], t), lerp(a['rc'], b['rc'], t))
            draw_bow(f, lerp(a['wl'], b['wl'], t))
        else:
            for n in TWISTED:
                P[n].matrix_basis = Matrix()
            sc.frame_set(f)
            upd()
            hand('L', 0.0, GRIP)
            hand('R', 0.0, REST)
            draw_bow(f, 0.0)
        if FOCUS:
            c = wpos(FOCUS)
            cam.ortho_scale = 0.25 * H
            cam.clip_start = 5 - 0.12 * H
            co.rotation_euler = (math.radians(90), 0, VIEW)
            co.location = c + Quaternion(Z, VIEW) @ Vector((0, -5, 0))
        sc.render.filepath = os.path.join(OUT, f'{i:02d}.png')
        bpy.ops.render.render(write_still=True)
    print('frames', len(frames))
