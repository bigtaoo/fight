"""Build the archer's cut-out rig (art/rig_archer3d) from blender/rig2d.py's renders and projections.
usage: python -I art/archer3d/rig2d_spec.py <rig2d out dir>
then:  python -I tools/pack_tao.py art/rig_archer3d/archer_tao.json art/rig_archer3d/archer.tao client/public/art/archer_rig3d

Each part's full-frame render is cropped (its pivot kept in the frame's pixels) and any hole
the cut left in it (where the shoulder opens into the arm) filled with the cloth round it.
Each clip sample gives every bone's projected pivot and angle; a key holds the bone's turn
from rest less its parent's, and the offset of its pivot from the parent's, in the parent's
turned frame, less the rest offset: the joints land where the 3D joints project.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RIG = os.path.join(HERE, '..', 'rig_archer3d')
PAD = 4
SCALE = 0.45  # render px (the mesh about 800 tall) -> atlas px

# back to front; a hand goes under its forearm, so the bracer's cuff hides the cut at the wrist
ORDER = ['bow', 'arm_b_upper', 'hand_b', 'arm_b_lower', 'leg_b_foot', 'leg_b_shin', 'leg_b_thigh',
         'torso', 'head', 'leg_f_foot', 'leg_f_shin', 'leg_f_thigh', 'arm_f_upper', 'hand_f', 'arm_f_lower']
PARENT = {
    'torso': None, 'head': 'torso',
    'arm_b_upper': 'torso', 'arm_b_lower': 'arm_b_upper', 'hand_b': 'arm_b_lower', 'bow': 'hand_b',
    'arm_f_upper': 'torso', 'arm_f_lower': 'arm_f_upper', 'hand_f': 'arm_f_lower',
    'leg_b_thigh': None, 'leg_b_shin': 'leg_b_thigh', 'leg_b_foot': 'leg_b_shin',
    'leg_f_thigh': None, 'leg_f_shin': 'leg_f_thigh', 'leg_f_foot': 'leg_f_shin',
}
# rig clip -> (duration, unit, loop); the samples spread evenly over it, the last on its end
FPS = 24
CLIPS = {
    'idle': ((368.8 - 0.8) / FPS, None, True),
    'walk': (1, None, True),
    'shoot': (34, 'tick', False),
    'hurt': (12, 'tick', False),
    'down': (1, 'tick', False),
    'getup': (10, 'tick', False),
    'hop': (30, 'tick', False),
}
# hands as rendered come out too big beside the head, and the near one's fist bends down off
# the forearm's line: each is scaled (and turned, degrees clockwise) about its wrist, with
# what hangs from it (the bow, the nock) moved to match
HANDS = {'hand_f': (0.8, -30), 'hand_b': (0.8, 0)}
SHORT = 0.3  # a bone seen end-on (shorter than this share of its rest length) keeps its last turn


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


def reshape(v, k, deg):
    return turn((v[0] * k, v[1] * k), deg)


def hand_image(im, pivot, k, deg):
    """The full-frame render scaled by k and turned by deg about pivot."""
    px, py = pivot
    c, s = math.cos(math.radians(deg)) / k, math.sin(math.radians(deg)) / k
    return im.transform(im.size, Image.AFFINE, (c, s, px - c * px - s * py, -s, c, py + s * px - c * py),
                        resample=Image.BICUBIC)


def move_children(smp):
    """In one sample (or the rest pose): a hand's children's pivots pulled in to the scaled hand."""
    for b, par in PARENT.items():
        if par in HANDS:
            k, _ = HANDS[par]
            hp, bp = smp[par]['pivot'], smp[b]['pivot']
            smp[b]['pivot'] = [hp[0] + (bp[0] - hp[0]) * k, hp[1] + (bp[1] - hp[1]) * k]
    return smp


def parts(src, rest):
    out = os.path.join(RIG, 'parts')
    os.makedirs(out, exist_ok=True)
    listed = []
    for name in ORDER:
        im = Image.open(os.path.join(src, 'parts', name + '.png')).convert('RGBA')
        if name in HANDS:
            im = hand_image(im, rest[name]['pivot'], *HANDS[name])
        if PARENT[name] in HANDS:  # follow the hand's pivot shift
            dx = [a - b for a, b in zip(rest[name]['pivot'], raw[name])]
            im = im.transform(im.size, Image.AFFINE, (1, 0, -dx[0], 0, 1, -dx[1]))
        x0, y0, x1, y1 = im.getbbox()
        x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
        x1, y1 = min(im.width, x1 + PAD), min(im.height, y1 + PAD)
        im = fill_holes(im.crop((x0, y0, x1, y1)))
        im.save(os.path.join(out, name + '.png'))
        listed.append({'name': name, 'w': x1 - x0, 'h': y1 - y0, 'x': x0, 'y': y0,
                       'pivot': rest[name]['pivot']})
    json.dump({'parts': listed}, open(os.path.join(out, 'parts.json'), 'w'), indent=1)


def turn(v, deg):
    """v turned by deg (clockwise on screen, y down)."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)


