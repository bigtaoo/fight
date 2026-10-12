import { describe, expect, it } from 'vitest';
import { CLEAR_LOOT, MONSTER_LOOT, rollLoot, type Rand } from '../src/loot';

// The loot tables: each kill rolls its kind's chance, the clear draws by the rating's tier.

/** A source that always answers `pick(n)`. */
const fixed = (pick: (n: number) => number): Rand => pick;

describe('loot', () => {
  it('rolls every kill against its kind and adds the clear draws of the grade', () => {
    const always = fixed(() => 0);
    const never = fixed((n) => n - 1);
    const kills = { bandit: 3, archer: 1, chief: 1 };
    // every roll under the chance: a drop per kill (the chief has no table of its own)
    expect(rollLoot('heifeng', kills, 'S', always)).toHaveLength(4 + CLEAR_LOOT.heifeng!.S.draws);
    // every roll over it: the clear's draws alone
    expect(rollLoot('heifeng', kills, 'C', never)).toHaveLength(CLEAR_LOOT.heifeng!.C.draws);
    expect(MONSTER_LOOT.elite!.pct).toBe(100);
    expect(rollLoot('heifeng', { elite: 1 }, 'C', never)).toHaveLength(1 + CLEAR_LOOT.heifeng!.C.draws);
  });

  it('a better grade draws from a better table', () => {
    const top = fixed((n) => n - 1);
    const rarity = (g: 'S' | 'A' | 'B' | 'C') => Math.max(...rollLoot('heifeng', {}, g, top).map((i) => i.rarity));
    expect(rarity('S')).toBe(3);
    expect(rarity('A')).toBe(3);
    expect(rollLoot('heifeng', {}, 'S', top)).toHaveLength(2);
    expect(rollLoot('heifeng', {}, 'A', top)).toHaveLength(1);
    const avg = (g: 'S' | 'A' | 'B' | 'C') => {
      let x = 12345;
      const lcg: Rand = (n) => ((x = (x * 1103515245 + 12345) % 2147483648), x % n);
      let sum = 0;
      for (let k = 0; k < 1000; k++) sum += rollLoot('heifeng', {}, g, lcg)[0].rarity;
      return sum / 1000;
    };
    expect(avg('A')).toBeGreaterThan(avg('B'));
    expect(avg('B')).toBeGreaterThan(avg('C'));
  });

  it('a practice dungeon or one without a table draws nothing for the clear', () => {
    expect(rollLoot('hall', {}, 'S', fixed(() => 0))).toEqual([]);
  });
});
