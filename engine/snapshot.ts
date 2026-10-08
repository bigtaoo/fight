import type { SimState } from './state';

// Snapshots for rollback and reconnects. The state is plain data (numbers, strings, booleans,
// arrays, plain objects; the PRNG streams are numbers too), so a snapshot is a deep copy and
// restoring one is another. Rollback takes one per tick, so this is a hand-written copy rather
// than a JSON round trip.

export function cloneState(s: SimState): SimState {
  return copy(s) as SimState;
}

function copy(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = copy(v[i]);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) out[k] = copy((v as Record<string, unknown>)[k]);
  return out;
}
