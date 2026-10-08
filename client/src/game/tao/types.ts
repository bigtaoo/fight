// The .tao skeleton format (skeleton.json), written by tools/pack_tao.py.
// A .tao file is a zip of skeleton.json + atlas.png; the game loads the two files loose.
// Units are atlas pixels, y down, rotations in degrees clockwise.

export type Easing = 'linear' | 'step' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface TaoBone {
  id: string;
  /** null only for "root"; parents are always listed before their children. */
  parent: string | null;
  /** Pivot position relative to the parent's pivot, in the rest pose. */
  x: number;
  y: number;
}

/** One image drawn on a bone. Slots are listed back to front. */
export interface TaoSlot {
  id: string;
  bone: string;
  image: string;
  /** Top-left of the image relative to the bone's pivot. */
  x: number;
  y: number;
}

export interface TaoFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TaoKey {
  t: number;
  /** rotate: [deg]; translate: [x, y]; scale: [sx, sy]. */
  v: number[];
  /** Easing from this key to the next one; linear when absent. */
  e?: Easing;
}

export interface TaoBoneTracks {
  rotate?: TaoKey[];
  translate?: TaoKey[];
  scale?: TaoKey[];
}

export interface TaoAnimation {
  duration: number;
  loop: boolean;
  bones: Record<string, TaoBoneTracks>;
}

export interface TaoSkeleton {
  version: 1;
  name: string;
  /** Height of the rest pose above the origin (the feet), for scaling to world size. */
  height: number;
  bones: TaoBone[];
  slots: TaoSlot[];
  /** Atlas frames by image name. */
  images: Record<string, TaoFrame>;
  /** Images a slot can swap between, by slot id (the first is the default). */
  variants: Record<string, string[]>;
  animations: Record<string, TaoAnimation>;
}

/** A bone's animated offset from the rest pose. */
export interface BonePose {
  rotate: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
}
