# Ink-corrupted copy of a rigged chapter-1 body: same mesh and skeleton, texture washed to ink.
#
#   blender -b --python art/model3d/ink.py -- <src name> <out name>     # e.g. lion inklion
#   python art/model3d/pad.py art/model3d/<out name>/rig_v1.glb
#
# Each texel keeps its light and shade but loses most of its colour, washing to a pale blue-grey ink
# (not solid black: the light parts stay near the paper); some of the original hue (KEEP) survives,
# so the one colour the corrupted villagers keep still reads.
import bpy, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, DST = sys.argv[sys.argv.index('--') + 1:][:2]
KEEP = 0.30
INK = np.array([0.22, 0.23, 0.27])   # darkest ink
WASH = np.array([0.86, 0.84, 0.80])  # lightest wash, near the paper
GAMMA = 1.15

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, SRC, 'rig_v1.glb'))
for img in bpy.data.images:
    if img.size[0] == 0: continue
    px = np.array(img.pixels[:]).reshape(-1, 4)
    rgb = px[:, :3]
    lum = (rgb @ np.array([0.299, 0.587, 0.114]))[:, None]
    # the scanned villagers are dark all over (most texels under a third of white): stretch each
    # texture's own range to the full wash, or the corrupted body still reads near black in game
    lo, hi = np.percentile(lum, [3, 97])
    span = np.clip((lum - lo) / max(hi - lo, 0.05), 0, 1)
    ink = INK + (WASH - INK) * span ** GAMMA
    px[:, :3] = ink * (1 - KEEP) + rgb * KEEP * (ink / np.maximum(lum, 0.05))
    img.pixels[:] = np.clip(px, 0, 1).ravel()
    img.pack()
    print(f'INK {img.name} {img.size[0]}x{img.size[1]}')
out = os.path.join(HERE, DST)
os.makedirs(out, exist_ok=True)
# the birds and beasts (bird.py) carry their own clips and a size in the extras; keep both
clips = dict(export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
             export_optimize_animation_size=False) if bpy.data.actions else dict(export_animations=False)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'rig_v1.glb'), export_format='GLB', export_image_format='JPEG',
                          export_extras=True, **clips)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 600, 630
sc.render.film_transparent = True
import math
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.05
cam.location = (3, 0, 0.525); cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
sc.render.filepath = os.path.join(out, 'rig_v1.front.png'); bpy.ops.render.render(write_still=True)
