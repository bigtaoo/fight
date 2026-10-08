// Integer angles and trigonometry, after standing's (and daydayup's) engine/math/trig.ts. Angles are brads
// (65536 per turn, counter-clockwise from +x toward +y, which points down on screen). sin and
// cos read a committed integer table and interpolate with integer maths; atan2 uses only
// basic arithmetic and a table. Nothing here calls a transcendental Math function.

import { ATAN_M, ATAN_QUARTER, SIN_N, SIN_QUARTER } from './trigTable';

export const BRAD_FULL = 65536;
export const BRAD_HALF = 32768;
export const BRAD_QUARTER = 16384;
/** sin/cos results are scaled by this. */
export const TRIG_ONE = 1000;
const QUARTER_STEP = BRAD_QUARTER / SIN_N;

export function normBrad(b: number): number {
  return b & (BRAD_FULL - 1);
}

function sinQuarter(x: number): number {
  const idx = Math.floor(x / QUARTER_STEP);
  if (idx >= SIN_N) return SIN_QUARTER[SIN_N];
  const r = x - idx * QUARTER_STEP;
  const a0 = SIN_QUARTER[idx];
  return a0 + Math.trunc(((SIN_QUARTER[idx + 1] - a0) * r) / QUARTER_STEP);
}

/** sin of a brad angle, in [-TRIG_ONE, TRIG_ONE]. */
export function sinB(brad: number): number {
  const b = normBrad(brad);
  const q = Math.floor(b / BRAD_QUARTER);
  const rem = b - q * BRAD_QUARTER;
  // `|| 0` turns -0 into 0, so a hash of the state never sees a negative zero
  if (q === 0) return sinQuarter(rem);
  if (q === 1) return sinQuarter(BRAD_QUARTER - rem);
  if (q === 2) return -sinQuarter(rem) || 0;
  return -sinQuarter(BRAD_QUARTER - rem) || 0;
}

export function cosB(brad: number): number {
  return sinB(brad + BRAD_QUARTER);
}

function atanUnit(lo: number, hi: number): number {
  const num = lo * ATAN_M;
  const idx = Math.floor(num / hi);
  if (idx >= ATAN_M) return ATAN_QUARTER[ATAN_M];
  const rem = num - idx * hi;
  const a0 = ATAN_QUARTER[idx];
  return a0 + Math.trunc(((ATAN_QUARTER[idx + 1] - a0) * rem) / hi);
}

/** The brad angle of the vector (x, y); 0 for the zero vector. */
export function atan2B(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = ay <= ax ? atanUnit(ay, ax) : BRAD_QUARTER - atanUnit(ax, ay);
  if (x >= 0 && y >= 0) return normBrad(a);
  if (x < 0 && y >= 0) return normBrad(BRAD_HALF - a);
  if (x < 0) return normBrad(BRAD_HALF + a);
  return normBrad(BRAD_FULL - a);
}

/** Degrees to brads, for configuration constants. */
export function degToBrad(deg: number): number {
  return normBrad(Math.round((deg / 360) * BRAD_FULL));
}
