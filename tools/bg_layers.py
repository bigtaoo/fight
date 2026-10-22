"""Pack the parallax background layers of the scenes into client/public/art/bg/.
usage: python -I tools/bg_layers.py art/bg_m2/layers.json [name prefix...]
(with prefixes, only the layers whose names start with one of them are packed)

Every layer comes out at its in-game size (logical screen 1920x1080) and wraps seamlessly, so
the client only tiles it horizontally. Kinds:
  far     an opaque painting; optional levels lift its blacks ("lo") and pull down its whites
          ("hi"); mirrored onto itself when "mirror" so its two ends meet.
  "wrap"  (far or cut) a share of the cropped width: the image loops on itself instead, its last
          that-much crossfaded into its first, so no mirror image and no seam. Crop its right
          end where the painting is quiet (mist, a gap between houses).
  "parts" (far or cut) in place of "src"/"crop": several {"src", "crop", "erase"} paintings side by
          side, each scaled to the first's height and crossfaded into the next over "join"
          pixels, for a longer strip that repeats less.
  cut     ink cut out of its paper (ink_cutout.ink_layer, or colour-to-alpha alone when "body"
          is false), washes fainter than "minInk" dropped
          and the rest thickened by "gamma" (< 1),
          blacks lifted to "lo", cropped to the ink, faded by "alpha";
          then (unless "wrap") the cut-out and its mirror image side by side, each followed by "gap" (a share
          of its width) of nothing, so foreground pieces stand apart.
  ground  no painting: a wash texture drawn here, periodic in both directions. "paper" and
          "ink" are the two colours it blends, "streaks" the number of long horizontal brush
          marks, "boards" > 0 draws that many floorboard seams instead.
  silk    no painting: the mounting silk along the top of the scroll, periodic sideways. A woven
          "silk" colour with a faint damask of round flowers in "sheen", and along its bottom
          (the side that meets the painting) a "rim" of paper-edge shadow and a thin "line".
  empty   a blank strip, for a scene that has no layer there yet.
All fractions (crop, erase boxes) are of the source image: [x0, y0, x1, y1].
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ink_cutout import ink_layer  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def frac_box(box, w, h):
    x0, y0, x1, y1 = box
    return round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)


def load(spec, base):
    if "parts" in spec:
        rgb = join([load(part, base) for part in spec["parts"]], spec.get("join", 30))
        return looped(rgb, spec)
    im = Image.open(os.path.join(base, spec["src"])).convert("RGB")
    rgb = np.asarray(im, dtype=np.float32) / 255
    h, w, _ = rgb.shape
    # seals and stray marks painted over with the colour beside them
    for box in spec.get("erase", []):
        x0, y0, x1, y1 = frac_box(box, w, h)
        side = rgb[y0:y1, max(0, x0 - w // 20):x0] if x0 > 0 else rgb[y0:y1, x1:x1 + w // 20]
        rgb[y0:y1, x0:x1] = np.median(side.reshape(-1, 3), axis=0)
    if "crop" in spec:
        x0, y0, x1, y1 = frac_box(spec["crop"], w, h)
        rgb = rgb[y0:y1, x0:x1]
    return looped(rgb, spec)


def join(parts, band):
    """Paintings side by side, each scaled to the first's height, crossfaded over `band` pixels."""
    h = parts[0].shape[0]
    out = parts[0]
    t = np.linspace(0, 1, band, dtype=np.float32)[None, :, None]
    for rgb in parts[1:]:
        im = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8))
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        rgb = np.asarray(im, dtype=np.float32) / 255
        seam = (1 - t) * out[:, -band:] + t * rgb[:, :band]
        out = np.concatenate([out[:, :-band], seam, rgb[:, band:]], axis=1)
    return out


def looped(rgb, spec):
    if "wrap" in spec:
        w = rgb.shape[1]
        band = round(spec["wrap"] * w)
        t = np.linspace(0, 1, band, dtype=np.float32)[None, :, None]
        head = (1 - t) * rgb[:, w - band:] + t * rgb[:, :band]
        rgb = np.concatenate([head, rgb[:, band:w - band]], axis=1)
    return rgb


def mirrored(im):
    out = Image.new(im.mode, (im.width * 2, im.height))
    out.paste(im, (0, 0))
    out.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (im.width, 0))
    return out


