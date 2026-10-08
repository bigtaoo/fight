"""Draw the grey A-pose mannequin that FLUX paints the rig character over.
usage: python -I tools/mannequin.py <out.png> [<joints.json>]

The pose comes from code, not from the prompt: FLUX edits keep the silhouette they are given
but will not move limbs on request, and a faceless grey doll is not a portrait, so the edit is
not blocked as one. The joints file lists every joint and limb segment in image pixels, the
starting point for the split spec of the painted result.

Side view facing right, adult proportions of about 7.5 heads (a big head makes FLUX paint a child), feet at FEET_Y. Arms hang about 30 degrees out
from the body and the legs stand apart, so paper shows between every limb and the body.
"""
import json
import math
import sys

from PIL import Image, ImageDraw

W, H = 768, 1024
FEET_Y = 965
GREY = (128, 128, 128)
PAPER = (255, 255, 255)

# joints in image pixels; "b" is the far (back) side, "f" the near (front) side
J = {
    "crown": (396, 96),
    "head": (402, 160),
    "neck": (400, 236),
    "shoulder_b": (344, 274),
    "shoulder_f": (446, 274),
    "waist": (394, 480),
    "hip_b": (370, 520),
    "hip_f": (420, 520),
}


def along(p, deg, length):
    """Point `length` px from p at `deg` degrees from straight down, positive toward +x."""
    a = math.radians(deg)
    return (p[0] + math.sin(a) * length, p[1] + math.cos(a) * length)


J["elbow_b"] = along(J["shoulder_b"], -28, 170)
J["wrist_b"] = along(J["elbow_b"], -22, 155)
J["elbow_f"] = along(J["shoulder_f"], 28, 170)
J["wrist_f"] = along(J["elbow_f"], 22, 155)
J["knee_b"] = along(J["hip_b"], -7, 210)
J["ankle_b"] = (J["knee_b"][0] - 6, FEET_Y - 36)
J["knee_f"] = along(J["hip_f"], 7, 210)
J["ankle_f"] = (J["knee_f"][0] + 6, FEET_Y - 36)

LIMBS = {
    "arm_b_upper": ("shoulder_b", "elbow_b", 42),
    "arm_b_lower": ("elbow_b", "wrist_b", 36),
    "arm_f_upper": ("shoulder_f", "elbow_f", 42),
    "arm_f_lower": ("elbow_f", "wrist_f", 36),
    "leg_b_thigh": ("hip_b", "knee_b", 54),
    "leg_b_shin": ("knee_b", "ankle_b", 42),
    "leg_f_thigh": ("hip_f", "knee_f", 54),
    "leg_f_shin": ("knee_f", "ankle_f", 42),
}


def limb(d, a, b, w, fill):
    d.line([a, b], fill=fill, width=w)
    for p in (a, b):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fill)


def draw():
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    # far limbs first, so the near ones overlap them where they cross
    for side in ("b", "f"):
        for name in (f"leg_{side}_thigh", f"leg_{side}_shin"):
            a, b, w = LIMBS[name]
            limb(d, J[a], J[b], w, GREY)
        ax, ay = J[f"ankle_{side}"]
        # boot, toe forward (+x)
        d.polygon([(ax - 24, ay - 10), (ax + 20, ay - 10), (ax + 54, FEET_Y - 13), (ax + 56, FEET_Y), (ax - 27, FEET_Y)], fill=GREY)
    # torso: shoulders to waist, a little narrower at the waist
    d.polygon([(318, 252), (472, 252), (466, 300), (436, 484), (352, 484), (326, 300)], fill=GREY)
    # robe skirt: waist to just below the knee, flaring out
    d.polygon([(348, 466), (440, 466), (486, 745), (300, 745)], fill=GREY)
    d.rectangle([382, 204, 420, 258], fill=GREY)
    hx, hy = J["head"]
    d.ellipse([hx - 46, hy - 58, hx + 46, hy + 58], fill=GREY)
    d.polygon([(hx + 38, hy - 8), (hx + 56, hy + 14), (hx + 40, hy + 22)], fill=GREY)  # nose, facing +x
    cx, cy = J["crown"]
    d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=GREY)  # topknot
    for side in ("b", "f"):
        for name in (f"arm_{side}_upper", f"arm_{side}_lower"):
            a, b, w = LIMBS[name]
            limb(d, J[a], J[b], w, GREY)
        wx, wy = J[f"wrist_{side}"]
        hand = along((wx, wy), -20 if side == "b" else 20, 26)
        d.ellipse([hand[0] - 22, hand[1] - 28, hand[0] + 22, hand[1] + 28], fill=GREY)
    return im


def main(out, joints=None):
    draw().save(out)
    if joints:
        rnd = {k: [round(v[0]), round(v[1])] for k, v in J.items()}
        limbs = {k: [a, b, w] for k, (a, b, w) in LIMBS.items()}
        with open(joints, "w", encoding="utf8") as f:
            json.dump({"size": [W, H], "feet_y": FEET_Y, "joints": rnd, "limbs": limbs}, f, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:3])
