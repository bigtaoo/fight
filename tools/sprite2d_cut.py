"""Cuts the hero's painted frames (art/heroes/sprite2d/<name>.png) out of their paper into
<name>_cut.png: RGBA at half size on one 592x448 canvas, every frame moved up or down so the soles
of the boots stand on the same row (FEET), as the renderer's card expects (client/src/three/paper.ts).

usage: PYTHONPATH=tools python tools/sprite2d_cut.py [names...]   (default: every frame)
Frames in the air (AIR) keep the painting's own ground line instead.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from ink_cutout import ink_layer

DIR = Path(__file__).resolve().parent.parent / 'art' / 'heroes' / 'sprite2d'
W, H = 1184, 896
FEET = 420
# off the ground in the painting (leaps, the run's bounds) or lying on it (no soles to find): FLUX keeps the ground line, so these
# keep the painting's own (FEET), not their soles
AIR = {'jump_1', 'atk3_2', 'run_1', 'run_2', 'run_3', 'run_4', 'backstep_1', 'slam_1', 'down_1'}


def soles(rgba: np.ndarray) -> int:
    """The lowest row of solid dark paint (the boots), below the hat's line; not the grey shadow."""
    a = rgba[..., 3] / 255.0
    lum = rgba[..., :3].mean(axis=2) / 255.0
    solid = (a > 0.8) & (lum < 0.25)
    rows = np.nonzero(solid.sum(axis=1) >= 6)[0]
    return int(rows.max())


def cut(name: str, ground: int | None) -> int:
    src = Image.open(DIR / f'{name}.png').convert('RGB')
    if src.size != (W, H):
        # base.png is the concept itself (1184x880): pad its bottom with its own paper
        canvas = Image.new('RGB', (W, H), src.getpixel((4, src.height - 4)))
        canvas.paste(src, (0, 0))
        src = canvas
    im = ink_layer(np.asarray(src, np.float32) / 255.0).convert('RGBA').resize((W // 2, H // 2), Image.LANCZOS)
    arr = np.asarray(im)
    feet = soles(arr) if ground is None else ground
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, FEET - feet))
    out.save(DIR / f'{name}_cut.png', optimize=True)
    return feet


def main() -> None:
    names = sys.argv[1:] or sorted(p.stem for p in DIR.glob('*.png') if not p.stem.endswith('_cut') and p.stem not in ('compare_3d_2d', 'ingame_frames', 'ingame_skills'))
    for n in [n for n in names if n not in AIR]:
        f = cut(n, None)
        print(n, 'soles at', f)
    for n in [n for n in names if n in AIR]:
        cut(n, FEET)
        print(n, 'in the air')


if __name__ == '__main__':
    main()
