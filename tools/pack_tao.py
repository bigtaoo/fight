"""Pack split rig parts and their animations into a .tao skeleton bundle.
usage: python -I tools/pack_tao.py <spec.json> <out.tao> <runtime dir>

Ported from standing. Clips with "unit": "tick" give their times in sim ticks (30 per
second), so an attack's keys line up with its frame data in engine/content.ts.

spec.json (paths relative to the spec file):
  {
    "name": "hero",
    "parts": "parts",                    # split_parts.py output (parts.json + PNGs)
    "rig": "rig.json",                   # {"parent": {"part": "parent" | null}}
    "origin": [x, y],                    # source pixel that becomes (0, 0): between the feet
    "scale": 0.35,                       # source px -> exported px (atlas resolution)
    "variants": {"face": ["face_hurt"]}, # extra images a slot can swap to
    "animations": {
      "run": {"duration": 0.6, "loop": true, "ease": "ease-in-out",
              "keys": [{"t": 0, "rotate": {"torso": -4}, "translate": {"root": [0, -10]},
                        "scale": {"skirt": [1, 0.97]}}, ...]}
    }
  }
Rotations are degrees, clockwise, about the bone's pivot. Translations are source px.

The .tao is a zip of skeleton.json and atlas.png; the runtime dir gets the same two files
loose, because the WeChat runtime reads package files by path and has no zip reader.
Bones are the parts plus a "root" at the origin that every parentless part hangs from.
skeleton.json is documented in client/src/game/tao/types.ts.
"""
import io
import json
import os
import sys
import zipfile

from PIL import Image

PAD = 8  # transparent gap between atlas frames, so linear filtering and mipmaps never bleed
ATLAS_W = 1024
CHANNELS = {"rotate": 1, "translate": 2, "scale": 2}


def rnd(v):
    return round(v, 2)


def pack(images):
    """Shelf-pack images, tallest first. Returns ({name: (x, y)}, atlas size)."""
    order = sorted(images, key=lambda n: -images[n].height)
    pos, x, y, shelf = {}, PAD, PAD, 0
    for n in order:
        w, h = images[n].size
        if x + w + PAD > ATLAS_W:
            x, y, shelf = PAD, y + shelf + PAD, 0
        pos[n] = (x, y)
        x, shelf = x + w + PAD, max(shelf, h)
    height = 1
    while height < y + shelf + PAD:
        height *= 2
    return pos, (ATLAS_W, height)


TICK = 1 / 30


def bake_animation(anim, bones, scale):
    """Turn sparse pose keys into per-bone channel timelines, keys sorted by time."""
    ease = anim.get("ease", "linear")
    unit = TICK if anim.get("unit") == "tick" else 1
    tracks = {}
    for key in sorted(anim["keys"], key=lambda k: k["t"]):
        for channel, size in CHANNELS.items():
            for bone, value in key.get(channel, {}).items():
                if bone not in bones:
                    raise ValueError(f"animation keys unknown bone {bone}")
                v = [value] if size == 1 else list(value)
                if channel == "translate":
                    v = [c * scale for c in v]
                k = {"t": round(key["t"] * unit, 4), "v": [rnd(c) for c in v]}
                if key.get("ease", ease) != "linear":
                    k["e"] = key.get("ease", ease)
                tracks.setdefault(bone, {}).setdefault(channel, []).append(k)
    return {"duration": round(anim["duration"] * unit, 4), "loop": anim.get("loop", False), "bones": tracks}


def build(spec_path):
    base = os.path.dirname(os.path.abspath(spec_path))
    spec = json.load(open(spec_path, encoding="utf-8"))
    parts_dir = os.path.join(base, spec["parts"])
    parts = json.load(open(os.path.join(parts_dir, "parts.json")))["parts"]
    parent = json.load(open(os.path.join(base, spec["rig"])))["parent"]
    s, (ox, oy) = spec["scale"], spec["origin"]
    by_name = {p["name"]: p for p in parts}

    # bones: root first, then every part after its parent
    bones, done = [{"id": "root", "parent": None, "x": 0, "y": 0}], {"root"}
    while len(done) < len(parts) + 1:
        for p in parts:
            par = parent.get(p["name"]) or "root"
            if p["name"] in done or par not in done:
                continue
            px, py = by_name[par]["pivot"] if par != "root" else (ox, oy)
            bones.append({"id": p["name"], "parent": par,
                          "x": rnd((p["pivot"][0] - px) * s), "y": rnd((p["pivot"][1] - py) * s)})
            done.add(p["name"])

    # images at export scale; a variant shares its part's rectangle and offset
    names = [p["name"] for p in parts]
    for slot, extra in spec.get("variants", {}).items():
        names += extra
    images = {}
    for n in names:
        im = Image.open(os.path.join(parts_dir, n + ".png")).convert("RGBA")
        images[n] = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                              Image.LANCZOS)
    pos, size = pack(images)
    atlas = Image.new("RGBA", size, (0, 0, 0, 0))
    for n, (x, y) in pos.items():
        atlas.paste(images[n], (x, y))

    slots = []
    for p in parts:  # parts.json is back to front, which is the draw order
        slots.append({"id": p["name"], "bone": p["name"], "image": p["name"],
                      "x": rnd((p["x"] - p["pivot"][0]) * s), "y": rnd((p["y"] - p["pivot"][1]) * s)})
    skeleton = {
        "version": 1,
        "name": spec["name"],
        "height": rnd((oy - min(p["y"] for p in parts)) * s),
        "bones": bones,
        "slots": slots,
        "images": {n: {"x": x, "y": y, "w": images[n].width, "h": images[n].height}
                   for n, (x, y) in sorted(pos.items())},
        "variants": {k: [k] + v for k, v in spec.get("variants", {}).items()},
        "animations": {k: bake_animation(a, done, s) for k, a in spec["animations"].items()},
    }
    return skeleton, atlas


def main(spec_path, out_tao, runtime_dir):
    skeleton, atlas = build(spec_path)
    text = json.dumps(skeleton, indent=1)
    png = io.BytesIO()
    atlas.save(png, "PNG", optimize=True)
    with zipfile.ZipFile(out_tao, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("skeleton.json", text)
        z.writestr("atlas.png", png.getvalue())
    os.makedirs(runtime_dir, exist_ok=True)
    open(os.path.join(runtime_dir, "skeleton.json"), "w").write(text)
    open(os.path.join(runtime_dir, "atlas.png"), "wb").write(png.getvalue())
    print(f"{len(skeleton['bones'])} bones, {len(skeleton['slots'])} slots, atlas {atlas.size}, "
          f"{len(png.getvalue()) // 1024} KB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
