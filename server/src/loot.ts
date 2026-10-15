import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DungeonId, Grade, MonsterKind } from '@dnf/engine';
import type { Item } from '../protocol';
import { rollLoot as roll, type Rand } from '../lootTables';

export { CLEAR_LOOT, MONSTER_LOOT, type Rand } from '../lootTables';

// Loot and the inventory, the server's alone. The simulation only reports how the run went (the
// monsters killed, the rating); what drops is drawn here from a secret random source after the
// verifier agrees, so no client can know or steer it. Every monster kind has a table and a chance
// to drop from it; the dungeon's clear (the boss) draws from the table of the rating's tier. The
// inventory is a JSON file for now (no database yet). The tables are in server/lootTables.ts.

/** The loot of a cleared run, drawn from the server's secret source unless a test passes its own. */
export function rollLoot(dungeon: DungeonId, kills: Partial<Record<MonsterKind, number>>, grade: Grade, rand: Rand = randomInt): Item[] {
  return roll(dungeon, kills, grade, rand);
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
