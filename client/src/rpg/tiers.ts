import { DUNGEONS, TIERS, type DungeonId } from '@dnf/engine';
import type { Progress } from '../game/progress';
import { t } from '../i18n';
import { DUNGEON_LOOT } from './rewards';

// The difficulty tiers a dungeon opens, one after the other (design/CONTENT.md): normal always;
// adventure once it is cleared on normal; warrior once it is cleared on adventure and the hero is
// up to it; king for an S on warrior. Each tier keeps its own progress, under `dungeon` for normal
// (as saves had it before tiers) and `dungeon:N` above. A practice dungeon opens what the dungeon
// it practises opens. The engine scales the monsters; rewards.ts pays for them.

export const TIER_COUNT = TIERS.length;

/** Levels above a dungeon's own a hero needs for its warrior tier. */
export const WARRIOR_LV = 3;

/** The dungeon whose tiers `d` opens with (a practice room counts as its dungeon). */
function home(d: DungeonId): DungeonId {
  return d === 'hall' ? 'heifeng' : d;
}

export function tierName(tier: number): string {
  return t(`tier.${Math.max(0, Math.min(3, tier)) as 0 | 1 | 2 | 3}`);
}

/** The result shows `d`'s tiers once its normal tier is cleared. */
export function showsTiers(d: DungeonId, progress: Progress): boolean {
  return !!DUNGEON_LOOT[home(d)] && progress.cleared(home(d));
}

export function progressKey(d: DungeonId, tier: number): string {
  return tier > 0 ? `${d}:${tier}` : d;
}

/** The level the warrior tier of `d` asks for. */
export function warriorLevel(d: DungeonId): number {
  return (DUNGEON_LOOT[home(d)]?.lv ?? 1) + WARRIOR_LV;
}

export type Lock = { key: 'tier.needClear'; tier: number } | { key: 'tier.needLevel'; n: number } | { key: 'tier.needS' };

/** Why tier `tier` of `d` is still shut, or null when it is open. */
export function tierLock(d: DungeonId, tier: number, progress: Progress, level: number): Lock | null {
  const h = home(d);
  if (tier <= 0) return null;
  if (tier >= TIER_COUNT || DUNGEONS[h].practice || !DUNGEON_LOOT[h]) return { key: 'tier.needClear', tier: tier - 1 };
  if (tier === 3) return progress.get(progressKey(h, 2))?.grade === 'S' ? null : { key: 'tier.needS' };
  if (!progress.cleared(progressKey(h, tier - 1))) return { key: 'tier.needClear', tier: tier - 1 };
  if (tier === 2 && level < warriorLevel(h)) return { key: 'tier.needLevel', n: warriorLevel(h) };
  return null;
}

/** The highest open tier of `d`, at most `want`. */
export function openTier(d: DungeonId, want: number, progress: Progress, level: number): number {
  let t = Math.max(0, Math.min(TIER_COUNT - 1, Math.trunc(want) || 0));
  while (t > 0 && tierLock(d, t, progress, level)) t--;
  return t;
}