def far(spec, base):
    rgb = load(spec, base)
    lo = np.array(spec.get("lo", [0, 0, 0]), dtype=np.float32) / 255
    hi = np.array(spec.get("hi", [255, 255, 255]), dtype=np.float32) / 255
    rgb = lo + (hi - lo) * rgb
    im = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8))
    im = im.resize((round(im.width * spec["height"] / im.height), spec["height"]), Image.LANCZOS)
    return mirrored(im) if spec.get("mirror") else im


def ink_only(rgb):
    """Colour-to-alpha against the paper with no solid body: for a painting whose strokes
    enclose bare paper (the gaps between pillars) that must stay see-through."""
    h, w, _ = rgb.shape
    paper = np.maximum(np.percentile(rgb.reshape(-1, 3), 97, axis=0), 1e-3)
    alpha = np.clip((paper - rgb) / paper, 0, 1).max(axis=2)
    safe = np.maximum(alpha, 1e-3)[..., None]
    ink = np.clip(paper - (paper - rgb) / safe, 0, 1)
    return Image.fromarray((np.dstack([ink, alpha]) * 255 + 0.5).astype(np.uint8), "RGBA")


def cut(spec, base):
    rgb = load(spec, base)
    im = ink_layer(rgb) if spec.get("body", True) else ink_only(rgb)
    a = np.asarray(im, dtype=np.float32) / 255
    a[..., 3] = np.clip((a[..., 3] - spec.get("minInk", 0)) / (1 - spec.get("minInk", 0)), 0, 1) ** spec.get("gamma", 1)
    lo = np.array(spec.get("lo", [0, 0, 0]), dtype=np.float32) / 255
    a[..., :3] = lo + (1 - lo) * a[..., :3]
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    if "wrap" in spec:
        box = (0, box[1], im.width, box[3])   # keep the full width, it tiles
    im = im.crop(box)
    im = im.resize((round(im.width * spec["height"] / im.height), spec["height"]), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32)
    a[..., 3] *= spec.get("alpha", 1)
    im = Image.fromarray((a + 0.5).astype(np.uint8), "RGBA")
    if "wrap" in spec:
        return im
    gap = round(im.width * spec.get("gap", 0))
    one = Image.new("RGBA", (im.width + gap, im.height))
    one.paste(im, (0, 0))
    out = Image.new("RGBA", (one.width * 2, im.height))
    out.paste(one, (0, 0))
    flip = im.transpose(Image.FLIP_LEFT_RIGHT)
    out.paste(flip, (one.width, 0))
    return out


def periodic_noise(rng, h, w, scale):
    """Smooth noise that wraps in both directions: white noise low-passed in Fourier space."""
    f = np.fft.fft2(rng.normal(size=(h, w)))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w
    f *= np.exp(-(fx ** 2 + (fy * w / h) ** 2) / (2 * scale ** 2))
    n = np.real(np.fft.ifft2(f))
    return (n - n.mean()) / (n.std() + 1e-9)


def ground(spec, _base):
    w, h = spec["width"], spec["height"]
    rng = np.random.default_rng(spec.get("seed", 1))
    paper = np.array(spec["paper"], dtype=np.float32) / 255
    ink = np.array(spec["ink"], dtype=np.float32) / 255
    # broad washes, a finer mottle, and long horizontal brush marks
    t = 0.5 * periodic_noise(rng, h, w, 3) + 0.3 * periodic_noise(rng, h, w, 9)
    yy = np.arange(h)[:, None].astype(np.float32)
    xx = np.arange(w)[None, :].astype(np.float32)
    marks = np.zeros((h, w), np.float32)
    dry = periodic_noise(rng, h, w, 60)
    for _ in range(spec.get("streaks", 0)):
        y0 = rng.uniform(0, h)
        x0 = rng.uniform(0, w)
        length = rng.uniform(0.1, 0.3) * w
        thick = rng.uniform(1, 3.5)
        dx = (xx - x0) % w
        along = np.clip(dx / length, 0, 1)
        # a dry stroke: tapered at both ends, heavier at its start, broken by the paper grain
        weight = np.sin(np.pi * along) * (1.2 - 0.6 * along) * (dx < length) * (dry > -0.2)
        dy = np.minimum(np.abs(yy - y0), h - np.abs(yy - y0))
        marks = np.maximum(marks, weight * np.exp(-(dy / thick) ** 2) * rng.uniform(0.12, 0.3))
    boards = spec.get("boards", 0)
    if boards:
        for i in range(boards):
            y0 = (i + 0.5) * h / boards + rng.uniform(-4, 4)
            dy = np.minimum(np.abs(yy - y0), h - np.abs(yy - y0))
            wob = 0.6 + 0.4 * periodic_noise(rng, 1, w, 4)[0]
            marks = np.maximum(marks, np.exp(-(dy / 1.6) ** 2) * 0.5 * wob)
    grain = rng.normal(0, 1, (h, w)) * 0.04
    a = np.clip(spec.get("wash", 0.18) * (t + 1) + marks + grain, 0, 1)[..., None]
    rgb = paper * (1 - a) + ink * a
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    return im.filter(ImageFilter.GaussianBlur(0.5))


