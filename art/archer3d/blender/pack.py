"""Pack the archer's rendered clips (render.py output) into one atlas for the client.
usage: python art/archer3d/blender/pack.py <render dir> <out dir>

<render dir>/<clip>/NN.png are 384px frames from render.py: the mesh height H spans 256px,
the feet stand at x 192, a tenth of the frame above the bottom. Each frame is trimmed to its
ink and shelf-packed; frames.json gives each clip's frames as [x, y, w, h, ox, oy] (atlas
rect, and the rect's top-left relative to the feet in source pixels) and the world units per
pixel. The atlas is lossy WebP (about a fifth of the PNG; frames.json names it). Looping clips (idle, walk) drop their last frame, which repeats the first.
"""
import json, os, sys
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
RES = 384
FEET = (RES / 2, RES * 0.9)
# the game archer stands 236 high (RIG_SIZE in client bodyView.ts); H is 256px here
SCALE = 236 / 256
CLIPS = {'idle': True, 'walk': True, 'shoot': False, 'hit': False, 'fall': False}
WIDTH = 2048
PAD = 2
# render.py's hull outline breaks at mesh seams; a 2px ink rim around the silhouette closes it
INK = (28, 26, 23)
IMAGE = 'atlas.webp'
QUALITY = 90
RIM = 5  # max filter size: 2px each way

frames = []
for clip, looped in CLIPS.items():
    names = sorted(n for n in os.listdir(os.path.join(SRC, clip)) if n.endswith('.png'))
    if looped:
        names = names[:-1]
    for i, n in enumerate(names):
        im = Image.open(os.path.join(SRC, clip, n)).convert('RGBA')
        rim = Image.new('RGBA', im.size, INK)
        rim.putalpha(im.getchannel('A').filter(ImageFilter.MaxFilter(RIM)))
        im = Image.alpha_composite(rim, im)
        box = im.getchannel('A').point(lambda a: 255 if a > 4 else 0).getbbox()
        frames.append((clip, i, im.crop(box), box))

# shelves, tallest first so each shelf wastes little
order = sorted(range(len(frames)), key=lambda k: -frames[k][2].height)
x = y = shelf = 0
place = {}
for k in order:
    w, h = frames[k][2].size
    if x + w > WIDTH:
        x, y, shelf = 0, y + shelf + PAD, 0
    place[k] = (x, y)
    x += w + PAD
    shelf = max(shelf, h)
atlas = Image.new('RGBA', (WIDTH, y + shelf))
out = {'scale': SCALE, 'image': IMAGE, 'clips': {c: [] for c in CLIPS}}
for k, (clip, i, im, box) in enumerate(frames):
    px, py = place[k]
    atlas.paste(im, (px, py))
    out['clips'][clip].append([px, py, im.width, im.height, round(box[0] - FEET[0], 1), round(box[1] - FEET[1], 1)])
os.makedirs(OUT, exist_ok=True)
atlas.save(os.path.join(OUT, IMAGE), quality=QUALITY, alpha_quality=100, method=6)
with open(os.path.join(OUT, 'frames.json'), 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print('atlas', atlas.size, {c: len(v) for c, v in out['clips'].items()})
