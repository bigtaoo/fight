"""Turn the archer's 3D rig into a 2D cut-out skeleton: the parts, rendered in render.py's ink
look, and the clips, as each part's pivot and angle per sample seen from the game camera.
usage: blender -b --python art/archer3d/blender/rig2d.py -- parts <outdir> [res]
       blender -b --python art/archer3d/blender/rig2d.py -- <clip> <outdir> [res]

parts: one full-frame render per part (<outdir>/parts/<part>.png), the mesh cut by its vertex
groups with a little overlap at the joints, in the rest pose (the first tick of the shot: the
idle stance, bow hand closed round the grip), plus <outdir>/rest.json: each part's pivot and
angle there in render pixels, the ground point between the feet, and the extra points the
client draws from (the bow's tips, the nock in the drawing hand).
clip: one of CLIPS below; writes <outdir>/clips/<clip>.json, the same pivot and angle per
sample. art/archer3d/rig2d_spec.py turns both into a pack_tao spec.

The shot is render.py's, with the body kept side-on (no yaw, the head not turned): a cut-out
torso cannot turn toward the camera. The bow arm is the far one (L), the drawing arm the near
one (R), as on the 3D archer.
"""
import bpy, sys, os, math, json
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:]
WHAT, OUT = argv[0], argv[1]
RES = int(argv[2]) if len(argv) > 2 else 1200

# clip -> (render.py clip, samples or None for the shot's ticks, mode)
#   samples are spread evenly over the Tripo clip, the last on its last frame;
#   'reverse' plays the clip backward (the getup is the fall run back)
CLIPS = {
    'idle': ('idle', 25, None),
    'walk': ('walk', 33, None),
    'shoot': ('shoot', None, None),
    'hurt': ('hit', 13, None),
    'down': ('fall', 1, 'last'),
    'getup': ('fall', 11, 'reverse'),
    'hop': ('jump', 31, None),
}
SRC = 'shoot' if WHAT == 'parts' else CLIPS[WHAT][0]
sys.argv = [sys.argv[0], '--', SRC, OUT, '8', str(RES)]
sys.path.insert(0, HERE)
import render as R  # noqa: E402  (sets up the scene: model, fingers, toon, outline, camera)

for k in R.SHOT:  # side-on: no turn of the body or the head
    k[1]['yaw'] = 0
    k[1]['head'] = 0

# side-on the jaw sits well above the bow hand and the arrow would point at the ground: the
# draw comes back level with the bow hand instead (the anchor's depth and reach kept)
_anchor = R.anchor


def anchor(name):
    p = _anchor(name)
    if name == 'cheek':
        p.z = R.fist('L').z
    return p


R.anchor = anchor

# ---- the 2D bones: pivot and a second point that gives the angle ----------------------
SIDES = {'b': 'L', 'f': 'R'}


def head(n):
    return R.wpos(n)


def tail(n):
    return R.wpos(n, True)


def bow_ends():
    pts = R.bow.points
    return Vector(pts[len(pts) - 1].co[:3]), Vector(pts[0].co[:3])


def bones3d():
    out = {
        'torso': (head('Waist'), head('NeckTwist01')),
        'head': (head('NeckTwist01'), tail('Head')),
    }
    for s, S in SIDES.items():
        out[f'arm_{s}_upper'] = (head(f'{S}_Upperarm'), head(f'{S}_Forearm'))
        out[f'arm_{s}_lower'] = (head(f'{S}_Forearm'), head(f'{S}_Hand'))
        out[f'hand_{s}'] = (head(f'{S}_Hand'), R.fist(S))
        out[f'leg_{s}_thigh'] = (head(f'{S}_Thigh'), head(f'{S}_Calf'))
        out[f'leg_{s}_shin'] = (head(f'{S}_Calf'), head(f'{S}_Foot'))
        out[f'leg_{s}_foot'] = (head(f'{S}_Foot'), tail(f'{S}_ToeBase'))
    top, bot = bow_ends()
    out['bow'] = (R.fist('L'), R.fist('L') + (top - bot))
    return out


