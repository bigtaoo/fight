import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DungeonId, Grade, MonsterKind } from '@dnf/engine';
import type { Item } from '../protocol';

// Loot and the inventory, the server's alone. The simulation only reports how the run went (the
// monsters killed, the rating); what drops is drawn here from a secret random source after the
// verifier agrees, so no client can know or steer it. Every monster kind has a table and a chance
// to drop from it; the dungeon's clear (the boss) draws from the table of the rating's tier. The
// inventory is a JSON file for now (no database yet).

const ITEMS = {
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

/** A random integer in [0, n): the server's secret source unless a test passes its own. */
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
export function rollLoot(dungeon: DungeonId, kills: Partial<Record<MonsterKind, number>>, grade: Grade, rand: Rand = randomInt): Item[] {
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

/** A device id from the client: anything else is refused before it reaches the file. */
export function validDevice(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export class Inventory {
  private readonly bags: Record<string, Item[]>;

  constructor(private readonly file: string | null) {
    this.bags = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
  }

  get(device: string): Item[] {
    return [...(this.bags[device] ?? [])];
  }

  add(device: string, items: readonly Item[]): Item[] {
    (this.bags[device] ??= []).push(...items);
    this.save();
    return this.get(device);
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    // write then rename, so a crash never leaves half a file
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.bags, null, 1));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
