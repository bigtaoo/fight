import type { BonePose, TaoSkeleton } from './types';

// Forward kinematics for .tao skeletons. Pure, so it is tested without Pixi.

/** A 2D affine matrix laid out like Pixi's Matrix: x' = a*x + c*y + tx, y' = b*x + d*y + ty. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export function identity(): Affine {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

export function restPoses(sk: TaoSkeleton): Map<string, BonePose> {
  return new Map(sk.bones.map((b) => [b.id, { rotate: 0, x: 0, y: 0, sx: 1, sy: 1 }]));
}

/**
 * World matrices of every bone. A bone sits at its rest offset from the parent's pivot plus
 * its animated translation, then rotates and scales about its own pivot; children inherit
 * all of it. Bones are processed in file order, which lists parents first.
 */
export function computeWorld(sk: TaoSkeleton, poses: Map<string, BonePose>, out: Map<string, Affine>): void {
  for (const bone of sk.bones) {
    const p = poses.get(bone.id);
    const r = ((p?.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const sx = p?.sx ?? 1;
    const sy = p?.sy ?? 1;
    // local = translate(x, y) * rotate(r) * scale(sx, sy)
    const la = cos * sx;
    const lb = sin * sx;
    const lc = -sin * sy;
    const ld = cos * sy;
    const lx = bone.x + (p?.x ?? 0);
    const ly = bone.y + (p?.y ?? 0);
    let m = out.get(bone.id);
    if (!m) out.set(bone.id, (m = identity()));
    const par = bone.parent ? out.get(bone.parent) : undefined;
    if (!par) {
      m.a = la;
      m.b = lb;
      m.c = lc;
      m.d = ld;
      m.tx = lx;
      m.ty = ly;
      continue;
    }
    m.a = par.a * la + par.c * lb;
    m.b = par.b * la + par.d * lb;
    m.c = par.a * lc + par.c * ld;
    m.d = par.b * lc + par.d * ld;
    m.tx = par.a * lx + par.c * ly + par.tx;
    m.ty = par.b * lx + par.d * ly + par.ty;
  }
}

/** A point given in a bone's space (relative to its pivot) mapped to skeleton space. */
export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

/** A limb from `bone` down to its descendant `tip`, as aimChain() turns it. */
export interface Chain {
  bone: string;
  /** The bone's parent, whose world rotation the aim is relative to. */
  parent: string | null;
  /** The bones between the two, straightened while aimed. */
  bends: string[];
  /** Angle of bone pivot -> tip pivot with the chain straight and unturned, in radians. */
  rest: number;
}

export function chainOf(sk: TaoSkeleton, bone: string, tip: string): Chain {
  const byId = new Map(sk.bones.map((b) => [b.id, b]));
  const bends: string[] = [];
  let dx = 0;
  let dy = 0;
  let b = byId.get(tip);
  while (b && b.id !== bone) {
    dx += b.x;
    dy += b.y;
    if (b.parent && b.parent !== bone) bends.push(b.parent);
    b = b.parent ? byId.get(b.parent) : undefined;
  }
  if (!b) throw new Error(`${sk.name}: ${tip} does not hang from ${bone}`);
  return { bone, parent: b.parent, bends, rest: Math.atan2(dy, dx) };
}

/**
 * Turns a chain so its bone -> tip line points along `angle` (radians, skeleton space, y down),
 * whatever the clip did to it and its parents, and recomputes `world` to match. `weight` below 1
 * mixes back toward the clip's pose, to let go of the aim without a snap.
 */
export function aimChain(sk: TaoSkeleton, poses: Map<string, BonePose>, world: Map<string, Affine>, chain: Chain, angle: number, weight = 1): void {
  for (const id of chain.bends) poses.get(id)!.rotate *= 1 - weight;
  computeWorld(sk, poses, world);
  const par = chain.parent ? world.get(chain.parent)! : identity();
  const pose = poses.get(chain.bone)!;
  const aimed = ((angle - Math.atan2(par.b, par.a) - chain.rest) * 180) / Math.PI;
  // the short way round from the clip's rotation
  const delta = ((((aimed - pose.rotate) % 360) + 540) % 360) - 180;
  pose.rotate += delta * weight;
  computeWorld(sk, poses, world);
}
