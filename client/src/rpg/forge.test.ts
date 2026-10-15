import { describe, expect, it } from 'vitest';
import type { BagStore } from '../platform/store';
import { Character } from './character';
import { buy, cashIn, enhance, enhanceCost, failure, plainPieces, salvageValue, sellValue } from './forge';
import { MAX_PLUS, enhancedMain, gearStats, makeGear, type Gear } from './gear';
import { runGold } from './rewards';
import { Engine, LocalInputSource, runConfig } from '@dnf/engine';

// Enhancing, salvaging, selling and the shop.

const memory = (): BagStore => {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};
const always = (n: number) => 0 * n;
const never = (n: number) => n - 1;

function rich(): { ch: Character; g: Gear } {
  const ch = new Character(memory());
  ch.gold = 1e7;
  ch.stones = 1e5;
  const g = makeGear(ch.newId(), 'weapon', 10, 1, always);
  ch.give([g]);
  return { ch, g };
}

describe('enhancing', () => {
  it('adds to the main stat, more the higher it goes', () => {
    const g = makeGear(1, 'weapon', 10, 0, always);
    let last = enhancedMain(g);
    for (let p = 1; p <= MAX_PLUS; p++) {
      const next = enhancedMain({ ...g, plus: p });
      expect(next).toBeGreaterThan(last);
      last = next;
    }
    expect(gearStats({ ...g, plus: 10 }).atk).toBe(enhancedMain({ ...g, plus: 10 }));
  });

  it('pays its cost; +1 to +3 never fail', () => {
    const { ch, g } = rich();
    const gold = ch.gold;
    for (let i = 0; i < 3; i++) expect(enhance(ch, g, false, never)).toBe('up');
    expect(g.plus).toBe(3);
    expect(ch.gold).toBeLessThan(gold);
  });

  it('a failure drops one level from +4, three from +8, and breaks from +11 unless protected', () => {
    expect(failure(5)).toEqual({ drop: 1 });
    expect(failure(8)).toEqual({ drop: 3 });
    expect(failure(11)).toBe('break');
    const { ch, g } = rich();
    g.plus = 5;
    expect(enhance(ch, g, false, never)).toBe('down');
    expect(g.plus).toBe(4);
    g.plus = 9;
    expect(enhance(ch, g, false, never)).toBe('down');
    expect(g.plus).toBe(6);
    g.plus = 12;
    ch.tickets = 1;
    expect(enhance(ch, g, true, never)).toBe('kept');
    expect(g.plus).toBe(10);
    expect(ch.tickets).toBe(0);
    g.plus = 12;
    expect(enhance(ch, g, true, never)).toBe('broke');
    expect(ch.bag).toEqual([]);
  });

  it('a worn piece can break too', () => {
    const { ch, g } = rich();
    ch.wear(g.id);
    g.plus = 11;
    expect(enhance(ch, g, false, never)).toBe('broke');
    expect(ch.worn.weapon).toBeUndefined();
  });

  it('refuses when poor or at the top, and costs more further up', () => {
    const ch = new Character(memory());
    const g = makeGear(ch.newId(), 'body', 5, 0, always);
    ch.give([g]);
    expect(enhance(ch, g, false, always)).toBe('poor');
    expect(g.plus).toBe(0);
    expect(enhance(ch, { ...g, plus: MAX_PLUS }, false, always)).toBe('max');
    expect(enhanceCost({ ...g, plus: 12 }).gold).toBeGreaterThan(enhanceCost(g).gold);
    expect(enhanceCost({ ...g, plus: 12 }).rate).toBeLessThan(enhanceCost(g).rate);
  });
});

describe('salvage, sell, shop', () => {
  it('salvaging gives stones, selling gold, rarer for more; the plain ones go all at once', () => {
    const ch = new Character(memory());
    const items = [0, 1, 2, 4].map((r) => makeGear(ch.newId(), 'head', 5, r, always));
    ch.give(items);
    expect(salvageValue(items[3])).toBeGreaterThan(salvageValue(items[0]));
    expect(sellValue(items[3])).toBeGreaterThan(sellValue(items[0]));
    const plain = plainPieces(ch);
    expect(plain).toEqual([items[0].id, items[1].id]);
    expect(cashIn(ch, plain, 'salvage')).toBe(salvageValue(items[0]) + salvageValue(items[1]));
    expect(ch.stones).toBe(salvageValue(items[0]) + salvageValue(items[1]));
    expect(cashIn(ch, [items[3].id], 'sell')).toBe(sellValue(items[3]));
    expect(ch.gold).toBe(sellValue(items[3]));
    expect(ch.bag).toEqual([items[2]]);
  });

  it('buys with gold and keeps the purse in the save', () => {
    const m = memory();
    const ch = new Character(m);
    expect(buy(ch, 'ticket')).toBe(false);
    ch.gold = 1000;
    expect(buy(ch, 'stone10')).toBe(true);
    expect(ch.stones).toBe(10);
    expect(ch.gold).toBe(250);
    const back = new Character(m);
    expect([back.gold, back.stones, back.tickets]).toEqual([250, 10, 0]);
  });

  it('a run pays gold for its kills, and more for a clear', () => {
    const s = new Engine(runConfig({ seed: 1, dungeon: 'heifeng' }), new LocalInputSource()).state;
    const lost = runGold({ ...s, outcome: 'failed', kills: { bandit: 4 } });
    expect(lost).toBe(20);
    expect(runGold({ ...s, outcome: 'cleared', kills: { bandit: 4 } })).toBeGreaterThan(lost + 100);
  });
});
