"""Write split.json, the cut of archer_apose.png into rig parts (see tools/split_parts.py).
usage: python -I art/rig_archer/make_split.py

The long coat covers both thighs and knees, so the thighs are nothing but hidden fill: they
only show, as flat ink, when a stride swings a leg out from under the hem.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def circle(cx, cy, r, n=16):
    return [[round(cx + r * math.cos(2 * math.pi * i / n)), round(cy + r * math.sin(2 * math.pi * i / n))] for i in range(n)]


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


KNEE_B, KNEE_F = (348, 870), (494, 878)

SPEC = {
    "source": "archer_apose.png",
    "pale_keep": 0.3,
    # a muted olive coat: warm enough to stand off the cool grounds, a different hue from the
    # bandit's ochre and the shield bearer's bronze
    "tint": [86, 92, 62],
    "regions": [
        {"name": "hair", "tint": [34, 32, 34], "seeds": [[420, 80], [400, 190]],
         "poly": [[340, 30], [525, 30], [525, 128], [450, 140], [436, 200], [432, 262], [338, 262]]},
        {"name": "face", "tint": [178, 130, 92], "seeds": [[480, 200], [470, 240]],
         "poly": [[436, 140], [525, 128], [548, 150], [540, 262], [436, 262]]},
        {"name": "quiver", "tint": [124, 80, 52], "all": True,
         "poly": [[190, 70], [352, 70], [352, 290], [300, 300], [250, 340], [190, 250]]},
        {"name": "belt", "tint": [44, 58, 88], "seeds": [[400, 552], [480, 550], [512, 620], [278, 720], [350, 550]],
         "poly": [[250, 530], [560, 530], [560, 670], [500, 670], [480, 590], [330, 590], [305, 790], [250, 790]]},
        {"name": "hand_b", "tint": [178, 130, 92], "seeds": [[195, 710]], "poly": box(140, 662, 255, 790)},
        {"name": "hand_f", "tint": [178, 130, 92], "seeds": [[680, 700]], "poly": box(630, 662, 730, 780)},
        # the coat: everything else above the hem, the sleeves included
        {"name": "coat", "tint": [86, 92, 62], "all": True, "poly": box(150, 250, 720, 902)},
        {"name": "trousers", "tint": [60, 54, 50], "all": True, "poly": box(290, 895, 560, 945)},
        {"name": "boots", "tint": [30, 28, 28], "all": True, "poly": box(280, 935, 640, 1160)},
    ],
    "outline": {"width": 10, "color": [24, 24, 30]},
    "parts": [
        {"name": "arm_b_upper",
         "poly": [[258, 296], [330, 296], [338, 380], [314, 470], [302, 522], [198, 522], [216, 440], [242, 360]],
         "hidden": [box(296, 330, 346, 470)], "pivot": [305, 345]},
        {"name": "arm_b_lower",
         "poly": [[198, 470], [306, 470], [300, 560], [290, 668], [162, 668], [178, 560]],
         "hidden": [box(206, 478, 290, 512)], "pivot": [245, 490]},
        {"name": "hand_b", "poly": box(140, 640, 252, 785),
         "hidden": [box(170, 642, 240, 668)], "pivot": [205, 655]},
        {"name": "leg_b_thigh", "poly": box(306, 600, 414, 884), "exclude_parts": ["robe"],
         "hidden": [box(310, 600, 410, 884)], "caps": [circle(*KNEE_B, 34)], "pivot": [365, 630]},
        {"name": "leg_b_shin",
         "poly": [[296, 868], [398, 868], [398, 1060], [428, 1090], [428, 1150], [288, 1150]],
         "exclude_parts": ["robe"],
         "hidden": [box(312, 850, 390, 910)], "caps": [circle(*KNEE_B, 34)], "pivot": list(KNEE_B)},
        {"name": "leg_f_thigh", "poly": box(432, 600, 548, 892), "exclude_parts": ["robe"],
         "hidden": [box(440, 600, 545, 892)], "caps": [circle(*KNEE_F, 34)], "pivot": [470, 630]},
        {"name": "leg_f_shin",
         "poly": [[440, 876], [548, 876], [548, 1060], [628, 1082], [628, 1130], [440, 1130]],
         "exclude_parts": ["robe"],
         "hidden": [box(456, 860, 536, 915)], "caps": [circle(*KNEE_F, 34)], "pivot": list(KNEE_F)},
        {"name": "robe",
         "poly": [[276, 556], [578, 556], [596, 934], [278, 934], [250, 790], [250, 670]],
         "exclude_parts": ["arm_b_lower", "hand_b", "arm_f_lower", "hand_f"],
         "hidden": [box(292, 545, 560, 592)], "pivot": [430, 580]},
        {"name": "torso",
         "poly": [[188, 66], [352, 66], [352, 250], [382, 254], [530, 254], [548, 300], [552, 380], [546, 470], [558, 540], [580, 604],
                  [284, 604], [298, 522], [304, 332], [250, 336], [188, 252]],
         "exclude_parts": ["head"],
         "hidden": [box(380, 255, 520, 330), box(296, 545, 566, 610)], "hidden_fill": "copy", "pivot": [430, 580]},
        {"name": "head",
         "poly": [[336, 28], [530, 28], [550, 140], [540, 262], [474, 278], [398, 278], [378, 250], [336, 210]],
         "hidden": [box(400, 250, 490, 288)], "hidden_fill": "copy", "pivot": [440, 262]},
        {"name": "arm_f_upper",
         "poly": [[500, 292], [560, 298], [592, 368], [620, 446], [632, 500], [566, 522], [550, 470], [538, 410], [520, 350]],
         "hidden": [box(512, 330, 556, 470)], "hidden_fill": "copy", "pivot": [528, 345]},
        {"name": "arm_f_lower",
         "poly": [[558, 468], [636, 466], [702, 598], [702, 668], [594, 668], [574, 560]],
         "hidden": [box(570, 478, 640, 512)], "hidden_fill": "copy", "pivot": [595, 485]},
        # the bow, drawn by code (tools/draw_sword.py bow), upright in the near hand; the
        # string is drawn by the client, which pulls it to the drawing hand
        {"name": "bow", "image": "bow.png", "grip": [360, 92], "angle": -90, "pivot": [684, 706]},
        {"name": "hand_f", "poly": box(632, 640, 730, 775),
         "hidden": [box(640, 642, 700, 668)], "hidden_fill": "copy", "pivot": [660, 655]},
    ],
}

if __name__ == "__main__":
    with open(os.path.join(HERE, "split.json"), "w", encoding="utf8") as f:
        json.dump(SPEC, f, indent=1)
