import { describe, expect, it } from 'vitest';
import { BENCH_SHOTS, benchRun, benchTopUp } from './bench';
import { botButtons } from './bot';
import type { Engine } from './Engine';
import type { SimState } from './state';

// M2's performance target, measured in Node on the worst-case scene (12 monsters, 10
// projectiles): one tick under 1 ms, a 20-frame rollback (restore, then 20 steps each followed by
// the snapshot the client keeps) under 8 ms. The target is for Chrome on a mid-range PC (?bench
// measures that); Node on a dev machine is faster still, so these bounds only catch a large
// regression. The numbers are printed for the record.

// (the engine's tsconfig has no DOM or Node types)
declare const performance: { now(): number };
declare const console: { log(...a: unknown[]): void };
const now = () => performance.now();

function tick(e: Engine): void {
  benchTopUp(e.state);
  e.step([{ owner: 0, tick: e.nextTick, buttons: botButtons(e.state, 0) }]);
}

function crowd(s: SimState): number {
  return s.entities.filter((x) => x.team === 1 && x.hp > 0).length;
}

describe('performance', () => {
  it('a tick of the worst case stays under 1 ms, a 20-frame rollback under 8 ms', () => {
    const e = benchRun();
    for (let i = 0; i < 300; i++) tick(e);
    expect(crowd(e.state)).toBe(12);
    expect(e.state.shots.length).toBeGreaterThanOrEqual(BENCH_SHOTS - 2);

    const N = 600;
    let t0 = now();
    for (let i = 0; i < N; i++) tick(e);
    const perTick = (now() - t0) / N;

    const R = 30;
    let worst = 0;
    let total = 0;
    for (let r = 0; r < R; r++) {
      const base = e.snapshot();
      for (let i = 0; i < 20; i++) tick(e);
      t0 = now();
      e.restore(base);
      for (let i = 0; i < 20; i++) {
        tick(e);
        e.snapshot();
      }
      const ms = now() - t0;
      worst = Math.max(worst, ms);
      total += ms;
    }
    console.log(`worst case: ${perTick.toFixed(3)} ms a tick; 20-frame rollback ${(total / R).toFixed(2)} ms (worst ${worst.toFixed(2)} ms)`);
    expect(perTick).toBeLessThan(1);
    expect(total / R).toBeLessThan(8);
  });
});
