"""Stitch the chapter's long thumbnail for the section-select scroll (client/src/game/chapter.ts).
usage: python -I tools/scroll_strip.py art/chapter1/scroll/strip.json

Each segment is a painting cropped ([x0, y0, x1, y1], fractions of the source) and scaled to
"height", crossfaded into the next over "join" pixels under a band of
mist (paper), the way a handscroll parts its scenes. Two pictures come out: <out>.jpg, the
restored colours, and <out>_ink.jpg, the same in ink (grey, pulled toward the paper), which the
scroll shows for the sections not cleared yet. Prints where each segment starts and ends, as
fractions of the strip's width, for chapter.ts.
"""
import json
import math
import sys

from PIL import Image, ImageOps

PAPER = (243, 238, 226)


def ink(im: Image.Image) -> Image.Image:
    """Grey ink on paper: the luminance, contrast lifted a little, its whites tinted paper."""
    g = ImageOps.autocontrast(im.convert('L'), cutoff=1)
    return ImageOps.colorize(g, black=(26, 24, 28), white=PAPER, mid=(128, 124, 118))


def main(path: str) -> None:
    cfg = json.load(open(path, encoding='utf-8'))
    h, join = cfg['height'], cfg['join']
    parts = []
    for s in cfg['segments']:
        im = Image.open(s['src']).convert('RGB')
        w0, h0 = im.size
        x0, y0, x1, y1 = s['crop']
        im = im.crop((round(x0 * w0), round(y0 * h0), round(x1 * w0), round(y1 * h0)))
        parts.append(im.resize((round(im.width * h / im.height), h), Image.LANCZOS))
    width = sum(p.width for p in parts) - join * (len(parts) - 1)
    out = Image.new('RGB', (width, h), PAPER)
    ramp = Image.linear_gradient('L').rotate(-90).resize((join, h))  # 255 at the left, 0 at the right
    # how much paper covers the seam across the join: none at its ends, most in its middle
    mist = Image.new('L', (join, h))
    mist.putdata([round(230 * math.sin(math.pi * (i % join) / (join - 1)) ** 2) for i in range(join * h)])
    x = 0
    spans = []
    for i, p in enumerate(parts):
        if i == 0:
            out.paste(p, (0, 0))
        else:
            # the join: the strip so far fades out over the new part's first `join` pixels
            left = out.crop((x, 0, x + join, h))
            out.paste(p, (x, 0))
            out.paste(left, (x, 0), ramp)
            # and a band of mist (blank paper) over the seam, as a handscroll parts its scenes
            band = Image.new('RGB', (join, h), PAPER)
            out.paste(band, (x, 0), mist)
        spans.append((x, x + p.width))
        x += p.width - join
    out.save(cfg['out'] + '.jpg', quality=84, optimize=True)
    ink(out).save(cfg['out'] + '_ink.jpg', quality=80, optimize=True)
    print(f'{width}x{h}')
    for s, (a, b) in zip(cfg['segments'], spans):
        print(f"{s['name']}: {a / width:.3f}..{b / width:.3f}")


if __name__ == '__main__':
    main(sys.argv[1])
