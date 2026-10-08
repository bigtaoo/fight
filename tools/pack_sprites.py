"""Cut out the pose paintings and export them as game sprites with their anchors.
usage: python -I tools/pack_sprites.py <manifest.json> <out dir>

The manifest maps a sprite name to its source painting (relative to the manifest):
  { "hero_idle": { "src": "hero_idle.jpg", "h": 240, "flip": false, "ax": 0.5 } }
- h: height of the figure's solid body in world units (1 unit = 1 logical pixel at 1080p);
  set per pose by eye, since FLUX paints every pose at its own scale.
- flip: mirror a painting that came out facing left (every sprite faces right).
- erase: optional list of [x0, y0, x1, y1] boxes (shares of the painting) painted over with the
  paper colour first, for a seal stamp or a stray splash FLUX added anyway.
- clean: on by default; false keeps the loose splashes and washes around the figure. Painted
  specks move, flip and rotate with the body and read as dirt, so they are dropped and the
  client throws live ink drops instead (client/src/game/fx.ts).
- ax: optional anchor x as a share of the body's width; by default the ink's centre of mass,
  which sits near the hips and ignores the thin blade and the scarf.
The anchor y is always the bottom of the solid body: the feet, or the back when lying down.

Writes <name>.png at SCALE pixels per world unit and index.json with, per sprite, its size and
anchor in pixels and the world units per pixel.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ink_cutout import ink_cutout  # noqa: E402

SCALE = 1.5  # sprite pixels per world unit: sharp up to a 1.5x canvas


def anchor(im, ax):
    a = np.asarray(im.getchannel("A"), dtype=np.float32) / 255
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32) / 255
    solid = a > 0.8
    rows = np.flatnonzero(solid.any(axis=1))
    cols = np.flatnonzero(solid.any(axis=0))
    top, bottom = rows[0], rows[-1] + 1
    left, right = cols[0], cols[-1] + 1
    if ax is not None:
        x = left + ax * (right - left)
    else:
        red = (rgb[..., 0] - rgb[..., 1:].max(axis=2)) > 0.25
        w = (solid & ~red).astype(np.float32)
        x = (w.sum(axis=0) * np.arange(w.shape[1])).sum() / w.sum()
    return x, top, bottom


def clean(im, keep_share=0.03, grow_share=0.006):
    """Keep only the big connected ink masses (body, blade, scarf) plus a thin soft rim, so the
    dry-brush edge survives but detached specks and mist do not."""
    rgba = np.asarray(im).copy()
    a = rgba[..., 3].astype(np.float32) / 255
    core = a > 0.5
    labels, n = ndimage.label(core)
    if not n:
        return im
    sizes = ndimage.sum(core, labels, range(1, n + 1))
    keep = np.isin(labels, 1 + np.flatnonzero(sizes >= sizes.max() * keep_share))
    grow = max(2, round(im.height * grow_share))
    keep = ndimage.binary_dilation(keep, iterations=grow)
    soft = np.asarray(Image.fromarray(keep.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(grow / 2)),
                      dtype=np.float32) / 255
    rgba[..., 3] = (a * soft * 255 + 0.5).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    return out.crop(out.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox())


def erase(im, boxes):
    a = np.asarray(im).copy()
    h, w, _ = a.shape
    m = max(2, round(min(h, w) * 0.02))
    paper = np.median(np.concatenate([a[:m].reshape(-1, 3), a[-m:].reshape(-1, 3)]), axis=0)
    for x0, y0, x1, y1 in boxes:
        a[round(y0 * h):round(y1 * h), round(x0 * w):round(x1 * w)] = paper
    return Image.fromarray(a)


def main(manifest_path, out_dir):
    base = os.path.dirname(os.path.abspath(manifest_path))
    with open(manifest_path, encoding="utf8") as f:
        manifest = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    index = {}
    for name, spec in manifest.items():
        src = Image.open(os.path.join(base, spec["src"])).convert("RGB")
        if spec.get("erase"):
            src = erase(src, spec["erase"])
        im = ink_cutout(src)
        if spec.get("clean", True):
            im = clean(im)
        if spec.get("flip"):
            im = ImageOps.mirror(im)
        x, top, bottom = anchor(im, spec.get("ax"))
        k = spec["h"] * SCALE / (bottom - top)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        im.save(os.path.join(out_dir, f"{name}.png"), optimize=True)
        index[name] = {"w": im.width, "h": im.height, "ax": round(x * k, 1), "ay": round(bottom * k, 1), "scale": 1 / SCALE}
        print(f"{name}: {im.width}x{im.height} anchor ({x * k:.0f}, {bottom * k:.0f})")
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf8") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
