# Pulls clips out of a mocap library (Quaternius Universal Animation Library 2, CC0:
# https://quaternius.com) into a skeleton-free form that moves.py can put on any Tripo body.
#
#   blender -b --python art/model3d/retarget.py -- <UAL2_Standard.glb> [<clip> ...]
#
# Writes art/model3d/mocap/ual2.json. For every mapped bone and frame it keeps the bone's turn in
# the body's own axes (forward, left, up) away from the library's rest pose (a T-pose), and the
# bone's rest direction in the same axes; moves.py lines that up with each body's own rest. The hips'
# shift is kept in hip heights. The library itself (70 MB) stays out of the repo.
import bpy, json, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index('--') + 1:]
SRC = args[0]
WANT = args[1:]

# Tripo bone <- library bone
MAP = {
    'Hip': 'pelvis', 'Waist': 'spine_01', 'Spine01': 'spine_02', 'Spine02': 'spine_03',
    'NeckTwist01': 'neck_01', 'Head': 'Head',
}
for s, t in (('L', 'l'), ('R', 'r')):
    MAP.update({f'{s}_Clavicle': f'clavicle_{t}', f'{s}_Upperarm': f'upperarm_{t}', f'{s}_Forearm': f'lowerarm_{t}',
                f'{s}_Hand': f'hand_{t}', f'{s}_Thigh': f'thigh_{t}', f'{s}_Calf': f'calf_{t}',
                f'{s}_Foot': f'foot_{t}', f'{s}_ToeBase': f'ball_{t}'})

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
W = arm.matrix_world
bones = arm.data.bones
# the body's axes at rest: left from the right hip to the left, up, forward = left x up
up = Vector((0, 0, 1))
left = W @ bones['thigh_l'].head_local - W @ bones['thigh_r'].head_local
left.z = 0; left.normalize()
fwd = left.cross(up)
B = Matrix((fwd, left, up)).transposed()   # body axes -> world
Bt = B.transposed()
R0 = {t: (W @ bones[s].matrix_local).to_3x3().normalized() for t, s in MAP.items()}
dirs = {t: list(Bt @ ((W @ bones[s].tail_local) - (W @ bones[s].head_local)).normalized()) for t, s in MAP.items()}
hip0 = W @ bones['pelvis'].head_local
hipH = hip0.z
print(f'RETARGET forward {tuple(round(v, 3) for v in fwd)}, hip {hipH:.3f}')

fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
out = {'source': 'Quaternius Universal Animation Library 2 (Standard), CC0', 'fps': fps, 'dirs': dirs, 'clips': {}}
if arm.animation_data is None: arm.animation_data_create()
sc = bpy.context.scene
for act in bpy.data.actions:
    if WANT and act.name not in WANT: continue
    arm.animation_data.action = act
    f0, f1 = (int(round(x)) for x in act.frame_range)
    frames = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        rot = {}
        for t, s in MAP.items():
            pb = arm.pose.bones[s]
            D = (W @ pb.matrix).to_3x3().normalized() @ R0[t].inverted()
            q = (Bt @ D @ B).to_quaternion()
            rot[t] = [round(x, 5) for x in q]
        hip = Bt @ ((W @ arm.pose.bones['pelvis'].head) - hip0) / hipH
        frames.append({'rot': rot, 'hip': [round(x, 5) for x in hip]})
    out['clips'][act.name] = frames
    print(f'RETARGET {act.name}: {len(frames)} frames')
os.makedirs(os.path.join(HERE, 'mocap'), exist_ok=True)
path = os.path.join(HERE, 'mocap', 'ual2.json')
json.dump(out, open(path, 'w'), separators=(',', ':'))
print(f'RETARGET -> {path} ({os.path.getsize(path) // 1024} KB)')
