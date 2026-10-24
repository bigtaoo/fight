import { MeshoptSimplifier } from 'meshoptimizer';
import { AnimationClip, Bone, BufferAttribute, BufferGeometry, Matrix4, Skeleton, Vector3, type Object3D, type SkinnedMesh } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { ClipId, Model } from './actor';

// Cheaper bodies cut from a full model: fewer triangles (meshoptimizer) and fewer or more bones.
// The budget bench (budget.ts) measured what each role may cost; proto.ts builds its bodies here.

/** Resolves once the simplifier can run. */
export const lodReady = MeshoptSimplifier.ready;

export interface Variant {
  tris: number;
  /** 'lean' folds the twist and toe bones away (23 left); a number adds that many sway bones. */
  bones: 'lean' | number;
}

/** The 41-bone skeleton less its twist and toe bones (the neck's twist bones carry the head, so stay). */
const LEAN = (name: string) => (/Twist/.test(name) && !/^Neck/.test(name)) || /ToeBase/.test(name);

export function meshOf(root: Object3D): SkinnedMesh {
  let m: SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) m = o as SkinnedMesh;
  });
  return m!;
}

/** `geo` cut down to about `tris` triangles, its unused vertices dropped. */
function decimate(geo: BufferGeometry, tris: number): BufferGeometry {
  const src = geo.index!.array;
  const index = new Uint32Array(src.length);
  index.set(src);
  if (tris * 3 >= index.length) return geo.clone();
  const pos = geo.attributes.position.array as Float32Array;
  let cut: Uint32Array;
  try {
    [cut] = MeshoptSimplifier.simplify(index, pos, 3, tris * 3, 0.2, ['Permissive']);
  } catch {
    // no WebAssembly to run it on (the WeChat mini-game): the full body
    return geo.clone();
  }
  const remap = new Int32Array(geo.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of cut) if (remap[i] < 0) remap[i] = n++;
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as BufferAttribute;
    const k = a.itemSize;
    const arr = new (a.array.constructor as new (n: number) => typeof a.array)(n * k);
    for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) for (let j = 0; j < k; j++) arr[remap[i] * k + j] = a.array[i * k + j];
    out.setAttribute(name, new BufferAttribute(arr, k, a.normalized));
  }
  const idx = new Uint32Array(cut.length);
  for (let i = 0; i < cut.length; i++) idx[i] = remap[cut[i]];
  out.setIndex(new BufferAttribute(n < 65536 ? Uint16Array.from(idx) : idx, 1));
  return out;
}

/** Chains of three bones hung off these, round the body: hair, the robe's panels, sleeves, tassels. */
const HANGS = ['Head', 'Pelvis', 'Pelvis', 'Pelvis', 'Pelvis', 'L_Forearm', 'R_Forearm', 'Head', 'Spine02', 'Spine02', 'L_Hand', 'R_Hand'];

export function variant(base: Model, v: Variant): Model {
  const scene = SkeletonUtils.clone(base.scene);
  const mesh = meshOf(scene);
  const geo = decimate(mesh.geometry, v.tris);
  let bones = mesh.skeleton.bones.slice();
  const inverses = mesh.skeleton.boneInverses.map((m) => m.clone());
  if (v.bones === 'lean') {
    // every influence of a dropped bone goes to its nearest kept ancestor
    const keep = bones.map((b) => !LEAN(b.name));
    const to = bones.map((b, i) => {
      let o: Object3D | null = b;
      while (o && !keep[bones.indexOf(o as Bone)]) o = o.parent;
      return keep[i] ? i : bones.indexOf(o as Bone);
    });
    const fresh: number[] = [];
    let n = 0;
    for (let i = 0; i < bones.length; i++) fresh[i] = keep[i] ? n++ : -1;
    const si = geo.attributes.skinIndex;
    for (let i = 0; i < si.array.length; i++) si.array[i] = fresh[to[si.array[i]]];
    for (let i = 0; i < bones.length; i++) if (!keep[i]) bones[i].removeFromParent();
    bones = bones.filter((_, i) => keep[i]);
    inverses.splice(0, inverses.length, ...inverses.filter((_, i) => keep[i]));
  } else if (v.bones > 0) {
    scene.updateMatrixWorld(true);
    const byName = new Map(bones.map((b) => [b.name, b]));
    for (let c = 0; bones.length < mesh.skeleton.bones.length + v.bones; c++) {
      let parent: Bone = byName.get(HANGS[c % HANGS.length])!;
      for (let k = 0; k < 3 && bones.length < mesh.skeleton.bones.length + v.bones; k++) {
        const b = new Bone();
        b.name = `Sway${c}_${k}`;
        b.userData.sway = c * 1.7 + k;
        b.position.set(0, k === 0 ? 0 : -0.06 / parent.getWorldScale(new Vector3()).y, 0);
        parent.add(b);
        b.updateMatrixWorld(true);
        bones.push(b);
        inverses.push(new Matrix4().copy(b.matrixWorld).invert());
        parent = b;
      }
    }
  }
  mesh.geometry = geo;
  mesh.bind(new Skeleton(bones, inverses), mesh.bindMatrix);
  const names = new Set(bones.map((b) => b.name));
  const kept = (c: AnimationClip) => new AnimationClip(c.name, c.duration, c.tracks.filter((t) => names.has(t.name.split('.')[0])));
  const clips = {} as Record<ClipId, AnimationClip>;
  for (const [id, c] of Object.entries(base.clips) as [ClipId, AnimationClip][]) clips[id] = kept(c);
  const moves = base.moves && Object.fromEntries(Object.entries(base.moves).map(([id, c]) => [id, kept(c)]));
  const kinds = base.kinds && Object.fromEntries(Object.entries(base.kinds).map(([k, set]) => [k, Object.fromEntries(Object.entries(set).map(([id, c]) => [id, kept(c)]))]));
  return { scene, height: base.height, map: base.map, clips, ...(moves && { moves }), ...(kinds && { kinds }) };
}
