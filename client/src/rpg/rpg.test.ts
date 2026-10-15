import { describe, expect, it } from 'vitest';
import { BASE_HERO, Engine, LocalInputSource, MAX_CDR, runConfig, type SimState } from '@dnf/engine';
import type { BagStore } from '../platform/store';
import { BAG_SIZE, Character, levelStats, xpToNext } from './character';
import { RARITIES, SLOTS, makeGear, mainValue, type Gear } from './gear';
import { runGear, runXp, settleRun } from './rewards';

// The single-player character: levels, gear and what it adds, the bag, the save, and what a run
// earns.

const memory = (): BagStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

/** A sequence of draws, round and round; past its end, 0s. */
const seq = (...xs: number[]) => {
  let i = 0;
  return (n: number) => (xs.length ? xs[i++ % xs.length] % n : 0);
};

function ended(dungeon: 'heifeng' | 'hall' | 'trial', outcome: SimState['outcome'], kills: SimState['kills']): SimState {
  const s = new Engine(runConfig({ seed: 1, dungeon }), new LocalInputSource()).state;
  return { ...s, outcome, kills };
}

describe('character', () => {
  it('level 1 with nothing worn is the engine hero as it was, plus a little crit', () => {
    const c = new Character(memory());
    const h = c.heroStats();
    expect({ ...h, crit: 0 }).toEqual(BASE_HERO);
    expect(h.crit).toBeGreaterThan(0);
  });

  it('experience levels up, several at once, and stops at the top', () => {
    const c = new Character(memory());
    expect(c.gainXp(xpToNext(1) - 1)).toBe(0);
    expect(c.gainXp(1 + xpToNext(2) + xpToNext(3))).toBe(3);
    expect(c.level).toBe(4);
    expect(c.xp).toBe(0);
    c.gainXp(1e9);
    expect(c.level).toBe(40);
    expect(c.xp).toBe(0);
    expect(levelStats(40).atk).toBeGreaterThan(levelStats(1).atk);
  });

  it('wearing swaps with what is worn, needs the level, and adds the stats', () => {
    const c = new Character(memory());
    const sword = makeGear(c.newId(), 'weapon', 1, 0, seq());
    const better = makeGear(c.newId(), 'weapon', 1, 1, seq());
    const high = makeGear(c.newId(), 'head', 5, 0, seq());
    c.give([sword, better, high]);
    expect(c.wear(sword.id)).toBe(true);
    expect(c.stats().atk).toBe(levelStats(1).atk + sword.main);
    expect(c.wear(better.id)).toBe(true);
    expect(c.worn.weapon).toBe(better);
    expect(c.bag.map((g) => g.id)).toEqual([sword.id, high.id]);
    expect(c.wear(high.id)).toBe(false);
    expect(c.takeOff('weapon')).toBe(true);
    expect(c.stats()).toEqual(levelStats(1));
  });

  it('cooldown reduction and crit reach the engine capped', () => {
    const c = new Character(memory());
    const g: Gear = { id: 1, slot: 'trinket', rarity: 4, lv: 1, main: 200, extra: [['cdr', 90]], plus: 0 };
    c.give([g]);
    c.wear(1);
    expect(c.heroStats().crit).toBe(100);
    expect(c.heroStats().cdr).toBe(MAX_CDR);
  });

  it('the bag holds BAG_SIZE; the rest is given back', () => {
    const c = new Character(memory());
    const many = Array.from({ length: BAG_SIZE + 3 }, () => makeGear(c.newId(), 'shoes', 1, 0, seq()));
    expect(c.give(many)).toHaveLength(3);
    expect(c.bag).toHaveLength(BAG_SIZE);
    expect(c.takeOff('shoes')).toBe(false);
  });

  it('is saved and read back; a broken or foreign save reads as a fresh character', () => {
    const m = memory();
    const c = new Character(m);
    c.gainXp(xpToNext(1) + 5);
    const g = makeGear(c.newId(), 'body', 1, 3, seq(1, 2, 3, 4));
    c.give([g, makeGear(c.newId(), 'belt', 2, 0, seq())]);
    c.wear(g.id);
    c.save();
    const back = new Character(m);
    expect(back.level).toBe(2);
    expect(back.xp).toBe(5);
    expect(back.worn.body).toEqual(g);
    expect(back.bag).toHaveLength(1);
    expect(back.newId()).toBeGreaterThan(g.id + 1);
    for (const raw of ['{', '[]', '{"v":99,"level":30}', '{"v":1,"level":"x","bag":[{"id":1}]}']) {
      const m2 = memory();
      m2.set('dnf.char', raw);
      const f = new Character(m2);
      expect(f.level).toBe(1);
      expect(f.bag).toEqual([]);
    }
  });
});

describe('gear', () => {
  it('rarer is stronger; purple and up carry one extra stat per step, never the same twice', () => {
    for (const slot of SLOTS) {
      for (let r = 1; r < RARITIES; r++) expect(mainValue(slot, 10, r)).toBeGreaterThanOrEqual(mainValue(slot, 10, r - 1));
      expect(mainValue(slot, 20, 0)).toBeGreaterThanOrEqual(mainValue(slot, 1, 0));
    }
    expect(makeGear(1, 'weapon', 5, 1, seq(3)).extra).toEqual([]);
    for (let r = 2; r < RARITIES; r++) {
      const g = makeGear(1, 'weapon', 5, r, seq(0, 7, 0, 7, 0, 7));
      expect(g.extra).toHaveLength(r - 1);
      expect(new Set(g.extra.map((e) => e[0])).size).toBe(r - 1);
    }
  });
});

describe('rewards', () => {
  it('kills give experience even in a lost run; a clear adds the rating share; practice none', () => {
    const lost = runXp(ended('heifeng', 'failed', { bandit: 2 }));
    expect(lost).toBe(40);
    expect(runXp(ended('heifeng', 'cleared', { bandit: 2 }))).toBeGreaterThan(lost + 200);
    const c = new Character(memory());
    expect(settleRun(ended('hall', 'cleared', { chief: 1 }), c, seq())).toBeNull();
    expect(settleRun(ended('heifeng', 'playing', { bandit: 1 }), c, seq())).toBeNull();
  });

  it('only a clear drops gear: per kill by chance, then the rating draws, all near the dungeon level', () => {
    let id = 1;
    const newId = () => id++;
    expect(runGear(ended('heifeng', 'failed', { bandit: 9 }), newId, seq())).toEqual([]);
    // every chance comes up (0 < pct): two kills, and a clear's draws
    const g = runGear(ended('heifeng', 'cleared', { bandit: 2, elite: 1 }), newId, seq());
    expect(g.length).toBeGreaterThanOrEqual(4);
    for (const x of g) expect(Math.abs(x.lv - 3)).toBeLessThanOrEqual(1);
    expect(new Set(g.map((x) => x.id)).size).toBe(g.length);
  });

  it('settling a run gives it to the character and saves', () => {
    const m = memory();
    const c = new Character(m);
    const r = settleRun(ended('heifeng', 'cleared', { bandit: 7, archer: 6, shield: 2, chief: 1 }), c, seq(5))!;
    expect(r.xp).toBeGreaterThan(xpToNext(1));
    expect(r.levels).toBeGreaterThan(0);
    expect(c.bag).toEqual(r.gear);
    expect(new Character(m).level).toBe(c.level);
  });
});
