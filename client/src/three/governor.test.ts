import { afterEach, describe, expect, it } from 'vitest';
import { Governor } from './governor';

const T = 1000 / 30;
const LATE = 50; // one 60 Hz refresh late
const LATE120 = T + 1000 / 120; // one 120 Hz refresh late

function make(levels = 6): { gov: Governor; applied: number[] } {
  const applied: number[] = [];
  const gov = new Governor(T, levels, (l) => applied.push(l));
  return { gov, applied };
}

/** Feeds on-target frames for `seconds`. */
function steady(gov: Governor, seconds: number, ms = T): void {
  for (let t = 0; t < seconds * 1000; t += ms) gov.frame(ms);
}

/** Feeds `n` late frames, `gap` on-target frames apart. */
function misses(gov: Governor, n: number, gap = 5): void {
  for (let i = 0; i < n; i++) {
    gov.frame(LATE);
    if (i < n - 1) for (let k = 0; k < gap; k++) gov.frame(T);
  }
}

/** On-target seconds until the next level change (or Infinity within `max`). */
function secondsUntilChange(gov: Governor, applied: number[], max = 300): number {
  const before = applied.length;
  let t = 0;
  while (applied.length === before) {
    gov.frame(T);
    t += T / 1000;
    if (t > max) return Infinity;
  }
  return t;
}

/** Steps down one level: past the 1 s settle window, then 3 quick misses. */
function stepDown(gov: Governor): void {
  steady(gov, 1.1);
  misses(gov, 3);
}

describe('Governor', () => {
  it('never steps down on steady on-target frames', () => {
    const { gov, applied } = make();
    steady(gov, 120);
    expect(applied).toEqual([]);
    expect(gov.level).toBe(0);
  });

  it('steps down one level on 3 misses within 2 s', () => {
    const { gov, applied } = make();
    stepDown(gov);
    expect(applied).toEqual([1]);
  });

  it('does not step down on 2 misses', () => {
    const { gov, applied } = make();
    steady(gov, 2);
    misses(gov, 2);
    steady(gov, 10);
    expect(applied).toEqual([]);
  });

  it('does not step down on misses 3 s apart', () => {
    const { gov, applied } = make();
    steady(gov, 2);
    for (let i = 0; i < 20; i++) {
      gov.frame(LATE);
      steady(gov, 3);
    }
    expect(applied).toEqual([]);
  });

  it('ignores misses in the first second after a change', () => {
    const { gov, applied } = make();
    for (let i = 0; i < 18; i++) gov.frame(LATE); // 0.9 s, all late
    expect(applied).toEqual([]);
    stepDown(gov);
    expect(applied).toEqual([1]);
    for (let i = 0; i < 18; i++) gov.frame(LATE);
    expect(applied).toEqual([1]);
  });

  it('ignores intervals over 250 ms', () => {
    const { gov, applied } = make();
    steady(gov, 2);
    for (let i = 0; i < 10; i++) gov.frame(300);
    steady(gov, 2);
    expect(applied).toEqual([]);
  });

  it('probes up after 8 clean seconds', () => {
    const { gov, applied } = make();
    stepDown(gov);
    const t = secondsUntilChange(gov, applied);
    expect(applied).toEqual([1, 0]);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(8.1);
  });

  it('doubles the hold on each failed probe, up to 120 s', () => {
    const { gov, applied } = make();
    stepDown(gov);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      waits.push(secondsUntilChange(gov, applied)); // probe up
      stepDown(gov); // the probe fails
    }
    expect(waits.map((w) => Math.round(w))).toEqual([8, 16, 32, 64, 120, 120]);
    expect(applied).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it('keeps a probe that holds, and halves the hold back toward 8', () => {
    const { gov, applied } = make();
    stepDown(gov);
    secondsUntilChange(gov, applied);
    stepDown(gov); // failed probe: hold 16
    expect(Math.round(secondsUntilChange(gov, applied))).toBe(16);
    steady(gov, 60); // the probe holds
    expect(gov.level).toBe(0);
    expect(applied).toEqual([1, 0, 1, 0]);
    stepDown(gov);
    expect(Math.round(secondsUntilChange(gov, applied))).toBe(8);
  });

  it('stays within 0 and levels-1', () => {
    const { gov, applied } = make(3);
    for (let i = 0; i < 20; i++) stepDown(gov);
    expect(gov.level).toBe(2);
    expect(applied).toEqual([1, 2]);
    for (let i = 0; i < 10; i++) steady(gov, 200);
    expect(gov.level).toBe(0);
    expect(Math.min(...applied)).toBe(0);
    expect(Math.max(...applied)).toBe(2);
  });

  it('steps down when a cap sags on a 120 Hz screen', () => {
    const { gov, applied } = make();
    let t = 0;
    while (!applied.length && t < 10_000) {
      gov.frame(T);
      gov.frame(LATE120);
      t += T + LATE120;
    }
    expect(applied).toEqual([1]);
    expect(t).toBeLessThan(3500);
  });

  it('holds on a steady 120 Hz cap and on frames drawn slightly early', () => {
    const { gov, applied } = make();
    steady(gov, 60);
    for (let i = 0; i < 1800; i++) gov.frame(i % 2 ? T - 2 : T + 2);
    expect(applied).toEqual([]);
  });

  it('holds the A16 soak: steady frames with sparse 50 ms hiccups', () => {
    const { gov, applied } = make();
    for (let i = 0; i < 18000; i++) gov.frame(i % 1125 === 600 ? LATE : T);
    expect(applied).toEqual([]);
  });

  it('holds with a short burst of 2 hiccups', () => {
    const { gov, applied } = make();
    steady(gov, 2);
    for (let i = 0; i < 30; i++) {
      misses(gov, 2, 3);
      steady(gov, 2.5);
    }
    expect(applied).toEqual([]);
  });

  describe('with PressureObserver', () => {
    const g = globalThis as { PressureObserver?: unknown };
    afterEach(() => {
      delete g.PressureObserver;
    });

    it('steps down under pressure and does not probe up until it eases', () => {
      let report: (r: { state: string }[]) => void = () => undefined;
      g.PressureObserver = class {
        constructor(cb: (r: { state: string }[]) => void) {
          report = cb;
        }
        observe(): Promise<void> {
          return Promise.resolve();
        }
      };
      const { gov, applied } = make();
      steady(gov, 2);
      report([{ state: 'serious' }]);
      expect(applied).toEqual([1]);
      report([{ state: 'critical' }]); // still hot: no second step
      steady(gov, 60);
      expect(applied).toEqual([1]);
      report([{ state: 'nominal' }]);
      expect(secondsUntilChange(gov, applied)).toBeLessThan(0.1);
      expect(applied).toEqual([1, 0]);
    });
  });
});
