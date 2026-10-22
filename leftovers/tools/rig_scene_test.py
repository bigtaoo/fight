"""Readability sheet for rigged characters, as the game puts them on screen.
usage: python -I tools/rig_scene_test.py <out.png> <parts dir>:<world height> [...]

Each parts dir (split_parts.py output) is put together in its rest pose and scaled to its
world height (1080p logical, as bodyView.ts draws it). Per ground, one cell shows each figure
alone and then a crowd: the first figure in front of two of every other one, overlapping as
they do in a fight; a second row repeats it at half size (a phone held upright). The grounds
are the ones the painted-scroll world allows: light paper, a mid grey wash and the indigo
night wash (no black caves), so a dark hero that sinks into the night, or grey-indigo enemies
that melt into the wash or into each other, show up here.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

GROUNDS = [("paper", (239, 231, 214)), ("wash", (150, 146, 138)), ("night", (104, 110, 126))]
GAP = 30


def rest(parts_dir):
    """The figure in its rest pose, cropped to its pixels."""
    meta = json.load(open(os.path.join(parts_dir, "parts.json"), encoding="utf8"))["parts"]
    x0 = min(p["x"] for p in meta)
    y0 = min(p["y"] for p in meta)
    x1 = max(p["x"] + p["w"] for p in meta)
    y1 = max(p["y"] + p["h"] for p in meta)
    im = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for p in meta:
        im.alpha_composite(Image.open(os.path.join(parts_dir, p["name"] + ".png")).convert("RGBA"), (p["x"] - x0, p["y"] - y0))
    return im.crop(im.getbbox())


def figure_height(parts_dir):
    """Height of the figure without its weapon, which reaches past it: the scale reference."""
    meta = json.load(open(os.path.join(parts_dir, "parts.json"), encoding="utf8"))["parts"]
    body = [p for p in meta if p["name"] != "sword"]
    return max(p["y"] + p["h"] for p in body) - min(p["y"] for p in body)


def scaled(parts_dir, world_h, k):
    im = rest(parts_dir)
    f = world_h * k / figure_height(parts_dir)
    return im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)


def cell(figs, colour, k):
    h = max(f.height for f in figs) + 60 * k
    hero, others = figs[0], figs[1:]
    crowd_w = hero.width + sum(f.width for f in others) * 2
    w = GAP + sum(f.width + GAP for f in figs) + crowd_w // 2 + GAP * 2
    c = Image.new("RGBA", (int(w), int(h)), colour + (255,))
    base = int(h - 20 * k)
    x = GAP
    for f in figs:
        c.alpha_composite(f, (x, base - f.height))
        x += f.width + GAP
    # the crowd: enemies behind (higher up the floor, drawn first), the hero in front
    x += GAP
    cx = x
    for f in others:
        for i in range(2):
            c.alpha_composite(f, (int(cx), int(base - 18 * k - f.height)))
            cx += f.width * 0.45
    c.alpha_composite(hero, (int(x + 10 * k), base - hero.height))
    return c


def main(out, specs):
    rows = []
    for k in (1, 0.5):
        figs = []
        for s in specs:
            d, h = s.rsplit(":", 1)
            figs.append(scaled(d, float(h), k))
        rows.append([cell(figs, colour, k) for _, colour in GROUNDS])
    w = max(sum(c.width for c in r) for r in rows)
    sheet = Image.new("RGB", (w, sum(r[0].height for r in rows)), (255, 255, 255))
    y = 0
    for r in rows:
        x = 0
        for c in r:
            sheet.paste(c.convert("RGB"), (x, y))
            x += c.width
        y += r[0].height
    d = ImageDraw.Draw(sheet)
    x = 0
    for (name, _), c in zip(GROUNDS, rows[0]):
        d.text((x + 6, 4), name, fill=(0, 0, 0))
        x += c.width
    sheet.save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
