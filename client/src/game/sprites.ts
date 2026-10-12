import { Assets, Rectangle, Texture } from 'pixi.js';
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
    // The atlas is drawn at about a third of its size; without mipmaps its thin pale lines
    // alias into flickering specks.
    const atlas = await Assets.load<Texture>({ src: `art/${dir}/atlas.png`, data: { autoGenerateMipmaps: true } });
    return sliceAtlas(skeleton, atlas);
  } catch {
    return null;
  }
}

/** A body pre-rendered from 3D as frames per clip (art/archer3d/blender/pack.py): each frame's
 * texture and the top-left of its trimmed rect from the feet, in source pixels. */
export interface FrameSet {
  /** World units per source pixel. */
  scale: number;
  clips: Record<string, { tex: Texture; ox: number; oy: number }[]>;
}

/** Loads a frame set (frames.json + atlas.png under art/<dir>/), or null. */
export async function loadFrames(dir: string): Promise<FrameSet | null> {
  try {
    const res = await fetch(`art/${dir}/frames.json`);
    if (!res.ok) return null;
    const meta = (await res.json()) as { scale: number; clips: Record<string, number[][]> };
    const atlas = await Assets.load<Texture>({ src: `art/${dir}/atlas.png`, data: { autoGenerateMipmaps: true } });
    const clips: FrameSet['clips'] = {};
    for (const [name, rects] of Object.entries(meta.clips)) {
      clips[name] = rects.map(([x, y, w, h, ox, oy]) => ({
        tex: new Texture({ source: atlas.source, frame: new Rectangle(x, y, w, h) }),
        ox,
        oy,
      }));
    }
    return { scale: meta.scale, clips };
  } catch {
    return null;
  }
}
