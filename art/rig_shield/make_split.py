"""Write split.json, the cut of shield_apose.png into rig parts (see tools/split_parts.py).
usage: python -I art/rig_shield/make_split.py

Kept as code rather than hand-edited JSON so the knee caps are circles and the numbers carry
a word of where they came from.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def circle(cx, cy, r, n=16):
    return [[round(cx + r * math.cos(2 * math.pi * i / n)), round(cy + r * math.sin(2 * math.pi * i / n))] for i in range(n)]


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


KNEE_B, KNEE_F = (335, 905), (520, 905)

SPEC = {
    "source": "shield_apose.png",
    "pale_keep": 0.3,
    # a dull bronze lamellar: warm and mid-toned like the bandit, so it holds on the cool,
    # mid-grey grounds, but cooler and greyer than the bandit's ochre
    "tint": [112, 96, 70],
    "regions": [
        {"name": "helmet", "tint": [58, 62, 72], "seeds": [[440, 120], [380, 70]],
         "poly": [[330, 30], [580, 30], [580, 178], [500, 180], [430, 192], [390, 215], [335, 240]]},
        {"name": "face", "tint": [150, 112, 84], "seeds": [[470, 240], [430, 230]],
         "poly": [[385, 200], [440, 185], [530, 180], [545, 240], [530, 292], [480, 300], [430, 288], [395, 262]]},
        {"name": "belt", "tint": [44, 58, 88], "seeds": [[360, 560], [520, 560], [450, 600]],
         "poly": [[300, 540], [560, 540], [560, 592], [472, 600], [472, 645], [418, 645], [418, 600], [300, 592]]},
        {"name": "hands", "tint": [52, 46, 42], "seeds": [[140, 690], [730, 690]],
         "poly": box(80, 640, 800, 780)},
        # the plates: shoulders, chest, vambraces, each cut into many small pieces by the trim
        {"name": "armour", "tint": [112, 96, 70], "all": True, "poly": box(80, 230, 800, 652)},
        {"name": "skirt", "tint": [92, 60, 42], "all": True, "poly": box(250, 590, 620, 805)},
        {"name": "trousers", "tint": [60, 54, 50], "all": True, "poly": box(240, 790, 600, 935)},
        {"name": "boots", "tint": [30, 28, 28], "all": True, "poly": box(230, 935, 690, 1140)},
    ],
    "outline": {"width": 10, "color": [24, 24, 30]},
    "parts": [
        {"name": "arm_b_upper",
         "poly": [[225, 278], [335, 272], [352, 340], [330, 420], [306, 470], [262, 512], [140, 512], [150, 460], [190, 430], [210, 330]],
         "hidden": [box(290, 320, 360, 450)], "pivot": [300, 350]},
        {"name": "arm_b_lower",
         "poly": [[140, 470], [262, 470], [252, 560], [200, 645], [96, 645], [118, 560]],
         "hidden": [box(160, 482, 240, 515)], "pivot": [200, 492]},
        {"name": "hand_b", "poly": box(78, 615, 210, 790),
         "hidden": [box(115, 618, 185, 645)], "pivot": [148, 635]},
        {"name": "leg_b_thigh",
         "poly": [[260, 690], [410, 690], [410, 935], [255, 935]], "exclude_parts": ["robe"],
         "hidden": [box(300, 640, 410, 800)], "caps": [circle(*KNEE_B, 46)], "pivot": [365, 660]},
        {"name": "leg_b_shin",
         "poly": [[248, 890], [408, 890], [410, 1040], [430, 1070], [430, 1130], [252, 1130]],
         "hidden": [box(292, 860, 380, 935)], "caps": [circle(*KNEE_B, 46)], "pivot": list(KNEE_B), "hidden_fill": "copy"},
        {"name": "leg_f_thigh",
         "poly": [[440, 690], [595, 690], [592, 935], [448, 935], [440, 860]], "exclude_parts": ["robe"],
         "hidden": [box(455, 640, 575, 800)], "caps": [circle(*KNEE_F, 46)], "pivot": [510, 660]},
        {"name": "leg_f_shin",
         "poly": [[446, 890], [598, 890], [592, 1030], [664, 1060], [664, 1118], [446, 1118]],
         "hidden": [box(478, 860, 566, 935)], "caps": [circle(*KNEE_F, 46)], "pivot": list(KNEE_F), "hidden_fill": "copy"},
        {"name": "robe", "poly": box(250, 575, 616, 808),
         "hidden": [box(300, 560, 600, 600)], "pivot": [440, 590]},
        {"name": "torso",
         "poly": [[330, 228], [560, 228], [576, 300], [562, 440], [568, 500], [602, 536], [616, 604], [296, 604], [300, 476], [326, 430], [338, 300]],
         "exclude_parts": ["head"],
         "hidden": [box(345, 245, 540, 330), box(306, 560, 604, 612)], "hidden_fill": "copy", "pivot": [440, 590]},
        {"name": "head",
         "poly": [[330, 30], [585, 30], [585, 240], [535, 250], [532, 302], [400, 302], [384, 252], [330, 252]],
         "hidden": [box(410, 250, 505, 312)], "hidden_fill": "copy", "pivot": [450, 282]},
        {"name": "arm_f_upper",
         "poly": [[535, 268], [642, 278], [672, 340], [684, 430], [724, 466], [722, 512], [640, 520], [606, 476], [566, 444], [562, 330]],
         "hidden": [box(540, 320, 592, 444)], "hidden_fill": "copy", "pivot": [580, 350]},
        {"name": "arm_f_lower",
         "poly": [[636, 470], [744, 466], [774, 560], [776, 648], [688, 648], [652, 560]],
         "hidden": [box(640, 480, 720, 515)], "hidden_fill": "copy", "pivot": [680, 492]},
        {"name": "hand_f", "poly": box(668, 615, 800, 790),
         "hidden": [box(690, 618, 760, 645)], "hidden_fill": "copy", "pivot": [722, 635]},
        # the shield, drawn by code (tools/draw_sword.py shield), gripped at its boss from
        # behind and stood upright at the hand: drawn last, over the hand that holds it
        {"name": "shield", "image": "shield.png", "grip": [340, 108], "angle": -90, "pivot": [728, 700]},
    ],
}

if __name__ == "__main__":
    with open(os.path.join(HERE, "split.json"), "w", encoding="utf8") as f:
        json.dump(SPEC, f, indent=1)
