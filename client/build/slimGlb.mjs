import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Slims a Tripo .glb for the WeChat package, where the main package is 4 MB and each pack is
// counted too. The ink look only reads the colour map (three/ink.ts), so the normal and ORM maps
// go; the colour map is written next to the .glb and referenced by uri, which also spares the
// runtime the Blob URLs a mini-game does not have. A clip file can keep only its animation.

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function readGlb(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a glb`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  const bin = b.readUInt32LE(binAt + 4) === BIN_CHUNK ? b.subarray(binAt + 8, binAt + 8 + b.readUInt32LE(binAt)) : Buffer.alloc(0);
  return { json, bin };
}

function pad4(n) {
  return (n + 3) & ~3;
}

function writeGlb(path, json, bin) {
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jsLen = pad4(js.length);
  const binLen = pad4(bin.length);
  const out = Buffer.alloc(12 + 8 + jsLen + (bin.length ? 8 + binLen : 0), 0);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsLen, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  js.copy(out, 20);
  out.fill(0x20, 20 + js.length, 20 + jsLen);
  if (bin.length) {
    const at = 20 + jsLen;
    out.writeUInt32LE(binLen, at);
    out.writeUInt32LE(BIN_CHUNK, at + 4);
    bin.copy(out, at + 8);
  }
  writeFileSync(path, out);
}

/**
 * Writes a slim copy of `from` to `to`. With `colorFile`, the mesh stays and its base colour image
 * is written to that file (a name next to `to`); without it, only the animations stay.
 */
export function slimGlb(from, to, colorFile) {
  const { json, bin } = readGlb(from);
  const keepMesh = !!colorFile;
  const views = [];

  if (keepMesh) {
    // the colour textures stay, pointing at images by uri; every other map goes
    const textures = [];
    const images = [];
    const texOf = new Map();
    for (const m of json.materials ?? []) {
      delete m.normalTexture;
      delete m.occlusionTexture;
      delete m.emissiveTexture;
      const pbr = m.pbrMetallicRoughness;
      if (!pbr) continue;
      delete pbr.metallicRoughnessTexture;
      if (!pbr.baseColorTexture) continue;
      const old = pbr.baseColorTexture.index;
      if (!texOf.has(old)) {
        if (images.length) throw new Error(`${from}: more than one colour map`);
        const t = json.textures[old];
        const img = json.images[t.source];
        const v = json.bufferViews[img.bufferView];
        writeFileSync(new URL(colorFile, `file:///${to.replace(/\\/g, '/')}`), bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
        images.push({ uri: colorFile, mimeType: img.mimeType });
        textures.push({ ...t, source: 0 });
        texOf.set(old, textures.length - 1);
      }
      pbr.baseColorTexture.index = texOf.get(old);
    }
    json.textures = textures;
    json.images = images;
    if (!textures.length) delete json.samplers;
  } else {
    for (const n of json.nodes ?? []) {
      delete n.mesh;
      delete n.skin;
    }
    for (const k of ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers']) delete json[k];
  }

  // the accessors still in use, then their buffer views packed into a new binary
  const used = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      Object.values(p.attributes).forEach((a) => used.add(a));
      if (p.indices !== undefined) used.add(p.indices);
      for (const t of p.targets ?? []) Object.values(t).forEach((a) => used.add(a));
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) used.add(s.inverseBindMatrices);
  for (const a of json.animations ?? []) for (const s of a.samplers) used.add(s.input), used.add(s.output);
  const accMap = new Map();
  const accessors = [];
  [...used].sort((a, b) => a - b).forEach((i) => {
    const acc = json.accessors[i];
    if (acc.sparse) throw new Error(`${from}: sparse accessors are not handled`);
    accMap.set(i, accessors.length);
    accessors.push(acc);
  });
  const viewMap = new Map();
  const parts = [];
  let size = 0;
  for (const acc of accessors) {
    if (acc.bufferView === undefined) continue;
    if (!viewMap.has(acc.bufferView)) {
      const v = json.bufferViews[acc.bufferView];
      const bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
      size = pad4(size);
      parts.push({ at: size, bytes });
      viewMap.set(acc.bufferView, views.length);
      views.push({ ...v, buffer: 0, byteOffset: size });
      size += bytes.length;
    }
    acc.bufferView = viewMap.get(acc.bufferView);
  }
  const out = Buffer.alloc(pad4(size), 0);
  for (const p of parts) p.bytes.copy(out, p.at);

  const acc = (i) => accMap.get(i);
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = acc(p.attributes[k]);
      if (p.indices !== undefined) p.indices = acc(p.indices);
      for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = acc(t[k]);
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = acc(s.inverseBindMatrices);
  for (const a of json.animations ?? []) for (const s of a.samplers) (s.input = acc(s.input)), (s.output = acc(s.output));
  json.accessors = accessors;
  json.bufferViews = views;
  json.buffers = [{ byteLength: out.length }];
  writeGlb(to, json, out);
}
