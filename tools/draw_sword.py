"""Draw the hero's jian as a rig part: horizontal, tip to the right.
usage: python -I tools/draw_sword.py <out.png>

Drawn by code because FLUX puts a different sword in every painting and a separate blade is
what lets the rig swing it. Ink silhouette like the figure: a black blade with one white edge
line, a dark guard and grip, a short vermilion tassel at the pommel. Prints the grip centre,
which the split spec needs.
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


def main(out):
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


if __name__ == "__main__":
    main(sys.argv[1])