def silk(spec, _base):
    w, h = spec["width"], spec["height"]
    rng = np.random.default_rng(spec.get("seed", 1))
    col = np.array(spec["silk"], dtype=np.float32) / 255
    sheen = np.array(spec["sheen"], dtype=np.float32) / 255
    # the damask: rows of round flowers (a ring of petals round a dot), every other row offset,
    # drawn 4x and scaled down; `pitch` divides the width, so the pattern wraps
    ss = 4
    pitch = spec.get("pitch", 64)
    pat = Image.new("L", (w * ss, h * ss))
    d = ImageDraw.Draw(pat)
    r = pitch * 0.22 * ss
    rows = max(1, round((h - spec.get("rimH", 10)) / (pitch * 0.6)))
    for j in range(rows):
        cy = (j + 0.5) * (h - spec.get("rimH", 10)) / rows * ss
        for i in range(-1, w // pitch + 1):
            cx = (i + (0.5 if j % 2 else 0)) * pitch * ss
            for k in range(6):
                a = k * np.pi / 3 + j * 0.5
                px, py = cx + np.cos(a) * r * 0.6, cy + np.sin(a) * r * 0.6
                d.ellipse([px - r * 0.36, py - r * 0.36, px + r * 0.36, py + r * 0.36], outline=255, width=ss)
            d.ellipse([cx - r * 0.18, cy - r * 0.18, cx + r * 0.18, cy + r * 0.18], fill=255)
    flower = np.asarray(pat.resize((w, h), Image.LANCZOS), dtype=np.float32) / 255
    # the weave: fine threads both ways and a slow shimmer
    yy = np.arange(h)[:, None].astype(np.float32)
    xx = np.arange(w)[None, :].astype(np.float32)
    weave = 0.5 + 0.25 * np.sin(xx * np.pi) * np.sin(yy * np.pi * 0.5)
    shimmer = periodic_noise(rng, h, w, 4)
    t = np.clip(flower * spec.get("damask", 0.5) + 0.04 * shimmer + 0.06 * (weave - 0.5), 0, 1)[..., None]
    rgb = col * (1 - t) + sheen * t
    rgb *= (1 + rng.normal(0, 0.015, (h, w)))[..., None]
    # the rim where the silk meets the painting: a shadow darkening into a thin line at the edge
    rim = spec.get("rimH", 10)
    edge = np.clip((yy - (h - rim)) / rim, 0, 1) ** 2
    rgb *= (1 - 0.25 * edge)[..., None]
    line = np.array(spec.get("line", [90, 70, 50]), dtype=np.float32) / 255
    rgb[h - 2:] = line
    rgb[h - 4:h - 2] = rgb[h - 4:h - 2] * 0.5 + line * 0.5
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    return im


def empty(_spec, _base):
    return Image.new("RGBA", (64, 8))


def main():
    path = sys.argv[1]
    base = os.path.dirname(os.path.abspath(path))
    with open(path, encoding="utf8") as f:
        cfg = json.load(f)
    out_dir = os.path.join(ROOT, cfg["out"])
    os.makedirs(out_dir, exist_ok=True)
    only = sys.argv[2:]
    for name, spec in cfg["layers"].items():
        if only and not any(name.startswith(p) for p in only):
            continue
        im = {"far": far, "cut": cut, "ground": ground, "silk": silk, "empty": empty}[spec["kind"]](spec, base)
        if im.mode == "RGBA":
            # a 256-colour palette with alpha: a sixth of the size, no visible banding on washes
            file = os.path.join(out_dir, name + ".png")
            im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(file, optimize=True)
        else:
            file = os.path.join(out_dir, name + ".jpg")
            im.save(file, quality=86)
        print(f"{name}: {im.width}x{im.height} {os.path.getsize(file) // 1024}KB")


if __name__ == "__main__":
    main()
