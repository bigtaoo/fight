"""Cut an ink-wash character out of its white paper and export it at in-game size.
usage: python ink_cutout.py <in> <out.png> <height>

standing's cutout.py treats every light, low-saturation pixel connected to the border as
background, which eats the soft grey washes and dry-brush edges ink paintings live on.
Here the alpha comes from two sources, and the larger one wins:
- body: the region the strict paper flood fill cannot reach (the figure and the white
  enclosed by its strokes, e.g. the face) stays fully opaque, so overlapping figures in a
  crowd do not show through each other;
- ink: everywhere else, colour-to-alpha against the paper colour, so washes and splashes
  keep their translucency and stay ink-coloured on any background.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

MIN_ALPHA = 0.04  # paper grain below this is dropped
PAPER_TOL = 0.10  # max channel distance from the paper colour that still counts as paper


def trim_letterbox(rgb, dark=0.12, share=0.98):
    """FLUX sometimes frames the painting with black bars; drop near-black edge rows/columns."""
    black = rgb.max(axis=2) < dark
    rows = black.mean(axis=1) >= share
    cols = black.mean(axis=0) >= share
    top = np.argmin(rows) if rows[0] else 0
    bottom = len(rows) - np.argmin(rows[::-1]) if rows[-1] else len(rows)
    left = np.argmin(cols) if cols[0] else 0
    right = len(cols) - np.argmin(cols[::-1]) if cols[-1] else len(cols)
    rgb = rgb[top:bottom, left:right]
    # the bar fades out through a band of flat grey rows; shave rows that are uniform and darker
    # than paper (uniform paper rows are left alone, they are background anyway)
    def frame_row(row):
        return row.std(axis=0).max() < 0.03 and row.mean() < 0.85
    while len(rgb) > 2 and frame_row(rgb[0]):
        rgb = rgb[1:]
    while len(rgb) > 2 and frame_row(rgb[-1]):
        rgb = rgb[:-1]
    return rgb


def paper_mask(rgb, paper):
    """True where the pixel is paper connected to the image border."""
    near = np.abs(rgb - paper).max(axis=2) <= PAPER_TOL
    labels, _ = ndimage.label(near)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return np.isin(labels, edge[edge > 0])


def fill_painted_holes(solid, rgb, paper, max_paper_share=0.6, min_size_share=0.003):
    """Fill holes enclosed by strokes (a face, a skin tone between outlines), but leave holes of
    bare paper open: the gap between the legs and a ground shadow is not part of the body."""
    holes = ndimage.binary_fill_holes(solid) & ~solid
    labels, n = ndimage.label(holes)
    if not n:
        return solid
    near = np.abs(rgb - paper).max(axis=2) <= PAPER_TOL
    idx = range(1, n + 1)
    size = ndimage.sum(holes, labels, idx)
    paper_share = ndimage.mean(near, labels, idx)
    keep_open = (paper_share > max_paper_share) & (size > solid.sum() * min_size_share)
    return solid | (holes & ~np.isin(labels, 1 + np.flatnonzero(keep_open)))


def paper_colour(rgb):
    """Median colour of the outer 2% frame: the paper the figure was painted on."""
    h, w, _ = rgb.shape
    m = max(2, round(min(h, w) * 0.02))
    frame = np.concatenate([rgb[:m].reshape(-1, 3), rgb[-m:].reshape(-1, 3),
                            rgb[:, :m].reshape(-1, 3), rgb[:, -m:].reshape(-1, 3)])
    return np.median(frame, axis=0)


def ink_cutout(src):
    """src: a file path or a PIL image."""
    im = src if isinstance(src, Image.Image) else Image.open(src)
    rgb = trim_letterbox(np.asarray(im.convert("RGB"), dtype=np.float32) / 255)
    out = ink_layer(rgb)
    box = out.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    return out.crop(box)


def ink_layer(rgb):
    """The cut-out figure at the size of `rgb` (floats 0..1), uncropped, so pixel coordinates
    still match the painting."""
    paper = np.maximum(paper_colour(rgb), 1e-3)

    # ink: how much each channel was darkened from the paper, the strongest channel wins
    darken = np.clip((paper - rgb) / paper, 0, 1)
    a_ink = darken.max(axis=2)

    # body: whatever the border-connected paper cannot reach, minus specks and loose splashes
    # (those stay translucent ink); only the largest components count as the figure
    solid = ~paper_mask(rgb, paper) & (a_ink > 0.35)
    solid = ndimage.binary_closing(solid, iterations=2)
    solid = fill_painted_holes(solid, rgb, paper)
    labels, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, labels, range(1, n + 1))
        solid = np.isin(labels, 1 + np.flatnonzero(sizes >= sizes.max() * 0.05))
    body = np.asarray(Image.fromarray(solid.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.6)),
                      dtype=np.float32) / 255

    alpha = np.maximum(a_ink, body)
    alpha[alpha < MIN_ALPHA] = 0

    # un-premultiply the ink against the paper so a 30% wash is a 30% opaque dark stroke,
    # not an opaque light-grey one; inside the body keep the painted colour as is
    safe = np.maximum(alpha, 1e-3)[..., None]
    ink_rgb = np.clip(paper - (paper - rgb) / safe, 0, 1)
    w = body[..., None]
    out_rgb = w * rgb + (1 - w) * ink_rgb

    out = np.dstack([out_rgb, alpha])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


if __name__ == "__main__":
    src, dst, h = sys.argv[1], sys.argv[2], int(sys.argv[3])
    im = ink_cutout(src)
    im.resize((round(im.width * h / im.height), h), Image.LANCZOS).save(dst, optimize=True)
