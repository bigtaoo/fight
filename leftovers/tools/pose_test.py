"""Pose a split character with forward kinematics to check joints and hidden fills.
usage: python -I tools/pose_test.py <parts dir> <out.png> <rig.json>

rig.json: {"parent": {"part": "parent part" | null, ...},
           "poses": [{"part": degrees, ...}, ...]}   # clockwise, about the part's pivot
Parts are drawn in parts.json order. Each pose becomes one panel on a magenta board, so
gaps between parts and smeared fills stand out.
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image


def local(angle, pivot):
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    px, py = pivot
    return np.array([[c, -s, px - c * px + s * py], [s, c, py - s * px - c * py], [0, 0, 1]])


def render(parts, images, parent, pose, size):
    world = {}

    def get(name):
        if name not in world:
            m = local(pose.get(name, 0), parts[name]["pivot"])
            p = parent.get(name)
            world[name] = get(p) @ m if p else m
        return world[name]

    canvas = np.zeros((size[1], size[0], 4), np.float32)
    for name, meta in parts.items():
        m = get(name) @ np.array([[1, 0, meta["x"]], [0, 1, meta["y"]], [0, 0, 1]])
        layer = cv2.warpAffine(images[name], m[:2], size, flags=cv2.INTER_LINEAR,
                               borderValue=(0, 0, 0, 0)).astype(np.float32) / 255
        a = layer[..., 3:4]
        canvas[..., :3] = layer[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    return canvas


def main(parts_dir, out, rig_path):
    meta = json.load(open(os.path.join(parts_dir, "parts.json")))
    parts = {p["name"]: p for p in meta["parts"]}
    images = {n: np.array(Image.open(os.path.join(parts_dir, n + ".png")).convert("RGBA"))
              for n in parts}
    rig = json.load(open(rig_path))
    xs = [p["x"] for p in parts.values()] + [p["x"] + p["w"] for p in parts.values()]
    ys = [p["y"] for p in parts.values()] + [p["y"] + p["h"] for p in parts.values()]
    m = 80
    x0, y0, x1, y1 = min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m
    shift = {n: dict(p, x=p["x"] - x0, y=p["y"] - y0,
                     pivot=[p["pivot"][0] - x0, p["pivot"][1] - y0]) for n, p in parts.items()}
    size = (x1 - x0, y1 - y0)
    panels = []
    for pose in [{}] + rig["poses"]:
        c = render(shift, images, rig["parent"], pose, size)
        bg = np.zeros_like(c[..., :3]); bg[:] = (1, 0, 1)
        rgb = c[..., :3] + bg * (1 - c[..., 3:4])
        panels.append((rgb * 255).astype(np.uint8))
    Image.fromarray(np.hstack(panels)).save(out)


if __name__ == "__main__":
    main(*sys.argv[1:4])
