"""Build the hero's cut-out rig (art/rig_hero3d) from blender/rig2d.py's part renders.
usage: python -I art/hero3d/rig2d_spec.py <rig2d out dir>
then:  python -I tools/pack_tao.py art/rig_hero3d/hero_tao.json art/rig_hero3d/hero.tao client/public/art/hero_rig3d

The clips are the painted hero's (art/rig_r3/anims.py): poses there are limb directions, so
they only need this rig's rest directions and leg lengths, measured from the render. Each
part's full-frame render is cropped (its pivot kept in the frame's pixels) and any hole the
cut left in it filled with the cloth round it.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIG_DIR = os.path.join(HERE, '..', 'rig_hero3d')
sys.path.insert(0, os.path.join(HERE, '..', 'rig_r3'))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
import anims  # noqa: E402
from rigpose import Rig  # noqa: E402

PAD = 4
SCALE = 0.34  # render px -> atlas px; the render is the painting's size (1042 px head to sole)

# back to front: the far arm behind everything, the robe over the legs, the sword between the
# near arm and its hand so the fist closes over the grip
ORDER = ['arm_b_upper', 'hand_b', 'arm_b_lower', 'leg_b_thigh', 'leg_b_shin', 'leg_f_thigh', 'leg_f_shin',
         'robe', 'torso', 'sash', 'head', 'scarf', 'arm_f_upper', 'sword', 'hand_f', 'arm_f_lower']
PARENT = {
    'leg_b_thigh': None, 'leg_b_shin': 'leg_b_thigh', 'leg_f_thigh': None, 'leg_f_shin': 'leg_f_thigh',
    'robe': None, 'torso': None, 'sash': 'torso', 'head': 'torso', 'scarf': 'torso',
    'arm_b_upper': 'torso', 'arm_b_lower': 'arm_b_upper', 'hand_b': 'arm_b_lower',
    'arm_f_upper': 'torso', 'arm_f_lower': 'arm_f_upper', 'hand_f': 'arm_f_lower', 'sword': 'hand_f',
}
# hands scaled about the wrist (the render's come out big beside the head), what hangs from
# them moved to match
HANDS = {'hand_f': 0.85, 'hand_b': 0.85}


def fill_holes(im):
    """Enclosed transparent pixels take the colour of the nearest opaque one, a shade darker."""
    a = np.asarray(im).astype(np.float32)
    solid = a[..., 3] > 128
    holes = ndimage.binary_fill_holes(solid) & ~solid
    if not holes.any():
        return im
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    a[holes, :3] = a[iy[holes], ix[holes], :3] * 0.8
    a[holes, 3] = 255
    return Image.fromarray(a.astype(np.uint8))


def scaled(im, pivot, k):
    """The full-frame render scaled by k about pivot."""
    px, py = pivot
    return im.transform(im.size, Image.AFFINE, (1 / k, 0, px - px / k, 0, 1 / k, py - py / k),
                        resample=Image.BICUBIC)


OUTLINE, RIM = (28, 25, 22), 9  # the ink look's outline colour and width, render px


def trouser(im, shin, hip, knee):
    """A whole trouser leg for a thigh: the model has little more than shreds of one under the
    robe, so the cut thigh is ragged and gappy. The leg is a tapered capsule from hip to knee,
    as wide at the knee as the shin's trouser top and a quarter wider at the hip, its cloth the
    render's where there is any and the nearest of it elsewhere, edged with the outline."""
    s = np.asarray(shin)
    rows = s[int(knee[1]) + 40:int(knee[1]) + 80, :, 3] > 128
    xs = np.nonzero(rows.any(0))[0]
    cx, w = (xs.min() + xs.max()) / 2 - knee[0], xs.max() - xs.min()
    w0, w1 = w * 1.25 / 2, w / 2
    a = Image.new('L', im.size, 0)
    d = ImageDraw.Draw(a)
    x0, y0 = hip[0] + cx, hip[1] - 30
    x1, y1 = knee[0] + cx, knee[1] + 20
    d.polygon([(x0 - w0, y0), (x0 + w0, y0), (x1 + w1, y1), (x1 - w1, y1)], fill=255)
    d.ellipse((x1 - w1, y1 - w1, x1 + w1, y1 + w1), fill=255)
    d.ellipse((x0 - w0, y0 - w0 * 0.6, x0 + w0, y0 + w0 * 0.6), fill=255)
    mask = np.asarray(a.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    src = np.asarray(im).astype(np.float32)
    inside = mask > 128
    solid = (src[..., 3] > 128) & ndimage.binary_erosion(inside, iterations=RIM)
    out = np.zeros_like(src)
    if solid.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        fill = ndimage.gaussian_filter(src[iy, ix, :3], (3, 3, 0))
        out[..., :3] = np.where(solid[..., None], src[..., :3], fill)
    else:
        out[..., :3] = OUTLINE
    rim = inside & ~ndimage.binary_erosion(inside, iterations=RIM)
    out[rim, :3] = OUTLINE
    out[..., 3] = mask
    return Image.fromarray(out.astype(np.uint8))


def knee_fade(im, knee):
    """A shin's shreds above the knee faded out over the thigh's rounded end."""
    a = np.asarray(im).astype(np.float32)
    y = np.arange(a.shape[0], dtype=np.float32)[:, None]
    a[..., 3] *= np.clip((y - knee[1]) / 30, 0, 1)
    return Image.fromarray(a.astype(np.uint8))


def parts(src, rest, raw):
    out = os.path.join(RIG_DIR, 'parts')
    os.makedirs(out, exist_ok=True)
    listed = []
    for name in ORDER:
        im = Image.open(os.path.join(src, 'parts', name + '.png')).convert('RGBA')
        if name.endswith('_thigh'):
            shin = name.replace('thigh', 'shin')
            im = trouser(im, Image.open(os.path.join(src, 'parts', shin + '.png')).convert('RGBA'),
                         rest[name]['pivot'], rest[shin]['pivot'])
        if name.endswith('_shin'):
            im = knee_fade(im, rest[name]['pivot'])
        if name in HANDS:
            im = scaled(im, rest[name]['pivot'], HANDS[name])
        if PARENT[name] in HANDS:  # follow the hand's pivot shift
            dx = [a - b for a, b in zip(rest[name]['pivot'], raw[name])]
            im = im.transform(im.size, Image.AFFINE, (1, 0, -dx[0], 0, 1, -dx[1]))
        x0, y0, x1, y1 = im.getbbox()
        x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
        x1, y1 = min(im.width, x1 + PAD), min(im.height, y1 + PAD)
        im = fill_holes(im.crop((x0, y0, x1, y1)))
        im.save(os.path.join(out, name + '.png'))
        listed.append({'name': name, 'w': x1 - x0, 'h': y1 - y0, 'x': x0, 'y': y0,
                       'pivot': [round(v, 2) for v in rest[name]['pivot']]})
    json.dump({'parts': listed}, open(os.path.join(out, 'parts.json'), 'w'), indent=1)


def main(src):
    rest = json.load(open(os.path.join(src, 'rest.json')))
    raw = {b: list(rest[b]['pivot']) for b in PARENT}
    for b, par in PARENT.items():
        if par in HANDS:
            hp, bp = rest[par]['pivot'], rest[b]['pivot']
            k = HANDS[par]
            rest[b]['pivot'] = [hp[0] + (bp[0] - hp[0]) * k, hp[1] + (bp[1] - hp[1]) * k]
    parts(src, rest, raw)
    json.dump({'parent': PARENT}, open(os.path.join(RIG_DIR, 'rig.json'), 'w'), indent=1)

    ground = rest['_ground']
    # a direction is degrees from straight down, positive toward the facing side (right)
    dirs = {b: round(90 - rest[b]['angle'], 1) for b in
            ('arm_f_upper', 'arm_f_lower', 'sword', 'arm_b_upper', 'arm_b_lower')}
    dirs.update({f'leg_{s}_{p}': 0 for s in 'fb' for p in ('thigh', 'shin')})
    thigh = sum(rest[f'leg_{s}_shin']['pivot'][1] - rest[f'leg_{s}_thigh']['pivot'][1] for s in 'fb') / 2
    shin = sum(ground[1] - rest[f'leg_{s}_shin']['pivot'][1] for s in 'fb') / 2
    anims.RIG = Rig(rest=dirs, thigh=round(thigh), shin=round(shin), extras=('sash', 'scarf'))
    anims.pose = anims.RIG.pose
    spec = {'name': 'hero', 'parts': 'parts', 'rig': 'rig.json', 'origin': [round(v, 2) for v in ground],
            'scale': SCALE, 'animations': anims.clips()}
    json.dump(spec, open(os.path.join(RIG_DIR, 'hero_tao.json'), 'w'), indent=1)
    print('rest', dirs, 'thigh', round(thigh), 'shin', round(shin), 'clips', len(spec['animations']))


if __name__ == '__main__':
    main(sys.argv[1])
