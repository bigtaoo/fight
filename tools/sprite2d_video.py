"""Cuts a painted cycle (the walk) out of an image-to-video clip of the hero into
art/heroes/sprite2d/<out>_<n>_cut.png, on the same 592x448 canvas as tools/sprite2d_cut.py: FLUX
only paints poses with both feet down, a video model paints the legs passing each other too.

usage: PYTHONPATH=tools python tools/sprite2d_video.py <clip.mp4> <out> <first> <period> <frames>
       PYTHONPATH=tools python tools/sprite2d_video.py <clip.mp4> <out> pick <i,j,k,...> [hat|still] [floor|soles] [scale] [width]
  first, period: the cycle's first video frame and its length in video frames (it loops there);
  frames: how many paintings to keep of it, evenly spaced.
  scale: for a clip started from a shrunk stance (side_room.png at 0.75: pass 1.333); width: a
  wider canvas (832) for a move whose blade reaches past the usual one, same height and feet.
The clip's camera tracks the figure: each frame is moved so the hat (the steadiest part) keeps a
straight line through the cycle, which brings the cycle's end back onto its start. The ground row
stays the clip's own, put on FEET. Prints the planted boot's slide per painting (canvas px), for
the renderer's step length.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ink_cutout import ink_layer

DIR = Path(__file__).resolve().parent.parent / 'art' / 'heroes' / 'sprite2d'
CW, CH = 592, 448
FEET = 420


def frames(path: str) -> list[np.ndarray]:
    cap = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            return out
        out.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))


def hat_x(rgb: np.ndarray) -> float:
    """The straw hat's centre (its tan straw: warm, light, not paper)."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    hat = (r > 150) & (r - b > 45) & (g - b > 20) & (r < 240)
    ys, xs = np.nonzero(hat[: rgb.shape[0] // 3])
    return float(xs.mean())


def ground(rgb: np.ndarray) -> int:
    """The soles' row: the lowest row with a run of solid dark paint."""
    dark = rgb.max(axis=2) < 70
    return int(np.nonzero(dark.sum(axis=1) >= 6)[0].max())


def body_x(rgb: np.ndarray) -> float:
    """The hat's centre, or the dark paint's when the hat can't be seen."""
    try:
        return hat_x(rgb)
    except (ValueError, ZeroDivisionError):
        pass
    ys, xs = np.nonzero(rgb.max(axis=2) < 110)
    return float(xs.mean())


def cut(src: np.ndarray, k: float) -> Image.Image:
    h, w = src.shape[:2]
    # a little bigger first so the cut's edge is as clean as the paintings'
    big = cv2.resize(src, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    lay = ink_layer(big.astype(np.float32) / 255.0).convert('RGBA')
    return lay.resize((round(w * k), round(h * k)), Image.LANCZOS)


def pick(fr: list[np.ndarray], out: str, idx: list[int], xmode: str, ymode: str, scale: float = 1.0,
         cw: int = CW) -> None:
    """A move's paintings: the given video frames, in order. `hat` keeps each frame's hat over the
    canvas centre (the engine moves the body, the painting only poses it), `still` keeps the
    first frame's; `floor` keeps the clip's ground on FEET, `soles` each frame's lowest sole (airborne
    poses, which the engine lifts itself)."""
    h, w = fr[0].shape[:2]
    k = CW / w * scale
    floor = max(ground(fr[i]) for i in idx)
    x0 = body_x(fr[idx[0]])
    for n, i in enumerate(idx):
        src = fr[i]
        bx = body_x(src) if xmode == 'hat' else x0
        gy = ground(src) if ymode == 'soles' else floor
        canvas = Image.new('RGBA', (cw, CH), (0, 0, 0, 0))
        canvas.paste(cut(src, k), (round(cw / 2 - bx * k), round(FEET - gy * k)))
        canvas.save(DIR / f'{out}_{n + 1}_cut.png', optimize=True)
    print(out, len(idx), 'paintings from frames', idx)


def main() -> None:
    if sys.argv[3] == 'pick':
        fr = frames(sys.argv[1])
        idx = [int(v) for v in sys.argv[4].split(',')]
        arg = lambda i, d: sys.argv[i] if len(sys.argv) > i else d
        pick(fr, sys.argv[2], idx, arg(5, 'hat'), arg(6, 'floor'), float(arg(7, 1)), int(arg(8, CW)))
        return
    clip, out, first, period, count = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:6])
    fr = frames(clip)
    h, w = fr[0].shape[:2]
    k = CW / w
    idx = [first + round(i * period / count) for i in range(count)]
    # the hat's line through the cycle (start to the loop's end), and the ground (the lowest the
    # soles go in the whole cycle)
    hx = np.array([hat_x(fr[(first + i) % len(fr)]) for i in range(period + 1)])
    t = np.arange(period + 1)
    line = hx[0] + (hx[-1] - hx[0]) * t / period
    floor = max(ground(fr[(first + i) % len(fr)]) for i in range(period))
    print('hat drift over the cycle', round(hx[-1] - hx[0], 1), 'px; ground row', floor)
    for n, i in enumerate(idx):
        src = fr[i % len(fr)]
        # a little bigger first so the cut's edge is as clean as the paintings'
        big = cv2.resize(src, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        lay = ink_layer(big.astype(np.float32) / 255.0).convert('RGBA')
        lay = lay.resize((round(w * k), round(h * k)), Image.LANCZOS)
        # the hat keeps to the line's start: it sways about it as the body does, but doesn't drift
        dx = (CW / 2 - line[0] * k) - (line[i - first] - line[0]) * k
        canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
        canvas.paste(lay, (round(dx), round(FEET - floor * k)))
        canvas.save(DIR / f'{out}_{n + 1}_cut.png', optimize=True)
        print(out, n + 1, 'video frame', i)


if __name__ == '__main__':
    main()