def ground_z():
    """The lowest point of the skeleton: the feet standing, the body lying."""
    zs = [R.wpos(pb.name).z for pb in R.P] + [R.wpos(pb.name, True).z for pb in R.P]
    return min(zs)


cam = R.co.location
OS = R.cam.ortho_scale


def px(p):
    """World point -> render pixel (y down)."""
    return [RES / 2 + (p.x - cam.x) / OS * RES, RES / 2 - (p.z - cam.z) / OS * RES]


def sample(dz=0.0):
    out = {}
    for name, (a, b) in bones3d().items():
        pa, pb = px(a), px(b)
        pa[1] += dz / OS * RES
        pb[1] += dz / OS * RES
        out[name] = {'pivot': [round(v, 2) for v in pa],
                     'angle': round(math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])), 2),
                     'len': round(math.hypot(pb[0] - pa[0], pb[1] - pa[1]), 2)}
    return out


# ---- posing -----------------------------------------------------------------------------
act = R.arm.animation_data.action
base = None


def pose_tick(f):
    """The shot (or the rest pose, tick 0) at tick f."""
    global base
    if base is None:
        R.sc.frame_set(R.f0)
        R.upd()
        base = {pb.name: pb.matrix_basis.copy() for pb in R.P}
        R.arm.animation_data.action = None
    for pb in R.P:
        pb.matrix_basis = base[pb.name]
    R.upd()
    R.pose_shot(f)
    a, b, t = R.segment(f)
    R.hand('L', R.lerp(a['wl'], b['wl'], t), R.GRIP)
    R.hand('R', R.lerp(a['wr'], b['wr'], t), R.lerp(a['rc'], b['rc'], t))
    R.draw_bow(f, R.lerp(a['wl'], b['wl'], t))


def pose_frame(f):
    for n in R.TWISTED:
        R.P[n].matrix_basis = R.Matrix()
    R.sc.frame_set(f)
    R.upd()
    R.hand('L', 0.0, R.GRIP)
    R.hand('R', 0.0, R.REST)
    R.draw_bow(-1, 0.0)


# ---- parts: the mesh cut by vertex groups -------------------------------------------------
GROUPS = {
    'torso': ['Hip', 'Pelvis', 'Waist', 'Spine01', 'Spine02', 'L_Clavicle', 'R_Clavicle'],
    'head': ['NeckTwist01', 'NeckTwist02', 'Head'],
}
for s, S in SIDES.items():
    GROUPS[f'arm_{s}_upper'] = [f'{S}_Upperarm', f'{S}_UpperarmTwist01', f'{S}_UpperarmTwist02']
    GROUPS[f'arm_{s}_lower'] = [f'{S}_Forearm', f'{S}_ForearmTwist01', f'{S}_ForearmTwist02']
    GROUPS[f'hand_{s}'] = [f'{S}_Hand', f'{S}_Fingers1', f'{S}_Fingers2']
    GROUPS[f'leg_{s}_thigh'] = [f'{S}_Thigh', f'{S}_ThighTwist01', f'{S}_ThighTwist02']
    GROUPS[f'leg_{s}_shin'] = [f'{S}_Calf', f'{S}_CalfTwist01', f'{S}_CalfTwist02']
    GROUPS[f'leg_{s}_foot'] = [f'{S}_Foot', f'{S}_ToeBase']
OVERLAP = 0.25  # a face belongs to a part if any of its corners has this much of its weight
# Tripo weights the quiver's fletching to the drawing arm: a limb part keeps only what lies
# within this many body heights of its bone (the rest of what it is weighted with stays on
# the torso)
REACH = {'arm': 0.07, 'hand': 0.08, 'leg': 0.5}


def seg_dist(p, a, b):
    d = b - a
    t = max(0.0, min(1.0, (p - a).dot(d) / d.length_squared))
    return (p - (a + d * t)).length


