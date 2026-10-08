import { Assets, type Texture } from 'pixi.js';
import { sliceAtlas, type TaoAsset } from './tao/TaoActor';
import type { TaoSkeleton } from './tao/types';

// The pose sprites exported by tools/pack_sprites.py: one painting per pose, all facing right,
// each with its anchor (the feet, or the back when lying) and its world units per pixel. And the
// skeletons from tools/pack_tao.py, for the bodies that are rigged (the hero).

export interface SpriteInfo {
  w: number;
  h: number;
  ax: number;
  ay: number;
  scale: number;
}

export interface Pose {
  tex: Texture;
  info: SpriteInfo;
}

export type SpriteSet = ReadonlyMap<string, Pose>;

const BASE = 'art/sprites/';

/** Loads every sprite in the index, or returns null so the views fall back to ink blocks. */
export async function loadSprites(): Promise<SpriteSet | null> {
  try {
    const res = await fetch(`${BASE}index.json`);
    if (!res.ok) return null;
    const index = (await res.json()) as Record<string, SpriteInfo>;
    const names = Object.keys(index);
    const texs = await Promise.all(names.map((n) => Assets.load<Texture>(`${BASE}${n}.png`)));
    return new Map(names.map((n, i) => [n, { tex: texs[i], info: index[n] }]));
  } catch {
    return null;
  }
}

/** Loads a skeleton exported by tools/pack_tao.py (skeleton.json + atlas.png), or null. */
export async function loadRig(dir: string): Promise<TaoAsset | null> {
  try {
    const res = await fetch(`art/${dir}/skeleton.json`);
    if (!res.ok) return null;
    const skeleton = (await res.json()) as TaoSkeleton;
    return sliceAtlas(skeleton, await Assets.load<Texture>(`art/${dir}/atlas.png`));
  } catch {
    return null;
  }
}
