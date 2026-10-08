import type { SimState } from './state';

// State hashing (from standing's engine/hash.ts), for the checkpoints the client reports to the
// server's verifier and for the golden replay test. Walks the state in a fixed field order and
// folds every number into a 32-bit FNV-1a. The config is skipped: a tampered client is caught
// by the state it produces, not by what it claims to run. A non-integer anywhere in the state
// is a bug (the sim is integer-only) and throws, so tests catch a float creeping in.

const SKIP = new Set(['config']);

export function hashState(s: SimState): number {
  let h = 0x811c9dc5;
  const num = (v: number, path: string) => {
    if (!Number.isSafeInteger(v)) throw new Error(`non-integer in sim state at ${path}: ${v}`);
    // two 32-bit halves, so values past 2^32 are folded in whole
    const lo = v >>> 0;
    const hi = Math.floor(v / 4294967296) >>> 0;
    h = Math.imul(h ^ lo, 0x01000193);
    h = Math.imul(h ^ hi, 0x01000193);
  };
  const str = (v: string) => {
    for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 0x01000193);
  };
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') return num(v, path);
    if (typeof v === 'boolean') return num(v ? 1 : 0, path);
    if (typeof v === 'string') return str(v);
    if (v === null || v === undefined) return num(-1, path);
    if (Array.isArray(v)) {
      num(v.length, path);
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v).sort()) {
        if (SKIP.has(k)) continue;
        str(k);
        walk((v as Record<string, unknown>)[k], `${path}.${k}`);
      }
    }
  };
  walk(s, 'state');
  return h >>> 0;
}
