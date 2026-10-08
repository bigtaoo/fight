// Seeded random numbers: standing's full-period LCG with the MurmurHash3 finalizer on seed and
// output. Unlike standing the streams are plain numbers inside the state rather than objects,
// so the whole state is plain data and a rollback snapshot is a deep copy (snapshot.ts).
// Each concern gets its own stream, so adding draws in one system does not shift the numbers
// another system sees.

export interface Rng {
  /** Monster decisions. */
  ai: number;
  /** Damage rolls. */
  combat: number;
}

export function seedRng(seed: number): Rng {
  return {
    ai: mix32((seed ^ 0xa1a1a1a1) >>> 0) || 1,
    combat: mix32((seed ^ 0x5eed1234) >>> 0) || 1,
  };
}

/** Integer in [0, max), advancing stream `k`. */
export function randInt(rng: Rng, k: keyof Rng, max: number): number {
  const next = (Math.imul(1664525, rng[k]) + 1013904223) >>> 0;
  rng[k] = next;
  return mix32(next) % max;
}

/** Integer in [lo, hi]. */
export function randRange(rng: Rng, k: keyof Rng, lo: number, hi: number): number {
  return lo + randInt(rng, k, hi - lo + 1);
}

/** MurmurHash3's 32-bit finalizer: a bijection on uint32 with full avalanche. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
