import { DUNGEONS, rateRun, tierOf, type DungeonId, type Grade, type MonsterKind, type SimState } from '@dnf/engine';
import { MAX_LEVEL, RARITIES, SLOTS, makeGear, type Gear, type Rand } from './gear';
import type { Character } from './character';

// What a single-player run earns: experience and gold for every kill (a lost run too) and, for a
// clear, a bonus of both by the rating, and gear. Drawn on the device once the run is decided; numbers are a
// first draft, to be tuned in play (design/CONTENT.md).

/** Experience for killing one of each kind. */
export const KILL_XP: Partial<Record<MonsterKind, number>> = { bandit: 20, archer: 25, shield: 40, elite: 80, chief: 400 };
/** Gold for killing one of each kind. */
export const KILL_GOLD: Partial<Record<MonsterKind, number>> = { bandit: 5, archer: 6, shield: 10, elite: 25, chief: 100 };
export const GRADE_PCT: Record<Grade, number> = { S: 150, A: 120, B: 100, C: 80 };

/** Rarity weights (white, blue, purple, pink, gold). */
type Weights = readonly [number, number, number, number, number];

interface DungeonLoot {
  /** The level its gear is drawn for (give or take one). */
  lv: number;
  /** Experience for clearing it, before the rating's share. */
  clearXp: number;
  /** Gold for clearing it, before the rating's share. */
  clearGold: number;
  /** Each kind's chance in percent to drop a piece, and the rarities it is drawn from. */
  kills: Partial<Record<MonsterKind, { pct: number; rarity: Weights }>>;
  /** Pieces the clear draws by the rating, and from which rarities. */
  clear: Record<Grade, { draws: number; rarity: Weights }>;
}

const COMMON: Weights = [75, 22, 3, 0, 0];
const ELITE: Weights = [30, 50, 20, 0, 0];

export const DUNGEON_LOOT: Partial<Record<DungeonId, DungeonLoot>> = {
  trial: {
    lv: 1,
    clearXp: 150,
    clearGold: 50,
    kills: { bandit: { pct: 15, rarity: COMMON } },
    clear: { S: { draws: 1, rarity: [40, 50, 10, 0, 0] }, A: { draws: 1, rarity: [60, 35, 5, 0, 0] }, B: { draws: 1, rarity: COMMON }, C: { draws: 1, rarity: COMMON } },
  },
  heifeng: {
    lv: 3,
    clearXp: 300,
    clearGold: 120,
    kills: { bandit: { pct: 12, rarity: COMMON }, archer: { pct: 15, rarity: COMMON }, shield: { pct: 18, rarity: COMMON }, elite: { pct: 100, rarity: ELITE } },
    clear: {
      S: { draws: 2, rarity: [15, 55, 26, 4, 0] },
      A: { draws: 2, rarity: [30, 50, 18, 2, 0] },
      B: { draws: 1, rarity: [45, 42, 13, 0, 0] },
      C: { draws: 1, rarity: [60, 35, 5, 0, 0] },
    },
  },
};

/** The harder tiers (tiers.ts): what each multiplies experience and gold by, in percent; the
 * levels it adds to the gear it draws; and its chance in percent, tried once per tier above
 * normal, to raise a piece's rarity by one. */
export const TIER_REWARD = [
  { pct: 100, gearLv: 0, bump: 0 },
  { pct: 150, gearLv: 2, bump: 40 },
  { pct: 220, gearLv: 5, bump: 45 },
  { pct: 320, gearLv: 8, bump: 50 },
] as const;

export interface Reward {
  xp: number;
  gold: number;
  /** Levels gained, and the level reached. */
  levels: number;
  level: number;
  /** Gear that went into the bag, and gear the full bag could not take. */
  gear: Gear[];
  lost: Gear[];
}

function pick(w: Weights, rand: Rand): number {
  let r = rand(w.reduce((n, x) => n + x, 0));
  for (let i = 0; i < w.length; i++) {
    if (r < w[i]) return i;
    r -= w[i];
  }
  return 0;
}

/** Experience for a run's kills and, when cleared, its rating. */
export function runXp(s: SimState): number {
  return earned(s, KILL_XP, (l) => l.clearXp);
}

/** Gold for a run's kills and, when cleared, its rating. */
export function runGold(s: SimState): number {
  return earned(s, KILL_GOLD, (l) => l.clearGold);
}

function earned(s: SimState, perKill: Partial<Record<MonsterKind, number>>, clear: (l: DungeonLoot) => number): number {
  const loot = DUNGEON_LOOT[s.config.dungeon];
  if (!loot) return 0;
  let n = 0;
  for (const [kind, k] of Object.entries(s.kills) as [MonsterKind, number][]) n += (perKill[kind] ?? 0) * k;
  if (s.outcome === 'cleared') n += Math.floor((clear(loot) * GRADE_PCT[rateRun(s).grade]) / 100);
  return Math.floor((n * TIER_REWARD[tierOf(s)].pct) / 100);
}

/** The gear a cleared run draws: each kill rolls its kind's chance, then the clear's draws. */
export function runGear(s: SimState, newId: () => number, rand: Rand): Gear[] {
  const loot = DUNGEON_LOOT[s.config.dungeon];
  if (!loot || s.outcome !== 'cleared') return [];
  const tier = tierOf(s);
  const tr = TIER_REWARD[tier];
  const one = (rarity: Weights) => {
    const lv = Math.min(MAX_LEVEL, Math.max(1, loot.lv + tr.gearLv - 1 + rand(3)));
    let r = pick(rarity, rand);
    for (let i = 0; i < tier; i++) if (rand(100) < tr.bump) r = Math.min(RARITIES - 1, r + 1);
    return makeGear(newId(), SLOTS[rand(SLOTS.length)], lv, r, rand);
  };
  const out: Gear[] = [];
  for (const [kind, n] of Object.entries(s.kills) as [MonsterKind, number][]) {
    const k = loot.kills[kind];
    if (k) for (let i = 0; i < n; i++) if (rand(100) < k.pct) out.push(one(k.rarity));
  }
  const c = loot.clear[rateRun(s).grade];
  for (let i = 0; i < c.draws; i++) out.push(one(c.rarity));
  return out;
}

/** Gives a decided run's earnings to the character and saves it; null for practice. */
export function settleRun(s: SimState, ch: Character, rand: Rand): Reward | null {
  if (s.outcome === 'playing' || DUNGEONS[s.config.dungeon].practice || !DUNGEON_LOOT[s.config.dungeon]) return null;
  const xp = runXp(s);
  const levels = ch.gainXp(xp);
  const gold = runGold(s);
  ch.gold += gold;
  const all = runGear(s, () => ch.newId(), rand);
  const lost = ch.give(all);
  ch.save();
  return { xp, gold, levels, level: ch.level, gear: all.slice(0, all.length - lost.length), lost };
}
