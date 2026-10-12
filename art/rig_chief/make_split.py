"""Write chief_apose.png and split.json, the cut of it into rig parts (see tools/split_parts.py).
usage: python -I art/rig_chief/make_split.py

The painting (chief_apose_B.png) faced left and stood on a grey wash of ground shadow, so it is
mirrored and the wash under the boots is wiped to paper first. It is three-quarters on rather
than in profile, both arms hanging well clear of the body, and the plated skirt covers both
thighs: they are hidden fill that only shows, as flat ink, when a stride swings a leg out from
under the plates.

Colours: a boss among the bandits, so the same family (leather browns, the indigo belt that
marks every enemy, no red) but darker and heavier: a dark brown coat, a grey-brown fur mantle,
iron bracers and skirt plates.
"""
import json
import math
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def circle(cx, cy, r, n=16):
    return [[round(cx + r * math.cos(2 * math.pi * i / n)), round(cy + r * math.sin(2 * math.pi * i / n))] for i in range(n)]


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def source():
    im = Image.open(os.path.join(HERE, "chief_apose_B.png")).convert("RGB").transpose(Image.FLIP_LEFT_RIGHT)
    a = np.array(im)
    # the ground wash: pale grey below the ankles; the boots are near-black
    low = a[1040:]
    low[low.mean(axis=2) > 120] = 255
    Image.fromarray(a).save(os.path.join(HERE, "chief_apose.png"))


KNEE_B, KNEE_F = (350, 880), (572, 872)
FUR = [118, 104, 86]
IRON = [66, 70, 80]
SKIN = [178, 130, 92]

