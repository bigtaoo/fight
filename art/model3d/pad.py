# Pads the texture islands of a rigged model's pictures: every texel no triangle's UVs cover takes
# the colour of the nearest covered one. Tripo packs hundreds of small islands edge to edge with
# nothing between them, so once the body is small on screen the mipmaps blend an island with its
# neighbours (red cloth with black trousers) and the seams show as specks and dark fringes.
#
#   python art/model3d/pad.py art/model3d/sword/rig_v1.glb [...]     # rewrites each file in place
#
# Run it once per export: a second run finds nothing left to pad but re-encodes the JPEG.
import io, json, struct, sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
DTYPES = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _version, _length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, f'{path}: not a GLB'
    jlen, _ = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20 + jlen])
    blen, _ = struct.unpack_from('<II', data, 20 + jlen)
    return gltf, data[28 + jlen:28 + jlen + blen]


def write_glb(path, gltf, views):
    """Writes `gltf` with its one buffer packed from `views` (the bytes of each buffer view)."""
    blob = bytearray()
    for view, raw in zip(gltf['bufferViews'], views):
        blob += b'\0' * (-len(blob) % 4)
        view['byteOffset'] = len(blob)
        view['byteLength'] = len(raw)
        blob += raw
    blob += b'\0' * (-len(blob) % 4)
    gltf['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(path, 'wb').write(out)


def accessor(gltf, views, i):
    a = gltf['accessors'][i]
    v = gltf['bufferViews'][a['bufferView']]
    dt = np.dtype(DTYPES[a['componentType']])
    n = COMPONENTS[a['type']]
    raw = views[a['bufferView']]
    stride = v.get('byteStride') or dt.itemsize * n
    rows = np.ndarray((a['count'], n), dtype=dt, buffer=raw, offset=a.get('byteOffset', 0), strides=(stride, dt.itemsize))
    return rows.astype(np.float64 if a['componentType'] == 5126 else np.int64)


def pad(path):
    gltf, bin_ = read_glb(path)
    views = [bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in gltf['bufferViews']]
    # the triangles' UVs for each picture
    uvs = {}
    for mesh in gltf.get('meshes', []):
        for p in mesh['primitives']:
            mat = gltf['materials'][p['material']] if 'material' in p else {}
            tex = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if tex is None or 'TEXCOORD_0' not in p['attributes']:
                continue
            img = gltf['textures'][tex['index']]['source']
            uv = accessor(gltf, views, p['attributes']['TEXCOORD_0'])
            tri = accessor(gltf, views, p['indices'])[:, 0].reshape(-1, 3) if 'indices' in p else np.arange(len(uv)).reshape(-1, 3)
            uvs.setdefault(img, []).append(uv[tri])
    for img, tris in uvs.items():
        im = gltf['images'][img]
        pic = Image.open(io.BytesIO(views[im['bufferView']])).convert('RGB')
        w, h = pic.size
        mask = Image.new('L', (w, h))
        draw = ImageDraw.Draw(mask)
        for t in np.concatenate(tris):
            # UV (0,0) is the picture's top left in glTF; wrap UVs that stray past 1
            pts = [((u % 1.0) * w, (v % 1.0) * h) for u, v in t] if (t.min() < 0 or t.max() > 1) else [(u * w, v * h) for u, v in t]
            draw.polygon(pts, fill=255, outline=255)
        covered = np.asarray(mask) > 0
        rgb = np.asarray(pic).copy()
        _, (iy, ix) = ndimage.distance_transform_edt(~covered, return_indices=True)
        rgb = rgb[iy, ix]
        buf = io.BytesIO()
        Image.fromarray(rgb).save(buf, 'JPEG', quality=92)
        views[im['bufferView']] = buf.getvalue()
        im['mimeType'] = 'image/jpeg'
        print(f'{path}: picture {img} {w}x{h}, {100 * covered.mean():.0f}% covered, padded')
    write_glb(path, gltf, views)


if __name__ == '__main__':
    for f in sys.argv[1:]:
        pad(f)
