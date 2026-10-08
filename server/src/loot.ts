import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Item } from '../protocol';

// Loot and the inventory, the server's alone. The simulation only reports that the run was
// cleared; what drops is drawn here from a secret random source after the verifier agrees, so
// no client can know or steer it. The inventory is a JSON file for M1 (no database yet).

export const ITEMS: readonly (Item & { weight: number })[] = [
  { id: 'ink_blade', name: '墨痕剑', rarity: 3, weight: 1 },
  { id: 'cloud_robe', name: '流云袍', rarity: 2, weight: 3 },
  { id: 'jade_belt', name: '青玉带', rarity: 2, weight: 3 },
  { id: 'hemp_boots', name: '麻履', rarity: 1, weight: 6 },
  { id: 'iron_bracer', name: '铁护腕', rarity: 1, weight: 6 },
];

export function rollLoot(): Item {
  const total = ITEMS.reduce((n, it) => n + it.weight, 0);
  let r = randomInt(total);
  for (const { weight, ...item } of ITEMS) {
    if (r < weight) return item;
    r -= weight;
  }
  throw new Error('unreachable');
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

  add(device: string, item: Item): Item[] {
    (this.bags[device] ??= []).push(item);
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
