"""Split an A-pose ink painting into cutout-animation parts.
usage: python -I tools/split_parts.py <spec.json> <out dir>

Ported from standing's split_parts.py; the figure is cut from the paper with ink_cutout's
colour-to-alpha instead of a flood fill, so dry-brush edges keep their soft alpha.

spec.json:
  {
    "source": "hero_apose.png",           # relative to the spec file
    "pale_keep": 0.3,                     # optional: lightness kept of pale trim inside the figure
    "parts": [                            # listed back to front (the draw order)
      {"name": "arm_f_upper",
       "poly": [[x, y], ...],             # region of the painting that belongs to this part
       "hsv": [[[h, s, v], [h, s, v]], ...],  # optional: keep only pixels in these OpenCV HSV
       "grow": 6,                         #   ranges, grown by this many px into the figure
       "exclude_parts": ["scarf"],        # optional: pixels owned by other parts, removed
       "hidden": [[[x, y], ...], ...],    # optional: areas covered by other parts, filled in
       "caps": [[[x, y], ...], ...],      # optional: like hidden but not clipped to the figure,
                                          #   for joint caps where a pale trim line crosses a limb
       "pivot": [x, y]},                  # joint position in painting pixels
      {"name": "sword", "image": "sword.png",  # a part drawn by code instead of cut out:
       "grip": [x, y], "angle": 35,       #   rotated clockwise about this point of its image
       "pivot": [x, y]}                   #   and placed with that point here
    ]
  }

Hidden areas are filled with the part's own ink colour, so a limb still looks whole where it was
tucked under the robe or the torso once a joint turns. Writes <name>.png per part,
parts.json (size, pivot and offset per part, so the rig can rebuild the rest pose) and
preview.png (the rest pose, and an exploded view that shows the fills, over a checkerboard).
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ink_cutout import ink_layer  # noqa: E402

PAD = 4  # transparent margin around each exported part


def poly_mask(size, polys):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([tuple(v) for v in p], fill=255)
    return np.array(m)


def solid_inside(fg, max_hole=4000, rim=3):
    """Pixels inside the figure that must be opaque: colour-to-alpha turns the painted white
    trim lines and pale dry-brush strokes see-through, which shows the scene through the chest
    once the figure is on a background. Small enclosed holes count as inside; the outer rim
    keeps its soft alpha."""
    m = (fg > 128).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(1 - m, connectivity=4)
    h, w = m.shape
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < max_hole and x > 0 and y > 0 and x + bw < w and y + bh < h:
            m[lab == i] = 1
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    return cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rim + 1,) * 2)) > 0


def mute_pale(rgb, hsv, inside, keep):
    """Pull the pale, unsaturated paint inside the figure (the white trim lines on the collar,
    hems and cuffs) toward the ink, keeping `keep` of its lightness above it. At game size a
    2-3 px white line shrinks below a pixel and flickers as specks; a dark grey one reads as a
    fold. Saturated paint (the red sash and scarf) is left alone."""
    ink = np.median(rgb[inside & (hsv[..., 2] < 40)], axis=0)
    sel = inside & (hsv[..., 1] < 70) & (hsv[..., 2] > 50)
    out = rgb.astype(np.float32)
    out[sel] = ink + (out[sel] - ink) * keep
    return np.clip(out, 0, 255).astype(np.uint8)


def ink_colour(rgb, hsv, mask):
    """The deep ink of a region: the median of its darkest opaque pixels, not of its grey folds."""
    v = hsv[..., 2]
    sel = (mask > 250) & (v <= np.percentile(v[mask > 250], 40))
    return np.median(rgb[sel], axis=0)


def drawn_part(part, size):
    """A part drawn by code (the sword): its image rotated by `angle` degrees about `grip`
    (pixels in that image) and placed so the grip lands on the pivot. Returns RGBA on a canvas
    `size` grown by the returned margin on every side, since a long blade reaches past the
    painting's edges."""
    im = Image.open(part["image_path"]).convert("RGBA")
    margin = max(im.size)
    gx, gy = part["grip"]
    px, py = part["pivot"][0] + margin, part["pivot"][1] + margin
    a = np.radians(part.get("angle", 0))
    c, s = np.cos(a), np.sin(a)
    # forward map: p' = R (p - grip) + pivot, clockwise with y down
    m = np.array([[c, -s, px - c * gx + s * gy], [s, c, py - s * gx - c * gy]])
    big = (size[0] + 2 * margin, size[1] + 2 * margin)
    return cv2.warpAffine(np.array(im), m, big, flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0)), margin


def region_mask(size, hsv, fg, part):
    """Pixels a part claims before other parts are subtracted (uint8, 0 or 255)."""
    m = poly_mask(size, [part["poly"]])
    if "hsv" in part:
        keep = np.zeros_like(m)
        for lo, hi in part["hsv"]:
            keep |= cv2.inRange(hsv, np.array(lo, np.uint8), np.array(hi, np.uint8))
        g = part.get("grow", 0)
        if g:
            # the soft edge of the colour, but no further than the figure
            grown = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1,) * 2))
            keep = np.minimum(grown, (fg > 0).astype(np.uint8) * 255)
        m = np.minimum(m, keep)
    return m


