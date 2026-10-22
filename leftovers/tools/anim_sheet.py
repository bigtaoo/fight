"""Render clips of an exported skeleton as contact sheets, to check animation without the game.
usage: python -I tools/anim_sheet.py <runtime dir> <out.png> [clip[:frames] ...]

Reads skeleton.json + atlas.png as pack_tao.py wrote them and samples each clip the way the
client does (client/src/game/tao/sample.ts and pose.ts): keys eased per segment, unkeyed
bones at rest, a bone placed at its rest offset plus its translation and then rotated and
scaled about its own pivot. One row per clip, frames evenly spread over the clip, the ground
line and the origin marked so foot slide shows.
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw


def ease(e, f):
    if e == "step":
        return 0
    if e == "ease-in":
        return f * f
    if e == "ease-out":
        return f * (2 - f)
    if e == "ease-in-out":
        return 2 * f * f if f < 0.5 else 1 - 2 * (1 - f) * (1 - f)
    return f


def sample(keys, t):
    if t <= keys[0]["t"] or len(keys) == 1:
        return keys[0]["v"]
    if t >= keys[-1]["t"]:
        return keys[-1]["v"]
    i = 0
    while keys[i + 1]["t"] <= t:
        i += 1
    a, b = keys[i], keys[i + 1]
    f = ease(a.get("e"), (t - a["t"]) / (b["t"] - a["t"]))
    return [x + (y - x) * f for x, y in zip(a["v"], b["v"])]


def world(sk, anim, t):
    out = {}
    for bone in sk["bones"]:
        tr = (anim or {}).get("bones", {}).get(bone["id"], {}) if anim else {}
        r = math.radians(sample(tr["rotate"], t)[0]) if "rotate" in tr else 0
        tx, ty = sample(tr["translate"], t) if "translate" in tr else (0, 0)
        sx, sy = sample(tr["scale"], t) if "scale" in tr else (1, 1)
        c, s = math.cos(r), math.sin(r)
        local = np.array([[c * sx, -s * sy, bone["x"] + tx], [s * sx, c * sy, bone["y"] + ty], [0, 0, 1]])
        par = out.get(bone["parent"]) if bone["parent"] else None
        out[bone["id"]] = par @ local if par is not None else local
    return out


def render(sk, atlas, anim, t, size, origin, paper_rgb=(0.95, 0.93, 0.88)):
    w = world(sk, anim, t)
    canvas = np.zeros((size[1], size[0], 4), np.float32)
    shift = np.array([[1, 0, origin[0]], [0, 1, origin[1]], [0, 0, 1]])
    for slot in sk["slots"]:
        f = sk["images"][slot["image"]]
        img = atlas[f["y"]:f["y"] + f["h"], f["x"]:f["x"] + f["w"]]
        m = shift @ w[slot["bone"]] @ np.array([[1, 0, slot["x"]], [0, 1, slot["y"]], [0, 0, 1]])
        layer = cv2.warpAffine(img, m[:2], size, flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0)).astype(np.float32) / 255
        a = layer[..., 3:4]
        canvas[..., :3] = layer[..., :3] * a + canvas[..., :3] * (1 - a)
        canvas[..., 3:4] = a + canvas[..., 3:4] * (1 - a)
    paper = np.empty_like(canvas[..., :3])
    paper[:] = paper_rgb
    return (canvas[..., :3] + paper * (1 - canvas[..., 3:4])) * 255


def main(rt, out, clips):
    sk = json.load(open(os.path.join(rt, "skeleton.json")))
    atlas = np.array(Image.open(os.path.join(rt, "atlas.png")).convert("RGBA"))
    h = sk["height"]
    cell = (round(h * 1.5), round(h * 1.35))
    origin = (round(cell[0] * 0.42), round(h * 1.15))
    rows = []
    for spec in clips or list(sk["animations"]):
        name, _, n = spec.partition(":")
        n = int(n or 8)
        anim = sk["animations"][name]
        frames = []
        for i in range(n):
            t = anim["duration"] * i / (n - 1 if not anim["loop"] else n)
            im = Image.fromarray(render(sk, atlas, anim, t, cell, origin).astype(np.uint8))
            d = ImageDraw.Draw(im)
            d.line([(0, origin[1]), (cell[0], origin[1])], fill=(150, 140, 120), width=1)
            d.line([(origin[0], origin[1] - 6), (origin[0], origin[1] + 6)], fill=(200, 40, 30), width=2)
            d.text((4, 4), f"{name} {t * 30:.1f}t", fill=(200, 40, 30))
            frames.append(np.array(im))
        rows.append(np.hstack(frames))
    width = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 0), (0, width - r.shape[1]), (0, 0)), constant_values=255) for r in rows]
    Image.fromarray(np.vstack(rows)).save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
