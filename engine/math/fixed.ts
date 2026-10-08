// Fixed-point numbers for the simulation, after standing (and daydayup) engine/math/fixed.ts.
//
// Every number stored in the sim state is an integer: positions and speeds in FP units
// (1 world unit = FP integers), times in ticks. Doubles hold integers exactly up to 2^53 and
// +, -, * and / are exactly specified by IEEE 754, so integer maths with an explicit trunc
// after each division gives the same bits on every JS engine. Transcendental functions do
// not, which is why the sim never calls Math.sin/cos/atan2/hypot/exp (see trig.ts and
// determinismLint.test.ts). hash.ts refuses to serialise a state holding a non-integer.

/** Simulation steps per second. */
export const TICK_RATE = 30;
/** Integer units per world unit (1 world unit = 1 logical pixel at 1080p): 0.001 unit precision. */
export const FP = 1000;

/** World units to FP, for configuration constants only (rounded once, at load). */
export function toFp(units: number): number {
  return Math.round(units * FP);
}

/** World units per second to FP per tick, for configuration constants. */
export function perTick(unitsPerSecond: number): number {
  return Math.round((unitsPerSecond * FP) / TICK_RATE);
}

/** Seconds to whole ticks, for configuration constants. */
export function ticks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}

/** a * b / d, truncated toward zero. */
export function muldiv(a: number, b: number, d: number): number {
  return Math.trunc((a * b) / d);
}

/**
 * floor(sqrt(n)) for a non-negative safe integer. Math.sqrt only gives the first guess; the
 * two corrections make the result exact whatever the engine's last bit, so it is
 * deterministic (and much faster than a bit-by-bit root over a whole horde).
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Integer distance between two points, floor of the true length. */
export function dist(dx: number, dy: number): number {
  return isqrt(dx * dx + dy * dy);
}

/** Squared distance, for comparisons against a squared radius. */
export function dist2(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

/** FP to world units. Render side only: the result is a float. */
export function fromFp(v: number): number {
  return v / FP;
}
