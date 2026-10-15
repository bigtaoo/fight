import type { Grade, Rating } from '@dnf/engine';
import type { BagStore } from '../platform/store';

// The player's progress on this device: per dungeon, how often it was cleared, the best grade and
// the best time. Kept in the same store as the bag (localStorage now, the platform's save data
// later); nothing in it is worth anything, so the device is trusted with it.

const KEY = 'dnf.progress';
const RANK: Record<Grade, number> = { S: 3, A: 2, B: 1, C: 0 };

export interface Best {
  clears: number;
  grade: Grade;
  /** Ticks of the fastest clear. */
  ticks: number;
}

export class Progress {
  private readonly bests: Record<string, Best>;

  constructor(private readonly store: BagStore) {
    this.bests = parse(store.get(KEY));
  }

  get(dungeon: string): Best | null {
    return this.bests[dungeon] ?? null;
  }

  cleared(dungeon: string): boolean {
    return (this.bests[dungeon]?.clears ?? 0) > 0;
  }

  /** Records a clear; whether it set a new best grade or time (never on the first clear). */
  record(dungeon: string, r: Rating): { grade: boolean; time: boolean } {
    const old = this.bests[dungeon];
    const grade = !!old && RANK[r.grade] > RANK[old.grade];
    const time = !!old && r.ticks < old.ticks;
    this.bests[dungeon] = old
      ? { clears: old.clears + 1, grade: grade ? r.grade : old.grade, ticks: Math.min(old.ticks, r.ticks) }
      : { clears: 1, grade: r.grade, ticks: r.ticks };
    this.store.set(KEY, JSON.stringify(this.bests));
    return { grade, time };
  }
}

function parse(raw: string | null): Record<string, Best> {
  try {
    const v: unknown = JSON.parse(raw ?? '{}');
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, Best> = {};
    for (const [k, b] of Object.entries(v as Record<string, Partial<Best>>)) {
      if (b && typeof b.clears === 'number' && b.grade && b.grade in RANK && typeof b.ticks === 'number') out[k] = { clears: b.clears, grade: b.grade, ticks: b.ticks };
    }
    return out;
  } catch {
    return {};
  }
}
