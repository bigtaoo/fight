"""Draw a rig weapon, horizontal, tip to the right: the hero's jian, or the bandit's dao.
usage: python -I tools/draw_sword.py <out.png> [jian|dao]

Drawn by code because FLUX puts a different sword in every painting and a separate blade is
what lets the rig swing it. Ink silhouette like the figure: a black blade with one white edge
line, a dark guard and grip, a short vermilion tassel at the pommel. The dao is a broad,
single-edged saber widening toward a clipped tip, grey-indigo like the bandits (no red), with
an indigo rag at the pommel. Prints the grip centre, which the split spec needs.
"""
import sys

from PIL import Image, ImageDraw, ImageFilter

K = 4  # supersampling
L, H = 820, 70  # final size in source pixels
INK = (22, 20, 24, 255)
EDGE = (232, 228, 218, 255)
RED = (200, 40, 30, 255)
MID = H // 2
THICK = 1.5


def main(out, kind="jian"):
    if kind == "dao":
        return dao(out)
    im = Image.new("RGBA", (L * K, H * K), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def poly(pts, fill):
        d.polygon([(x * K, y * K) for x, y in pts], fill=fill)

    # tassel hanging back and down from the pommel
    poly([(14, MID), (4, MID + 6), (0, MID + 26), (8, MID + 30), (18, MID + 6)], RED)
    poly([(12, MID - 7), (100, MID - 6), (100, MID + 6), (12, MID + 7), (6, MID)], INK)  # grip
    poly([(100, MID - 20), (114, MID - 22), (114, MID + 22), (100, MID + 20)], INK)  # guard
    poly([(114, MID - 11), (750, MID - 7), (812, MID), (750, MID + 7), (114, MID + 11)], INK)  # blade
    # the white edge line, thinning toward the tip
    poly([(128, MID - 3), (746, MID - 2.2), (798, MID), (746, MID - 0.6), (128, MID - 0.5)], EDGE)
    for x in range(22, 96, 14):  # grip wrap
        poly([(x, MID - 7), (x + 4, MID - 7), (x + 1, MID + 7), (x - 3, MID + 7)], (70, 66, 64, 255))
    # drawn at true proportions, then thickened: a true-width jian is a hairline at game size
    im = im.filter(ImageFilter.GaussianBlur(K * 0.4)).resize((L, round(H * THICK)), Image.LANCZOS)
    im.save(out)
    print(f"grip centre: [56, {round(MID * THICK)}]")


DAO_L, DAO_H = 600, 90
DAO_INK = (52, 58, 72, 255)
DAO_RAG = (52, 70, 107, 255)


def dao(out):
    L, H = DAO_L, DAO_H
    mid = 40  # the grip line; the blade widens below it, toward the edge
    im = Image.new("RGBA", (L * K, H * K), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def poly(pts, fill):
        d.polygon([(x * K, y * K) for x, y in pts], fill=fill)

    poly([(12, mid), (2, mid + 8), (0, mid + 34), (12, mid + 30), (20, mid + 6)], DAO_RAG)  # rag
    poly([(10, mid - 8), (92, mid - 7), (92, mid + 7), (10, mid + 8), (4, mid)], (34, 36, 44, 255))  # grip
    poly([(92, mid - 16), (104, mid - 16), (104, mid + 20), (92, mid + 20)], (34, 36, 44, 255))  # guard
    # spine nearly straight along the top, the edge bellying out and sweeping up to a clipped tip
    poly([(104, mid - 9), (560, mid - 12), (598, mid - 22), (588, mid + 8), (520, mid + 30), (300, mid + 26), (104, mid + 14)], DAO_INK)
    # white edge line along the belly
    poly([(116, mid + 10), (300, mid + 22), (520, mid + 26), (584, mid + 6), (580, mid + 2), (518, mid + 22), (300, mid + 18), (116, mid + 7)], EDGE)
    for x in range(18, 88, 14):  # grip wrap
        poly([(x, mid - 8), (x + 4, mid - 8), (x + 1, mid + 8), (x - 3, mid + 8)], (80, 84, 96, 255))
    im = im.filter(ImageFilter.GaussianBlur(K * 0.4)).resize((L, round(H * THICK)), Image.LANCZOS)
    im.save(out)
    print(f"grip centre: [50, {round(mid * THICK)}]")


if __name__ == "__main__":
    main(*sys.argv[1:3])