def cut_parts():
    """One mesh object per part, the faces it owns (with the joint bands both sides share)."""
    mesh = R.body[0]
    gi = {g.index: g.name for g in mesh.vertex_groups}
    sol = mesh.modifiers['outline']
    sol.show_viewport = False
    R.upd()
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    pos = [mesh.matrix_world @ v.co for v in ev.data.vertices]
    sol.show_viewport = True
    weight = []
    for v in mesh.data.vertices:
        w = {}
        for e in v.groups:
            w[gi[e.group]] = w.get(gi[e.group], 0) + e.weight
        weight.append(w)
    bones = bones3d()
    owned = {}
    for part, groups in GROUPS.items():
        keep = [sum(w.get(g, 0) for g in groups) >= OVERLAP for w in weight]
        r = REACH.get(part.split('_')[0])
        if r:
            a, b = bones[part]
            for i, p in enumerate(pos):
                if keep[i] and seg_dist(p, a, b) > r * R.H:
                    keep[i] = False
                    owned.setdefault('torso', set()).add(i)
        owned[part] = owned.get(part, set()) | {i for i, k in enumerate(keep) if k}
    import bmesh
    objs = {}
    for part in GROUPS:
        keep = owned[part]
        ob = mesh.copy()
        ob.data = mesh.data.copy()
        ob.name = part
        R.sc.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(v.index in keep for v in f.verts)],
                         context='FACES')
        bm.to_mesh(ob.data)
        bm.free()
        objs[part] = ob
    for o in R.body:
        o.hide_render = True
    # the cut leaves the parts open: draw their inside too, so a hole shows cloth, not the
    # outline's far wall
    for m in mesh.data.materials:
        if m and m.name != 'ink':
            m.use_backface_culling = False
    return objs


if WHAT == 'parts':
    pose_tick(0)
    objs = cut_parts()
    R.upd()
    rest = sample()
    top, bot = bow_ends()
    rest['_ground'] = px(R.GROUND)
    rest['_lift'] = ground_z() - R.GROUND.z
    rest['_points'] = {'bow_top': ['bow', px(top)], 'bow_bottom': ['bow', px(bot)],
                       'nock': ['hand_f', px(R.fist('R'))]}
    rest['_res'] = RES
    curves = [R.bpy.data.objects[n] for n in ('bow', 'string', 'arrow', 'arrowhead')]
    os.makedirs(os.path.join(OUT, 'parts'), exist_ok=True)
    for part in list(GROUPS) + ['bow']:
        for o in list(objs.values()) + curves:
            o.hide_render = o.name != part
        R.sc.render.filepath = os.path.join(OUT, 'parts', f'{part}.png')
        bpy.ops.render.render(write_still=True)
    json.dump(rest, open(os.path.join(OUT, 'rest.json'), 'w'), indent=1)
    print('parts', len(GROUPS) + 1)
else:
    # each clip's camera sits on that file's own ground (its first frame), so the projections
    # line up; the lowest bone is then held at its rest height above it
    lift = json.load(open(os.path.join(OUT, 'rest.json')))['_lift']
    src, n, mode = CLIPS[WHAT]
    samples = []
    if src == 'shoot':
        for f in range(0, R.SHOT[-1][0] + 1):
            pose_tick(f)
            samples.append(sample())
    else:
        f0, f1 = act.frame_range
        frames = [f0 + (f1 - f0) * i / max(1, n - 1) for i in range(n)]
        if mode == 'last':
            frames = [f1]
        if mode == 'reverse':
            frames = frames[::-1]
        for f in frames:
            pose_frame(int(round(f)))
            # stood on the ground (Tripo's walk drifts upward, the fall drops through it)
            samples.append(sample(ground_z() - R.GROUND.z - lift))
    os.makedirs(os.path.join(OUT, 'clips'), exist_ok=True)
    json.dump(samples, open(os.path.join(OUT, 'clips', f'{WHAT}.json'), 'w'))
    print('samples', len(samples))