def split(spec_path, out_dir):
    spec = json.load(open(spec_path, encoding="utf-8"))
    src = Image.open(os.path.join(os.path.dirname(os.path.abspath(spec_path)), spec["source"])).convert("RGB")
    layer = np.array(ink_layer(np.asarray(src, dtype=np.float32) / 255))
    rgb, fg = layer[..., :3].copy(), layer[..., 3].copy()
    inside = solid_inside(fg)
    rgb[inside], fg[inside] = np.asarray(src)[inside], 255
    hsv = cv2.cvtColor(np.array(src), cv2.COLOR_RGB2HSV)
    keep = spec.get("pale_keep", 1)
    if keep < 1:
        rgb = mute_pale(rgb, hsv, inside, keep)
    owned = {p["name"]: region_mask(src.size, hsv, fg, p) for p in spec["parts"] if "image" not in p}
    os.makedirs(out_dir, exist_ok=True)
    meta, layers = [], []
    for part in spec["parts"]:
        if "image" in part:
            part["image_path"] = os.path.join(os.path.dirname(os.path.abspath(spec_path)), part["image"])
            drawn, margin = drawn_part(part, src.size)
            im = Image.fromarray(drawn, "RGBA")
            x0, y0, x1, y1 = im.getbbox()
            im = im.crop((x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD))
            x0, y0 = x0 - PAD - margin, y0 - PAD - margin
            im.save(os.path.join(out_dir, part["name"] + ".png"), optimize=True)
            px, py = part["pivot"]
            meta.append({"name": part["name"], "w": im.width, "h": im.height, "x": x0, "y": y0, "pivot": [px, py]})
            layers.append((im, x0, y0, px, py))
            continue
        own = owned[part["name"]]
        for other in part.get("exclude_parts", []):
            own = np.minimum(own, owned[other] ^ 255)
        own = np.minimum(own, fg)
        # hidden areas are covered by other parts at rest, so they never reach past the figure
        hidden = np.minimum(poly_mask(src.size, part.get("hidden", [])), fg)
        hidden = np.maximum(hidden, poly_mask(src.size, part.get("caps", [])))
        alpha = np.maximum(own, hidden)
        out = rgb.copy()
        fill = (hidden > 0) & (own <= 200)
        if fill.any():
            # the figure is a near-black silhouette, so a flat fill of the part's own ink hides
            # better than inpainting, which drags in the light anti-aliased rim and grey fold lines
            out[fill] = ink_colour(rgb, hsv, own if (own > 250).any() else fg)
        im = Image.fromarray(np.dstack([out, alpha]).astype(np.uint8), "RGBA")
        box = im.getbbox()
        if not box:
            raise ValueError(f"part {part['name']} is empty")
        x0, y0, x1, y1 = box
        x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
        x1, y1 = min(src.width, x1 + PAD), min(src.height, y1 + PAD)
        im = im.crop((x0, y0, x1, y1))
        im.save(os.path.join(out_dir, part["name"] + ".png"), optimize=True)
        px, py = part["pivot"]
        meta.append({"name": part["name"], "w": im.width, "h": im.height, "x": x0, "y": y0, "pivot": [px, py]})
        layers.append((im, x0, y0, px, py))
    json.dump({"source": spec["source"], "parts": meta}, open(os.path.join(out_dir, "parts.json"), "w"), indent=1)
    preview(src.size, layers).save(os.path.join(out_dir, "preview.png"))


def preview(size, layers):
    w, h = size
    m = 120  # margin so the exploded view never lands at a negative offset
    board = Image.new("RGBA", (w * 2, h + 2 * m), (255, 255, 255, 255))
    d = ImageDraw.Draw(board)
    for y in range(0, h + 2 * m, 32):
        for x in range(0, w * 2, 32):
            if (x // 32 + y // 32) % 2:
                d.rectangle([x, y, x + 31, y + 31], fill=(210, 210, 210, 255))
    # left: rest pose; right: exploded view so seams and fills are visible
    cx = sum(l[3] for l in layers) / len(layers)
    cy = sum(l[4] for l in layers) / len(layers)
    for im, x0, y0, px, py in layers:
        board.alpha_composite(im, (x0, y0 + m))
        ex, ey = (px - cx) * 0.35, (py - cy) * 0.35
        board.alpha_composite(im, (int(x0 + w + ex), int(y0 + m + ey)))
    for _, _, _, px, py in layers:
        d.ellipse([px - 5, py + m - 5, px + 5, py + m + 5], outline=(255, 0, 0, 255), width=2)
    return board


if __name__ == "__main__":
    split(sys.argv[1], sys.argv[2])
