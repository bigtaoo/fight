import { describe, expect, it } from 'vitest';
import type { Rating } from '@dnf/engine';
import type { BagStore } from '../platform/store';
import { Progress } from './progress';

// The device's progress: clears counted per dungeon, the best grade and the best time kept apart
// (a slow S and a fast B make S at the fast time), a new best told only when one is beaten, and
// what is saved read back by the next visit.

const memory = (): BagStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};
const run = (grade: Rating['grade'], ticks: number): Rating => ({ grade, ticks, maxCombo: 0, hitsTaken: 0 });

describe('progress', () => {
  it('keeps the best grade and the best time per dungeon', () => {
    const p = new Progress(memory());
    expect(p.cleared('heifeng')).toBe(false);
    expect(p.record('heifeng', run('B', 3000))).toEqual({ grade: false, time: false });
    expect(p.record('heifeng', run('S', 4000))).toEqual({ grade: true, time: false });
    expect(p.record('heifeng', run('C', 2500))).toEqual({ grade: false, time: true });
    expect(p.get('heifeng')).toEqual({ clears: 3, grade: 'S', ticks: 2500 });
    expect(p.cleared('heifeng')).toBe(true);
    expect(p.get('hall')).toBeNull();
  });

  it('is read back on the next visit, and survives a broken save', () => {
    const store = memory();
    new Progress(store).record('hall', run('A', 900));
    expect(new Progress(store).get('hall')).toEqual({ clears: 1, grade: 'A', ticks: 900 });
    store.set('dnf.progress', '{not json');
    expect(new Progress(store).get('hall')).toBeNull();
    store.set('dnf.progress', JSON.stringify({ hall: { clears: 1, grade: 'Z', ticks: 5 }, heifeng: { clears: 2, grade: 'B', ticks: 7 } }));
    const p = new Progress(store);
    expect(p.get('hall')).toBeNull();
    expect(p.get('heifeng')).toEqual({ clears: 2, grade: 'B', ticks: 7 });
  });
});
