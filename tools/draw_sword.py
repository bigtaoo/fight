"""Draw a rig weapon, horizontal, tip to the right: the hero's jian, the bandit's dao, the
shield bearer's shield or the archer's bow.
usage: python -I tools/draw_sword.py <out.png> [jian|dao|shield|bow]

Drawn by code because FLUX puts a different sword in every painting and a separate blade is
what lets the rig swing it. Ink silhouette like the figure: a black blade with one white edge
line, a dark guard and grip, a short vermilion tassel at the pommel. The dao is a broad,
single-edged saber widening toward a clipped tip, grey-indigo like the bandits (no red), with
an indigo rag at the pommel. The shield is a tall wooden board seen three-quarters on, its top
to the right: iron rim and bands, a boss in the middle where the hand grips it from behind,
the board's thickness a darker strip along one long edge. The bow is a recurve with its upper
tip to the right and the belly bulging toward +y (forward, once the rig turns it upright); it
has no string, which the client draws so it can be pulled. Prints the grip centre, which the
split spec needs.
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
    if kind == "shield":
        return shield(out)
    if kind == "bow":
        return bow(out)
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


SH_L, SH_H = 680, 240
WOOD = (112, 82, 56, 255)
WOOD_DARK = (70, 50, 36, 255)
IRON = (40, 42, 50, 255)


def shield(out):
    L, H = SH_L, SH_H
    im = Image.new("RGBA", (L * K, H * K), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def rect(x0, y0, x1, y1, fill, r=0):
        d.rounded_rectangle([x0 * K, y0 * K, x1 * K, y1 * K], radius=r * K, fill=fill)

    rect(0, 0, L, H, IRON, 26)  # rim
    rect(10, 10, L - 10, H - 34, WOOD, 18)  # face
    rect(10, H - 34, L - 10, H - 10, WOOD_DARK, 8)  # the board's edge, turned toward us
    for x in range(40, L - 30, 46):  # planks
        d.line([(x * K, 14 * K), (x * K + 3 * K, (H - 36) * K)], fill=(92, 66, 46, 255), width=3 * K)
    for x in (120, L - 120):  # iron bands across the planks
        rect(x - 12, 6, x + 12, H - 6, IRON, 4)
    cx, cy = L // 2, (H - 24) // 2
    d.ellipse([(cx - 44) * K, (cy - 44) * K, (cx + 44) * K, (cy + 44) * K], fill=IRON)  # boss
    d.ellipse([(cx - 22) * K, (cy - 30) * K, (cx + 6) * K, (cy - 6) * K], fill=(150, 148, 140, 255))  # its glint
    # the pale edge line along the top of the rim, like the blades'
    d.line([(30 * K, 4 * K), ((L - 30) * K, 4 * K)], fill=EDGE, width=3 * K)
    im = im.filter(ImageFilter.GaussianBlur(K * 0.4)).resize((L, H), Image.LANCZOS)
    im.save(out)
    print(f"grip centre: [{cx}, {cy}]")


BOW_L, BOW_H = 720, 120
BOW_INK = (34, 30, 30, 255)
BOW_WRAP = (96, 70, 48, 255)


def bow(out):
    import math
    L, H = BOW_L, BOW_H
    tip_y, belly_y = 34, 92  # string side up (back, once upright), belly down (forward)
    im = Image.new("RGBA", (L * K, H * K), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # each limb: a tapering stroke on a curve from the grip out to the tip, the last stretch
    # flicking back toward the belly (the recurve)
    pts = []
    for i in range(0, 101):
        u = i / 100  # -1 .. 1 along the bow, 0 at the grip
        t = 2 * u - 1
        x = L / 2 + t * (L / 2 - 14)
        y = belly_y - (belly_y - tip_y) * t * t
        if abs(t) > 0.86:
            y += 900 * (abs(t) - 0.86) ** 2
        w = 24 - 14 * abs(t)
        pts.append((x, y, w))
    for (x0, y0, w0), (x1, y1, w1) in zip(pts, pts[1:]):
        d.line([(x0 * K, y0 * K), (x1 * K, y1 * K)], fill=BOW_INK, width=round((w0 + w1) * K / 2))
        d.ellipse([(x1 - w1 / 2) * K, (y1 - w1 / 2) * K, (x1 + w1 / 2) * K, (y1 + w1 / 2) * K], fill=BOW_INK)
    d.rounded_rectangle([(L / 2 - 30) * K, (belly_y - 12) * K, (L / 2 + 30) * K, (belly_y + 12) * K], radius=6 * K, fill=BOW_WRAP)
    for x in (pts[0][0], pts[-1][0]):  # horn nocks
        d.ellipse([(x - 7) * K, (pts[0][1] - 7) * K, (x + 7) * K, (pts[0][1] + 7) * K], fill=(70, 66, 60, 255))
    im = im.filter(ImageFilter.GaussianBlur(K * 0.4)).resize((L, H), Image.LANCZOS)
    im.save(out)
    print(f"grip centre: [{L // 2}, {belly_y}]")
    print(f"tips: [{pts[0][0]:.0f}, {pts[0][1]:.0f}] [{pts[-1][0]:.0f}, {pts[-1][1]:.0f}]")


if __name__ == "__main__":
    main(*sys.argv[1:3])
