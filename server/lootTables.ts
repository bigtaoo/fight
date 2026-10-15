import type { DungeonId, Grade, MonsterKind } from '@dnf/engine';
import type { Item } from './protocol';

// The loot tables and the draw, shared by the server and the single-player client. Online the
// server alone draws (server/src/loot.ts, from a secret random source after the verifier agrees);
// a single-player build draws the same tables on the device into a local bag that never joins
// the online inventory. No Node imports here: the client bundles it as source.

export const ITEMS = {
  hemp_boots: { name: '麻履', rarity: 1 },
  iron_bracer: { name: '铁护腕', rarity: 1 },
  bandit_scarf: { name: '山贼头巾', rarity: 1 },
  broken_arrow: { name: '断箭', rarity: 1 },
  shield_shard: { name: '破盾片', rarity: 1 },
  cloud_robe: { name: '流云袍', rarity: 2 },
  jade_belt: { name: '青玉带', rarity: 2 },
  black_wind_token: { name: '黑风令', rarity: 2 },
  ink_blade: { name: '墨痕剑', rarity: 3 },
  tiger_mantle: { name: '虎皮披肩', rarity: 3 },
  chief_axe: { name: '开山斧', rarity: 3 },
} satisfies Record<string, Omit<Item, 'id'>>;

type ItemId = keyof typeof ITEMS;
/** Items and their weights: each is drawn with its weight's share of the total. */
type Table = readonly (readonly [ItemId, number])[];

/** Each kind's chance in percent to drop something, and from what. */
export const MONSTER_LOOT: Partial<Record<MonsterKind, { pct: number; table: Table }>> = {
  bandit: { pct: 20, table: [['bandit_scarf', 6], ['hemp_boots', 3], ['iron_bracer', 3]] },
  archer: { pct: 25, table: [['broken_arrow', 6], ['hemp_boots', 2], ['cloud_robe', 1]] },
  shield: { pct: 30, table: [['shield_shard', 6], ['iron_bracer', 3], ['jade_belt', 1]] },
  elite: { pct: 100, table: [['jade_belt', 3], ['cloud_robe', 3], ['ink_blade', 1]] },
};

const LOW: Table = [['hemp_boots', 6], ['iron_bracer', 6], ['cloud_robe', 3], ['jade_belt', 3], ['ink_blade', 1]];
const MID: Table = [['cloud_robe', 3], ['jade_belt', 3], ['black_wind_token', 3], ['ink_blade', 1], ['tiger_mantle', 1]];
const HIGH: Table = [['black_wind_token', 2], ['ink_blade', 2], ['tiger_mantle', 2], ['chief_axe', 1]];

/** What clearing each dungeon draws, by the rating: how many items and from which table. */
export const CLEAR_LOOT: Partial<Record<DungeonId, Record<Grade, { draws: number; table: Table }>>> = {
  trial: { S: { draws: 1, table: LOW }, A: { draws: 1, table: LOW }, B: { draws: 1, table: LOW }, C: { draws: 1, table: LOW } },
  heifeng: { S: { draws: 2, table: HIGH }, A: { draws: 1, table: HIGH }, B: { draws: 1, table: MID }, C: { draws: 1, table: LOW } },
};

/** A random integer in [0, n). */
export type Rand = (n: number) => number;

function draw(table: Table, rand: Rand): Item {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let r = rand(total);
  for (const [id, w] of table) {
    if (r < w) return { id, ...ITEMS[id] };
    r -= w;
  }
  throw new Error('unreachable');
}

/** The loot of a cleared run: each monster killed rolls its kind's chance, then the clear's draws. */
export function rollLoot(dungeon: DungeonId, kills: Partial<Record<MonsterKind, number>>, grade: Grade, rand: Rand): Item[] {
  const out: Item[] = [];
  for (const [kind, n] of Object.entries(kills) as [MonsterKind, number][]) {
    const loot = MONSTER_LOOT[kind];
    if (!loot) continue;
    for (let i = 0; i < n; i++) if (rand(100) < loot.pct) out.push(draw(loot.table, rand));
  }
  const clear = CLEAR_LOOT[dungeon]?.[grade];
  if (clear) for (let i = 0; i < clear.draws; i++) out.push(draw(clear.table, rand));
  return out;
}
