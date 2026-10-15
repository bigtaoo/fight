// Gear: six slots, five rarities, a level, a main stat by slot and (purple and up) random extra
// stats. Single player only: drawn on the device (the device's random source, not the engine's)
// and kept in the character's save; online play keeps the server's own items.

/** A random integer in [0, n). */
export type Rand = (n: number) => number;

export const SLOTS = ['weapon', 'head', 'body', 'belt', 'shoes', 'trinket'] as const;
export type Slot = (typeof SLOTS)[number];

/** White, blue, purple, pink, gold. */
export const RARITIES = 5;
export const RARITY_INK = [0x6f6a60, 0x2e5f9a, 0x7a3a9a, 0xc0407a, 0xc88a1e] as const;

/** The stats a character has and gear adds to (see HeroStats in the engine for what they do). */
export const STATS = ['atk', 'hp', 'crit', 'critDmg', 'cdr'] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;

export interface Gear {
  /** Unique within one save. */
  id: number;
  slot: Slot;
  /** 0 white .. 4 gold. */
  rarity: number;
  /** The level it needs, and the one its numbers are drawn for. */
  lv: number;
  /** The slot's main stat (MAIN[slot]). */
  main: number;
  /** Extra stats, purple and up: one per rarity step past blue. */
  extra: [Stat, number][];
  /** Enhancement level, +0 .. +15 (forge.ts). */
  plus: number;
}

/** What each slot gives, and how much per item level (white: the base, rarer: RARITY_PCT of it). */
export const MAIN: Record<Slot, { stat: Stat; base: number; perLv: number }> = {
  weapon: { stat: 'atk', base: 8, perLv: 3 },
  head: { stat: 'hp', base: 40, perLv: 15 },
  body: { stat: 'hp', base: 80, perLv: 30 },
  belt: { stat: 'atk', base: 3, perLv: 1 },
  shoes: { stat: 'hp', base: 40, perLv: 15 },
  trinket: { stat: 'crit', base: 2, perLv: 0.125 },
};
const RARITY_PCT = [100, 125, 150, 180, 220];

/** What enhancing adds to the main stat, in percent of it, at each level (+0 .. +15). */
const PLUS_PCT = [0, 4, 8, 12, 16, 21, 26, 32, 38, 45, 53, 63, 75, 90, 108, 130] as const;
export const MAX_PLUS = PLUS_PCT.length - 1;

/** Extra stats' ranges at item level `lv`. */
const EXTRA: Record<Stat, (lv: number) => [number, number]> = {
  atk: (lv) => [2 + Math.floor(lv / 2), 4 + lv],
  hp: (lv) => [20 + 8 * lv, 40 + 15 * lv],
  crit: () => [1, 3],
  critDmg: () => [5, 15],
  cdr: () => [2, 5],
};

export const MAX_LEVEL = 40;

/** The slot's main stat at `lv` and `rarity`. */
export function mainValue(slot: Slot, lv: number, rarity: number): number {
  const m = MAIN[slot];
  return Math.max(1, Math.floor(((m.base + m.perLv * lv) * RARITY_PCT[rarity]) / 100));
}

/** A new piece of gear. */
export function makeGear(id: number, slot: Slot, lv: number, rarity: number, rand: Rand): Gear {
  const extra: [Stat, number][] = [];
  const pool: Stat[] = [...STATS];
  for (let i = 0; i < rarity - 1; i++) {
    const stat = pool.splice(rand(pool.length), 1)[0];
    const [lo, hi] = EXTRA[stat](lv);
    extra.push([stat, lo + rand(hi - lo + 1)]);
  }
  return { id, slot, rarity, lv, main: mainValue(slot, lv, rarity), extra, plus: 0 };
}

/** The stat a slot's pieces carry first. */
export function mainStat(slot: Slot): Stat {
  return MAIN[slot].stat;
}

/** The main stat with its enhancement. */
export function enhancedMain(g: Gear): number {
  return Math.floor((g.main * (100 + PLUS_PCT[g.plus])) / 100);
}

/** What a piece adds to a character's stats. */
export function gearStats(g: Gear): Partial<Stats> {
  const out: Partial<Stats> = { [MAIN[g.slot].stat]: enhancedMain(g) };
  for (const [s, v] of g.extra) out[s] = (out[s] ?? 0) + v;
  return out;
}

/** Its name's key: the slot and how far up the levels it is (four bands of ten). */
export function gearNameKey(g: Gear): `gear.${Slot}.${0 | 1 | 2 | 3}` {
  return `gear.${g.slot}.${Math.min(3, Math.floor((g.lv - 1) / 10)) as 0 | 1 | 2 | 3}`;
}

/** A saved piece, or null when it is not what we wrote. */
export function parseGear(v: unknown): Gear | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Partial<Gear>;
  const int = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
  if (!int(g.id) || !SLOTS.includes(g.slot as Slot) || !int(g.rarity) || g.rarity < 0 || g.rarity >= RARITIES) return null;
  if (!int(g.lv) || g.lv < 1 || !int(g.main) || !int(g.plus) || g.plus < 0 || g.plus > MAX_PLUS || !Array.isArray(g.extra)) return null;
  if (!g.extra.every((e) => Array.isArray(e) && STATS.includes(e[0]) && int(e[1]))) return null;
  return { id: g.id, slot: g.slot as Slot, rarity: g.rarity, lv: g.lv, main: g.main, extra: g.extra.map(([s, n]) => [s, n]), plus: g.plus };
}
