import type { Character } from './character';
import { MAX_PLUS, type Gear, type Rand } from './gear';

// The blacksmith and the shop: enhancing a piece (+1 .. +15, DNF's way: a failure drops levels
// from +4 on, and from +11 on breaks the piece unless a protection ticket is spent), salvaging
// gear for enhancement stones, selling it for gold, and buying stones and tickets. Drawn on the
// device like the loot; numbers are a first draft (design/CONTENT.md).

/** Chance in percent of going from +p to +p+1. */
const RATE = [100, 100, 100, 90, 80, 70, 60, 50, 42, 35, 30, 25, 20, 15, 10] as const;

/** Enhancement stones for going from +p to +p+1. */
const STONES = [1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 10, 12, 15, 18] as const;

/** What a failure from +p does: nothing (the first three never fail), lose levels, or break. */
export type Failure = { drop: number } | 'break';

export function failure(plus: number): Failure {
  if (plus < 7) return { drop: 1 };
  if (plus < 10) return { drop: 3 };
  return 'break';
}

/** The level a protection ticket leaves a piece at when it would have broken. */
export const PROTECTED_PLUS = 10;

/** What going one level up costs, and its chance. */
export function enhanceCost(g: Gear): { gold: number; stones: number; rate: number } {
  const stones = STONES[g.plus];
  return { gold: stones * (30 + 5 * g.lv), stones, rate: RATE[g.plus] };
}

export type EnhanceResult = 'up' | 'down' | 'kept' | 'broke' | 'poor' | 'max';

/** Tries to enhance `g` (worn or in the bag), paying the cost; `protect`: spend a ticket instead
 * of letting it break. Saves the character. */
export function enhance(ch: Character, g: Gear, protect: boolean, rand: Rand): EnhanceResult {
  if (g.plus >= MAX_PLUS) return 'max';
  const cost = enhanceCost(g);
  if (ch.gold < cost.gold || ch.stones < cost.stones) return 'poor';
  ch.gold -= cost.gold;
  ch.stones -= cost.stones;
  let r: EnhanceResult;
  if (rand(100) < cost.rate) {
    g.plus++;
    r = 'up';
  } else {
    const f = failure(g.plus);
    if (f !== 'break') {
      g.plus = Math.max(0, g.plus - f.drop);
      r = 'down';
    } else if (protect && ch.tickets > 0) {
      ch.tickets--;
      g.plus = PROTECTED_PLUS;
      r = 'kept';
    } else {
      ch.remove(g.id);
      r = 'broke';
    }
  }
  ch.save();
  return r;
}

/** Stones from salvaging a piece, by rarity, and a little more for its level. */
export function salvageValue(g: Gear): number {
  return [1, 2, 4, 8, 16][g.rarity] + Math.floor(g.lv / 10);
}

/** Gold from selling a piece, by rarity and level, and back some of what enhancing it cost. */
export function sellValue(g: Gear): number {
  return Math.floor(([10, 25, 60, 150, 400][g.rarity] * (10 + g.lv)) / 10) + 20 * g.plus * g.plus;
}

/** Salvages (stones) or sells (gold) pieces in the bag; what they gave. Saves the character. */
export function cashIn(ch: Character, ids: readonly number[], how: 'salvage' | 'sell'): number {
  let got = 0;
  for (const id of ids) {
    const g = ch.bag.find((x) => x.id === id);
    if (!g || !ch.discard(id)) continue;
    got += how === 'salvage' ? salvageValue(g) : sellValue(g);
  }
  if (how === 'salvage') ch.stones += got;
  else ch.gold += got;
  ch.save();
  return got;
}

/** The bag's plain pieces (white and blue, never enhanced): what salvaging all at once takes. */
export function plainPieces(ch: Character): number[] {
  return ch.bag.filter((g) => g.rarity <= 1 && g.plus === 0).map((g) => g.id);
}

/** The shop's goods. */
export const GOODS = [
  { id: 'stone', stones: 1, price: 80 },
  { id: 'stone10', stones: 10, price: 750 },
  { id: 'ticket', tickets: 1, price: 2500 },
] as const;
export type GoodId = (typeof GOODS)[number]['id'];

/** Buys one of `id`; false when the gold is short. Saves the character. */
export function buy(ch: Character, id: GoodId): boolean {
  const good = GOODS.find((x) => x.id === id)!;
  if (ch.gold < good.price) return false;
  ch.gold -= good.price;
  if ('stones' in good) ch.stones += good.stones;
  if ('tickets' in good) ch.tickets += good.tickets;
  ch.save();
  return true;
}
