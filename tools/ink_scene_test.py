"""Readability sheet for an ink style round.
usage: python ink_scene_test.py <out.png> <img> [<img> ...]

One row per image: the cut-out figure at desktop size (240 tall, 1080p logical) and at
half size, over three grounds the game will have: light paper, a mid grey wash and a dark
cave. A black silhouette that vanishes on the cave, or grey washes that vanish on the
wash, show up here before anything gets rigged.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from ink_cutout import ink_cutout  # noqa: E402

GROUNDS = [("paper", (239, 231, 214)), ("wash", (150, 146, 138)), ("cave", (40, 38, 44))]
SIZES = (240, 120)
CELL_H, LABEL_W, GAP = 300, 120, 30


def load(src):
    """A painting is cut out first; a sprite that already has its alpha is used as is."""
    im = Image.open(src)
    return im.convert("RGBA") if im.mode == "RGBA" else ink_cutout(im)


def main(out, srcs):
    figs = [load(src) for src in srcs]
    cell_w = GAP + max(sum(round(f.width * h / f.height) + GAP for h in SIZES) for f in figs)
    sheet = Image.new("RGB", (LABEL_W + cell_w * len(GROUNDS), CELL_H * len(srcs)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for row, (src, fig) in enumerate(zip(srcs, figs)):
        y0 = row * CELL_H
        draw.text((10, y0 + CELL_H // 2), Path(src).stem, fill=(0, 0, 0))
        for col, (_, colour) in enumerate(GROUNDS):
            x0 = LABEL_W + col * cell_w
            cell = Image.new("RGBA", (cell_w, CELL_H), colour + (255,))
            x = GAP
            for h in SIZES:
                im = fig.resize((round(fig.width * h / fig.height), h), Image.LANCZOS)
                cell.alpha_composite(im, (x, CELL_H - 30 - h))
                x += im.width + GAP
            sheet.paste(cell.convert("RGB"), (x0, y0))
    sheet.save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
