"""Draw the grey A-pose mannequin that FLUX paints the rig character over.
usage: python -I tools/mannequin.py <out.png> [<joints.json>] [--build lean|stocky]

The pose comes from code, not from the prompt: FLUX edits keep the silhouette they are given
but will not move limbs on request, and a faceless grey doll is not a portrait, so the edit is
not blocked as one. The joints file lists every joint and limb segment in image pixels, the
starting point for the split spec of the painted result.

Side view facing right, adult proportions of about 7.5 heads (a big head makes FLUX paint a child), feet at FEET_Y. Arms hang about 30 degrees out
from the body and the legs stand apart, so paper shows between every limb and the body.

Builds: "lean" is the hero (long robe, topknot). "stocky" is the bandit: the same hips, knees
and feet, so walk cycles carry over, but broad shoulders set wider, thick limbs, a short jerkin
that stops above the knee and a bare round head without a topknot.
"""
import json
import math
import sys

from PIL import Image, ImageDraw

W, H = 768, 1024
FEET_Y = 965
GREY = (128, 128, 128)
PAPER = (255, 255, 255)

BUILDS = {
    "lean": {
        "shoulder": 51, "arm": (42, 36), "leg": (54, 42), "arm_out": 28, "hand": (22, 28), "hip": 25, "neck": 19,
        "torso": [(318, 252), (472, 252), (466, 300), (436, 484), (352, 484), (326, 300)],
        "skirt": [(348, 466), (440, 466), (486, 745), (300, 745)],
        "topknot": True,
    },
    "stocky": {
        "shoulder": 70, "arm": (56, 48), "leg": (66, 52), "arm_out": 32, "hand": (30, 36), "hip": 38, "neck": 30,
        "torso": [(296, 250), (494, 250), (500, 310), (458, 488), (330, 488), (290, 310)],
        "skirt": [(328, 470), (462, 470), (500, 690), (286, 690)],
        "topknot": False,
    },
}


def along(p, deg, length):
    """Point `length` px from p at `deg` degrees from straight down, positive toward +x."""
    a = math.radians(deg)
    return (p[0] + math.sin(a) * length, p[1] + math.cos(a) * length)


def joints(b):
    """Joints in image pixels; "b" is the far (back) side, "f" the near (front) side."""
    J = {
        "crown": (396, 96),
        "head": (402, 160),
        "neck": (400, 236),
        "shoulder_b": (395 - b["shoulder"], 274),
        "shoulder_f": (395 + b["shoulder"], 274),
        "waist": (394, 480),
        "hip_b": (395 - b["hip"], 520),
        "hip_f": (395 + b["hip"], 520),
    }
    out = b["arm_out"]
    J["elbow_b"] = along(J["shoulder_b"], -out, 170)
    J["wrist_b"] = along(J["elbow_b"], -out + 6, 155)
    J["elbow_f"] = along(J["shoulder_f"], out, 170)
    J["wrist_f"] = along(J["elbow_f"], out - 6, 155)
    J["knee_b"] = along(J["hip_b"], -7, 210)
    J["ankle_b"] = (J["knee_b"][0] - 6, FEET_Y - 36)
    J["knee_f"] = along(J["hip_f"], 7, 210)
    J["ankle_f"] = (J["knee_f"][0] + 6, FEET_Y - 36)
    return J


def limbs(b):
    ua, la = b["arm"]
    th, sh = b["leg"]
    return {
        "arm_b_upper": ("shoulder_b", "elbow_b", ua),
        "arm_b_lower": ("elbow_b", "wrist_b", la),
        "arm_f_upper": ("shoulder_f", "elbow_f", ua),
        "arm_f_lower": ("elbow_f", "wrist_f", la),
        "leg_b_thigh": ("hip_b", "knee_b", th),
        "leg_b_shin": ("knee_b", "ankle_b", sh),
        "leg_f_thigh": ("hip_f", "knee_f", th),
        "leg_f_shin": ("knee_f", "ankle_f", sh),
    }


def limb(d, a, b, w, fill):
    d.line([a, b], fill=fill, width=w)
    for p in (a, b):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fill)


def draw(b):
    J, L = joints(b), limbs(b)
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    # far limbs first, so the near ones overlap them where they cross
    for side in ("b", "f"):
        for name in (f"leg_{side}_thigh", f"leg_{side}_shin"):
            a, c, w = L[name]
            limb(d, J[a], J[c], w, GREY)
        ax, ay = J[f"ankle_{side}"]
        # boot, toe forward (+x)
        d.polygon([(ax - 24, ay - 10), (ax + 20, ay - 10), (ax + 54, FEET_Y - 13), (ax + 56, FEET_Y), (ax - 27, FEET_Y)], fill=GREY)
    # torso: shoulders to waist; robe or jerkin skirt below, flaring out
    d.polygon(b["torso"], fill=GREY)
    d.polygon(b["skirt"], fill=GREY)
    d.rectangle([401 - b["neck"], 204, 401 + b["neck"], 258], fill=GREY)
    hx, hy = J["head"]
    d.ellipse([hx - 46, hy - 58, hx + 46, hy + 58], fill=GREY)
    d.polygon([(hx + 38, hy - 8), (hx + 56, hy + 14), (hx + 40, hy + 22)], fill=GREY)  # nose, facing +x
    if b["topknot"]:
        cx, cy = J["crown"]
        d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=GREY)
    for side in ("b", "f"):
        for name in (f"arm_{side}_upper", f"arm_{side}_lower"):
            a, c, w = L[name]
            limb(d, J[a], J[c], w, GREY)
        wx, wy = J[f"wrist_{side}"]
        hand = along((wx, wy), -20 if side == "b" else 20, 26)
        rx, ry = b["hand"]
        d.ellipse([hand[0] - rx, hand[1] - ry, hand[0] + rx, hand[1] + ry], fill=GREY)
    return im, J, L


def main(argv):
    build = "lean"
    if "--build" in argv:
        i = argv.index("--build")
        build = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    out, joints_file = argv[0], argv[1] if len(argv) > 1 else None
    im, J, L = draw(BUILDS[build])
    im.save(out)
    if joints_file:
        rnd = {k: [round(v[0]), round(v[1])] for k, v in J.items()}
        with open(joints_file, "w", encoding="utf8") as f:
            json.dump({"size": [W, H], "feet_y": FEET_Y, "joints": rnd, "limbs": {k: list(v) for k, v in L.items()}}, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
