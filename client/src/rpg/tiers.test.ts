import { describe, expect, it } from 'vitest';
import { Engine, LocalInputSource, runConfig, type Rating, type SimState } from '@dnf/engine';
import { Progress } from '../game/progress';
import type { BagStore } from '../platform/store';
import { MAX_LEVEL } from './gear';
import { DUNGEON_LOOT, TIER_REWARD, runGear, runXp } from './rewards';
import { openTier, progressKey, showsTiers, tierLock, warriorLevel } from './tiers';

// Difficulty tiers: what opens them, where their progress goes, and what they pay.

const memory = (): BagStore => {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

function ended(tier: number, kills: SimState['kills'] = { bandit: 3 }): SimState {
  const s = new Engine(runConfig({ seed: 1, dungeon: 'heifeng', tier }), new LocalInputSource()).state;
  return { ...s, outcome: 'cleared', kills };
}

const grade = (g: 'S' | 'B'): Rating => ({ grade: g, ticks: 3000, maxCombo: 10, hitsTaken: 0 });

describe('tiers', () => {
  it('open one after another: a clear, then a clear and the level, then an S', () => {
    const p = new Progress(memory());
    const lv = warriorLevel('heifeng');
    expect(tierLock('heifeng', 0, p, 1)).toBeNull();
    expect(tierLock('heifeng', 1, p, 1)).toEqual({ key: 'tier.needClear', tier: 0 });
    expect(showsTiers('heifeng', p)).toBe(false);
    p.record('heifeng', grade('B'));
    expect(showsTiers('heifeng', p)).toBe(true);
    expect(showsTiers('hall', p)).toBe(true);
    expect(tierLock('heifeng', 1, p, 1)).toBeNull();
    expect(tierLock('heifeng', 2, p, lv)).toEqual({ key: 'tier.needClear', tier: 1 });
    p.record(progressKey('heifeng', 1), grade('B'));
    expect(tierLock('heifeng', 2, p, lv - 1)).toEqual({ key: 'tier.needLevel', n: lv });
    expect(tierLock('heifeng', 2, p, lv)).toBeNull();
    expect(tierLock('heifeng', 3, p, MAX_LEVEL)).toEqual({ key: 'tier.needS' });
    p.record(progressKey('heifeng', 2), grade('B'));
    expect(tierLock('heifeng', 3, p, MAX_LEVEL)).toEqual({ key: 'tier.needS' });
    p.record(progressKey('heifeng', 2), grade('S'));
    expect(tierLock('heifeng', 3, p, MAX_LEVEL)).toBeNull();
    // the chief's practice hall opens what the fort opens; the training ground has none
    expect(tierLock('hall', 3, p, MAX_LEVEL)).toBeNull();
    expect(tierLock('training', 1, p, MAX_LEVEL)).not.toBeNull();
  });

  it('a run takes the highest open tier at most the one picked', () => {
    const p = new Progress(memory());
    expect(openTier('heifeng', 3, p, MAX_LEVEL)).toBe(0);
    p.record('heifeng', grade('B'));
    expect(openTier('heifeng', 3, p, 1)).toBe(1);
    expect(openTier('heifeng', 0, p, 1)).toBe(0);
    expect(openTier('heifeng', 99, p, 1)).toBe(1);
  });

  it('keeps each tier\'s progress apart, the normal tier where saves had it', () => {
    expect(progressKey('heifeng', 0)).toBe('heifeng');
    expect(progressKey('heifeng', 2)).toBe('heifeng:2');
  });

  it('pays more experience and better, higher gear on the harder tiers', () => {
    const base = runXp(ended(0));
    expect(runXp(ended(1))).toBe(Math.floor((base * TIER_REWARD[1].pct) / 100));
    expect(runXp(ended(3))).toBe(Math.floor((base * TIER_REWARD[3].pct) / 100));
    let id = 0;
    // every draw 0: the lowest level, the first rarity, every drop and every bump
    const always = () => 0;
    const normal = runGear(ended(0), () => ++id, always);
    const king = runGear(ended(3), () => ++id, always);
    expect(king).toHaveLength(normal.length);
    const lv = DUNGEON_LOOT.heifeng!.lv;
    expect(normal.every((g) => g.lv === lv - 1 && g.rarity === 0)).toBe(true);
    expect(king.every((g) => g.lv === lv - 1 + TIER_REWARD[3].gearLv && g.rarity === 3)).toBe(true);
  });
});