def keys(samples, rest, origin):
    """Per sample: {rotate, translate} for every bone."""
    prev = {}
    out = []
    for smp in samples:
        world = {}
        for b in PARENT:
            d = smp[b]['angle'] - rest[b]['angle']
            if smp[b]['len'] < SHORT * rest[b]['len'] and b in prev:
                d = prev[b]
            if b in prev:  # unwrapped: the nearest turn to the last one
                d += 360 * round((prev[b] - d) / 360)
            world[b] = prev[b] = d
        rot, tr = {}, {}
        for b, p in PARENT.items():
            pw = world[p] if p else 0.0
            pp = smp[p]['pivot'] if p else origin
            rp = rest[p]['pivot'] if p else origin
            rot[b] = round(world[b] - pw, 2)
            dx, dy = turn((smp[b]['pivot'][0] - pp[0], smp[b]['pivot'][1] - pp[1]), -pw)
            tr[b] = [round(dx - (rest[b]['pivot'][0] - rp[0]), 2), round(dy - (rest[b]['pivot'][1] - rp[1]), 2)]
        out.append({'rotate': rot, 'translate': tr})
    return out


def in_place(samples):
    """A loop's drift (Tripo's walk climbs and creeps forward over the cycle) taken out evenly,
    so its last sample sits where its first does and the loop closes without a jump."""
    n = len(samples)
    a, b = samples[0]['torso']['pivot'], samples[-1]['torso']['pivot']
    for i, smp in enumerate(samples):
        f = i / max(1, n - 1)
        for bone in smp.values():
            bone['pivot'] = [bone['pivot'][0] - (b[0] - a[0]) * f, bone['pivot'][1] - (b[1] - a[1]) * f]
    return samples


def main(src):
    rest = json.load(open(os.path.join(src, 'rest.json')))
    origin = rest['_ground']
    global raw
    raw = {b: list(rest[b]['pivot']) for b in PARENT}
    move_children(rest)
    for name, (par, at) in rest['_points'].items():
        if par in HANDS:
            pv = rest[par]['pivot']
            d = reshape((at[0] - pv[0], at[1] - pv[1]), *HANDS[par])
            at[:] = [pv[0] + d[0], pv[1] + d[1]]
        elif PARENT.get(par) in HANDS:  # rides along with the child's shifted pivot
            at[:] = [at[0] + rest[par]['pivot'][0] - raw[par][0], at[1] + rest[par]['pivot'][1] - raw[par][1]]
    parts(src, rest)
    json.dump({'parent': PARENT}, open(os.path.join(RIG, 'rig.json'), 'w'), indent=1)
    anims = {}
    for clip, (dur, unit, loop) in CLIPS.items():
        samples = [move_children(smp) for smp in json.load(open(os.path.join(src, 'clips', clip + '.json')))]
        if loop:
            samples = in_place(samples)
        ks = keys(samples, rest, origin)
        n = len(ks)
        a = {'duration': dur, 'loop': loop, 'ease': 'linear',
             'keys': [dict(t=round(dur * i / max(1, n - 1), 4), **k) for i, k in enumerate(ks)]}
        if unit:
            a['unit'] = unit
        anims[clip] = a
    points = {name: {'parent': par, 'at': [round(v, 2) for v in at]} for name, (par, at) in rest['_points'].items()}
    spec = {'name': 'archer', 'parts': 'parts', 'rig': 'rig.json', 'origin': [round(v, 2) for v in origin],
            'scale': SCALE, 'points': points, 'animations': anims}
    json.dump(spec, open(os.path.join(RIG, 'archer_tao.json'), 'w'), indent=1)
    print('parts', len(ORDER), 'clips', {c: len(a['keys']) for c, a in anims.items()})


if __name__ == '__main__':
    main(sys.argv[1])