SPEC = {
    "source": "chief_apose.png",
    "pale_keep": 0.3,
    "tint": [72, 54, 42],
    # regions claim in this order, each what the ones before it left: the painting's fill runs
    # on unbroken from beard to fur to coat, so the seams are these outlines, traced on it
    "regions": [
        {"name": "topknot", "tint": [34, 32, 34], "all": True, "poly": box(396, 20, 490, 80)},
        # the shaved scalp and the face down to the moustache
        {"name": "face", "tint": SKIN, "all": True,
         "poly": [[398, 98], [440, 78], [495, 88], [520, 128], [538, 162], [536, 204], [500, 212], [460, 212],
                  [432, 200], [428, 168], [410, 172], [398, 140]]},
        {"name": "beard", "tint": [34, 32, 34], "all": True,
         "poly": [[378, 150], [428, 165], [432, 200], [460, 212], [536, 204], [548, 240], [526, 296], [502, 346],
                  [465, 360], [430, 332], [400, 292], [376, 220]]},
        {"name": "fur", "tint": FUR, "all": True,
         "poly": [[284, 238], [340, 204], [400, 188], [530, 192], [576, 234], [614, 290], [596, 336], [540, 352],
                  [500, 374], [440, 374], [380, 346], [330, 320], [286, 282]]},
        {"name": "belt", "tint": [44, 58, 88], "all": True,
         "poly": [[340, 552], [420, 570], [490, 576], [560, 566], [618, 548], [628, 602], [560, 624], [490, 638],
                  [420, 630], [340, 608]]},
        {"name": "hand_b", "tint": SKIN, "all": True, "poly": box(80, 646, 222, 780)},
        {"name": "hand_f", "tint": SKIN, "all": True, "poly": box(690, 644, 812, 760)},
        {"name": "bracer_b", "tint": IRON, "all": True,
         "poly": [[110, 470], [250, 470], [240, 545], [212, 646], [86, 646], [100, 560]]},
        {"name": "bracer_f", "tint": IRON, "all": True,
         "poly": [[620, 465], [735, 460], [796, 600], [796, 644], [690, 644], [650, 560]]},
        {"name": "plates", "tint": IRON, "all": True,
         "poly": [[340, 608], [420, 630], [490, 638], [560, 624], [628, 602], [650, 620], [650, 805], [262, 805],
                  [262, 690], [340, 680]]},
        {"name": "coat", "tint": [72, 54, 42], "all": True, "poly": box(180, 180, 700, 700)},
        {"name": "trousers", "tint": [60, 54, 50], "all": True, "poly": box(270, 780, 620, 900)},
        {"name": "boots", "tint": [30, 28, 28], "all": True, "poly": box(260, 890, 690, 1140)},
    ],
    "outline": {"width": 10, "color": [24, 24, 30]},
    "parts": [
        {"name": "arm_b_upper",
         "poly": [[236, 296], [330, 296], [318, 380], [296, 470], [270, 520], [182, 520], [190, 420], [206, 340]],
         "hidden": [box(270, 320, 340, 470)], "pivot": [280, 345]},
        {"name": "arm_b_lower",
         "poly": [[160, 470], [262, 470], [252, 560], [222, 650], [88, 650], [98, 540], [120, 480]],
         "hidden": [box(170, 465, 246, 515)], "pivot": [205, 490]},
        {"name": "hand_b", "poly": box(80, 630, 222, 780),
         "hidden": [box(110, 620, 200, 650)], "hidden_fill": "copy", "pivot": [158, 640]},
        {"name": "leg_b_thigh", "poly": box(282, 690, 452, 900), "exclude_parts": ["robe"],
         "hidden": [box(300, 690, 440, 900)], "caps": [circle(*KNEE_B, 40)], "pivot": [365, 705]},
        {"name": "leg_b_shin",
         "poly": [[272, 870], [430, 870], [416, 1040], [420, 1130], [270, 1130]],
         "hidden": [box(300, 850, 400, 920)], "caps": [circle(*KNEE_B, 40)], "pivot": list(KNEE_B), "hidden_fill": "copy"},
        {"name": "leg_f_thigh", "poly": box(452, 690, 625, 895), "exclude_parts": ["robe"],
         "hidden": [box(470, 690, 615, 895)], "caps": [circle(*KNEE_F, 38)], "pivot": [535, 705]},
        {"name": "leg_f_shin",
         "poly": [[452, 864], [625, 864], [606, 1030], [690, 1060], [690, 1110], [452, 1110]],
         "hidden": [box(528, 840, 628, 910)], "caps": [circle(*KNEE_F, 38)], "pivot": list(KNEE_F), "hidden_fill": "copy"},
        # the plated skirt, from the belt down, with the pouch on the hip
        {"name": "robe",
         "poly": [[262, 600], [646, 600], [646, 810], [262, 810]],
         "exclude_parts": ["arm_b_lower", "hand_b", "arm_f_lower", "hand_f"],
         "hidden": [box(300, 590, 620, 630)], "pivot": [450, 610]},
        {"name": "torso",
         "poly": [[290, 200], [610, 200], [650, 290], [606, 360], [636, 470], [622, 560], [640, 640],
                  [262, 640], [270, 540], [296, 470], [318, 380], [290, 300]],
         "exclude_parts": ["head"],
         "hidden": [box(296, 280, 610, 400), box(290, 600, 630, 650)], "hidden_fill": "copy", "pivot": [450, 610]},
        {"name": "head",
         "poly": [[372, 40], [548, 40], [552, 180], [536, 240], [512, 300], [496, 352], [440, 362], [402, 300], [380, 220]],
         "hidden": [box(410, 270, 500, 330)], "hidden_fill": "copy", "pivot": [455, 300]},
        {"name": "arm_f_upper",
         "poly": [[580, 290], [640, 290], [668, 360], [676, 420], [700, 470], [700, 510], [612, 520], [618, 470], [606, 380], [596, 340]],
         "hidden": [box(590, 320, 640, 470)], "hidden_fill": "copy", "pivot": [612, 345]},
        {"name": "arm_f_lower",
         "poly": [[612, 466], [712, 456], [760, 520], [796, 600], [796, 640], [700, 640], [660, 580], [630, 520]],
         "hidden": [box(616, 470, 690, 520)], "hidden_fill": "copy", "pivot": [650, 490]},
        # the axe, drawn by code (tools/draw_sword.py axe), hanging forward from the near fist
        {"name": "sword", "image": "axe.png", "grip": [140, 44], "angle": 70, "pivot": [752, 690]},
        {"name": "hand_f", "poly": box(690, 616, 812, 760),
         "hidden": [box(706, 610, 790, 640)], "hidden_fill": "copy", "pivot": [745, 630]},
    ],
}

if __name__ == "__main__":
    source()
    with open(os.path.join(HERE, "split.json"), "w", encoding="utf8") as f:
        json.dump(SPEC, f, indent=1)
