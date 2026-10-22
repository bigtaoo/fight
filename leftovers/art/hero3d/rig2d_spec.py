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
from rigpose import Rig, key, loop  # noqa: E402

PAD = 4
SCALE = 0.34  # render px -> atlas px; the render is the painting's size (1042 px head to sole)

# back to front: the far arm behind everything, the robe over the legs, the sword between the
# near arm and its hand so the fist closes over the grip
ORDER = ['arm_b_upper', 'hand_b', 'arm_b_lower', 'leg_b_thigh', 'leg_b_shin', 'leg_f_thigh', 'leg_f_shin',
         'robe', 'robe_f', 'torso', 'chest', 'sash', 'head', 'scarf', 'arm_f_upper', 'sword', 'hand_f', 'arm_f_lower']
PARENT = {
    'leg_b_thigh': None, 'leg_b_shin': 'leg_b_thigh', 'leg_f_thigh': None, 'leg_f_shin': 'leg_f_thigh',
    'robe': None, 'robe_f': None, 'torso': None, 'chest': 'torso', 'sash': 'torso', 'head': 'chest', 'scarf': 'chest',
    'arm_b_upper': 'chest', 'arm_b_lower': 'arm_b_upper', 'hand_b': 'arm_b_lower',
    'arm_f_upper': 'chest', 'arm_f_lower': 'arm_f_upper', 'hand_f': 'arm_f_lower', 'sword': 'hand_f',
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
    x1, y1 = knee[0] + cx, knee[1] + 4  # round end on the joint: it turns in place
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


PANELS = (1.0, 0.45)  # how far the robe's front / back panel follows the leading / trailing thigh
SPINE = 0.45  # the waist's share of the trunk's turn; the chest takes the rest
UNDER = 70    # the waist reaches this far up under the chest, render px, so a bend opens no gap


def trunk_holes(chest, torso):
    """The chest with the hole the arms' cut leaves in the trunk filled: the shoulder hole
    runs down into the waist, so neither part alone encloses it and fill_holes misses it;
    with the near arm swung off the shoulder it shows through."""
    c = np.asarray(chest).astype(np.float32)
    solid = (c[..., 3] > 128) | (np.asarray(torso)[..., 3] > 128)
    holes = ndimage.binary_fill_holes(solid) & ~solid
    if not holes.any():
        return chest
    both = Image.alpha_composite(torso, chest)
    b = np.asarray(both).astype(np.float32)
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    c[holes, :3] = b[iy[holes], ix[holes], :3] * 0.8
    c[holes, 3] = 255
    return Image.fromarray(c.astype(np.uint8))


def waist(im, chest, pivot):
    """The waist with the chest's lower band behind it: hidden under the chest standing, it
    fills the seam when the chest turns on the waist."""
    c = np.asarray(chest).copy()
    c[:int(pivot[1]) - UNDER, :, 3] = 0
    out = Image.fromarray(c)
    out.alpha_composite(im)
    return out


def robe_top(im, pivot):
    """The robe's top under the waist faded out: when the hem swings back the robe turns on
    the waist and its top corner would rise into view behind the back."""
    a = np.asarray(im).astype(np.float32)
    y = np.arange(a.shape[0], dtype=np.float32)[:, None]
    a[..., 3] *= np.clip((y - pivot[1] + 45) / 40, 0, 1)
    return Image.fromarray(a.astype(np.uint8))


# ---- walk: both hands on the sword ----------------------------------------------------
# The shared walk swings a one-handed sword low; this rig walks in a two-handed upright guard:
# leaning into the step, elbows down, the fists before the chest and the blade
# straight up, edging in slowly. Both arms are solved to the grip, the legs to where the feet
# are, sampled densely from smooth curves (a tween between samples is linear, and with the
# cycle driven by distance walked anything but linear would slide the planted foot): it
# slides back evenly, the hips are lowest just after each heel lands and highest as the free
# foot brushes past, and the chest, the hands and the tip settle a beat behind the hips.

def u(d, n=1.0):
    """A direction (degrees from down, + forward) as a y-down vector of length n."""
    return np.array([math.sin(math.radians(d)), math.cos(math.radians(d))]) * n


def turn(v, dd):
    """v with its direction moved by dd degrees."""
    return u(math.degrees(math.atan2(v[0], v[1])) + dd, math.hypot(*v))


def two_bone(v, a, b, bend):
    """Directions of a two-bone chain (lengths a, b) whose end reaches v from its root; bend
    +1 puts the joint forward of the line, -1 behind. Out of reach it stretches straight."""
    dd = min(math.hypot(*v), a + b - 1e-3)
    phi = math.degrees(math.atan2(v[0], v[1]))
    al = math.degrees(math.acos(max(-1, min(1, (a * a + dd * dd - b * b) / (2 * a * dd)))))
    j = u(phi + bend * al, a)
    end = u(phi, dd)
    return phi + bend * al, math.degrees(math.atan2(*(end - j)))


GRIP_BACK = 48  # render px from the front fist's middle down the grip to the back fist's


def grip_arms(rest, dirs, k, fist):
    """Both arms' (upper, forearm) for key k with the front fist at `fist` (render px from
    the hip pivot) and the back fist on the grip behind it."""
    P = {n: np.array(rest[n]['pivot']) for n in rest if not n.startswith('_')}
    torso = k['torso']
    w = k.get('waist', torso * SPINE)
    T = P['torso'] + (0, k.get('body', 0))
    C = T + turn(P['chest'] - P['torso'], w)

    def arm(s, target, hand):
        sh = C + turn(P[f'arm_{s}_upper'] - P['chest'], torso)
        a = np.linalg.norm(P[f'arm_{s}_lower'] - P[f'arm_{s}_upper'])
        b = np.linalg.norm(P[f'hand_{s}'] - P[f'arm_{s}_lower'])
        rest_fore = dirs[f'arm_{s}_lower']
        up, fore = 0.0, rest_fore
        for _ in range(10):  # the hand turns with the forearm: aim the wrist, re-aim
            up, fore = two_bone(target - turn(hand, fore - rest_fore) - sh, a, b, -1)
        return round(up, 1), round(fore, 1)

    hb = rest['hand_b']
    back_hand = np.array([math.cos(math.radians(hb['angle'])), math.sin(math.radians(hb['angle']))]) * hb['len'] * HANDS['hand_b']
    front = T + np.array(fist)
    af = arm('f', front, P['sword'] - P['hand_f'])
    ab = arm('b', front - u(k['sword'], GRIP_BACK), back_hand)
    return af, ab


# the shoe turns with the shin: a foot is placed by the lowest point of its shoe, not its
# ankle, so a foot behind rises onto its toes instead of turning them through the floor.
# shoe(): the shin's opaque pixels near the sole, from the shin's end (render px, shin down)
SHOE = None


def shoe(src, rest, shin):
    a = np.array(Image.open(os.path.join(src, 'parts', 'leg_f_shin.png')))[:, :, 3]
    end = np.array(rest['leg_f_shin']['pivot']) + (0, shin)
    ys, xs = np.nonzero(a[int(end[1]) - 120:] > 128)
    return np.stack([xs - end[0], ys + int(end[1]) - 120 - end[1]], 1)[::7]


def leg(x, y, thigh, shin):
    """(thigh, shin) directions standing the shoe's lowest point at (x, y) from the hip, the
    knee forward."""
    end = y
    for _ in range(6):
        t, d = two_bone(np.array([x, end]), thigh, shin, 1)
        r = math.radians(d)
        end = y - (SHOE[:, 1] * math.cos(r) - SHOE[:, 0] * math.sin(r)).max()
    return round(t, 1), round(d, 1)


WALK_SAMPLES = 8  # per step


def walk3d(src, rest, dirs, thigh, shin):
    global SHOE
    SHOE = shoe(src, rest, shin)
    L = thigh + shin
    X = 191  # half a step: the client's 176 world units a cycle at 1042 px to 240 high
    cos = lambda p, lag: math.cos(2 * math.pi * (p - lag))
    keys = []
    n = 2 * WALK_SAMPLES
    for i in range(n):
        c = i / n
        side, p = divmod(c * 2, 1)
        drop = 40 + 6 * cos(p, 0.12)                       # low after the heel lands
        planted = leg(X * (1 - 2 * p), L - drop, thigh, shin)
        lift = 16 * math.sin(math.pi * p) ** 1.5            # the free foot brushes past
        free = leg(-X * math.cos(math.pi * p), L - drop - lift, thigh, shin)
        lf, lb = (planted, free) if side == 0 else (free, planted)
        swing = math.sin(2 * math.pi * c)                   # which leg swings, -1..1 a cycle
        k = dict(torso=44 + cos(p, 0.2), waist=20 + 0.5 * cos(p, 0.2), head=-30 - 0.5 * cos(p, 0.25), body=6 + 1.5 * cos(p, 0.22),
                 sword=178 - cos(p, 0.3), robe=-2 * swing, sash=6 * swing,
                 scarf=-3 + 3 * cos(p, 0.35), lf=lf, lb=lb, root=(0, round(drop, 1)), plant=False)
        k['af'], k['ab'] = grip_arms(rest, dirs, k, (-10, -110 + 2 * cos(p, 0.27)))
        k['af'] = (*k['af'], k.pop('sword'))
        k = {n_: (round(v, 1) if isinstance(v, float) else v) for n_, v in k.items()}
        keys.append(key(c, anims.pose(**k)))
    keys.append(dict(keys[0], t=1.0))
    return loop(1.0, keys, ease='linear')


FAR = ('leg_b_thigh', 'leg_b_shin', 'arm_b_upper', 'arm_b_lower', 'hand_b')
FAR_SHADE = 0.72  # the far limbs a shade darker, so crossing legs and arms read apart

# the robe in two panels split at this x (render px) with this feather: the front one turns
# with the leading thigh (rigpose's `panels`), so a stepping knee pushes the robe out rather
# than poking out of it, the back one trails the rear thigh
ROBE_SPLIT, ROBE_FEATHER = 598, 14


def robe_panel(im, front):
    a = np.asarray(im).astype(np.float32)
    x = np.arange(a.shape[1], dtype=np.float32)[None, :]
    if front:
        a[..., 3] *= np.clip((x - ROBE_SPLIT) / ROBE_FEATHER + 0.5, 0, 1)
    else:
        a[..., 3] *= (x < ROBE_SPLIT + 40)
    return Image.fromarray(a.astype(np.uint8))


def shade(im, k):
    a = np.asarray(im).astype(np.float32)
    a[..., :3] *= k
    return Image.fromarray(a.astype(np.uint8))


def parts(src, rest, raw):
    out = os.path.join(RIG_DIR, 'parts')
    os.makedirs(out, exist_ok=True)
    listed = []
    load = lambda n: Image.open(os.path.join(src, 'parts', n + '.png')).convert('RGBA')
    chest = trunk_holes(load('chest'), load('torso'))
    for name in ORDER:
        im = load('robe' if name == 'robe_f' else name)
        if name.startswith('robe'):
            im = robe_panel(im, name == 'robe_f')
        if name.endswith('_thigh'):
            shin = name.replace('thigh', 'shin')
            im = trouser(im, Image.open(os.path.join(src, 'parts', shin + '.png')).convert('RGBA'),
                         rest[name]['pivot'], rest[shin]['pivot'])
        if name == 'robe':
            im = robe_top(im, rest[name]['pivot'])
        if name == 'torso':
            im = waist(im, chest, rest['chest']['pivot'])
        if name == 'chest':
            im = chest
        if name.endswith('_shin'):
            im = knee_fade(im, rest[name]['pivot'])
        if name in FAR:
            im = shade(im, FAR_SHADE)
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
    rest['robe_f'] = rest['robe']
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
    anims.RIG = Rig(rest=dirs, thigh=round(thigh), shin=round(shin), extras=('sash', 'scarf'), spine=SPINE, panels=PANELS)
    anims.pose = anims.RIG.pose
    spec = {'name': 'hero', 'parts': 'parts', 'rig': 'rig.json', 'origin': [round(v, 2) for v in ground],
            'scale': SCALE, 'animations': dict(anims.clips(), walk=walk3d(src, rest, dirs, round(thigh), round(shin)))}
    json.dump(spec, open(os.path.join(RIG_DIR, 'hero_tao.json'), 'w'), indent=1)
    print('rest', dirs, 'thigh', round(thigh), 'shin', round(shin), 'clips', len(spec['animations']))


if __name__ == '__main__':
    main(sys.argv[1])
