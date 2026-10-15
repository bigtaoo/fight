import { DEFAULT_LOADOUT, MAX_SKILL_LV, SKILLS, type Loadout, type SkillId } from '@dnf/engine';
import type { Character } from './character';

// Skills as the character grows: each unlocks at a level, then takes skill points (SP_PER_LEVEL
// for every level gained) up to a cap that rises with the character's level. The bar's six
// slots take any unlocked skill; the fifth and sixth open at levels 15 and 25. What a level does
// in a fight is the engine's (RunConfig.skillLv). Numbers are a first draft (design/CONTENT.md).

/** The skills in the order the panel lists them. */
export const SKILL_ORDER: readonly SkillId[] = ['triple', 'upper', 'iai', 'phantom', 'dragon', 'crush'];

/** The character level each skill unlocks at. */
export const UNLOCK: Readonly<Record<SkillId, number>> = { triple: 1, upper: 1, iai: 1, phantom: 1, dragon: 3, crush: 6 };

/** The character level each slot of the bar opens at. */
export const SLOT_LEVEL: readonly number[] = [1, 1, 1, 1, 15, 25];

export const SP_PER_LEVEL = 2;

/** A skill's cap at character level `lv`: 0 while locked, then 1, one more every 3 levels. */
export function skillCap(id: SkillId, lv: number): number {
  return lv < UNLOCK[id] ? 0 : Math.min(MAX_SKILL_LV, 1 + Math.floor((lv - UNLOCK[id]) / 3));
}

/** The character's level of a skill, 0 while locked. */
export function skillLv(ch: Character, id: SkillId): number {
  return skillCap(id, ch.level) === 0 ? 0 : Math.max(1, ch.skillLv[id] ?? 1);
}

/** Skill points not spent yet. */
export function freePoints(ch: Character): number {
  let spent = 0;
  for (const id of SKILL_ORDER) spent += Math.max(0, skillLv(ch, id) - 1);
  return SP_PER_LEVEL * (ch.level - 1) - spent;
}

/** Spends a point on `id`; false when it is locked, at its cap, or no point is left. Saves. */
export function raise(ch: Character, id: SkillId): boolean {
  const lv = skillLv(ch, id);
  if (lv === 0 || lv >= skillCap(id, ch.level) || freePoints(ch) <= 0) return false;
  ch.skillLv[id] = lv + 1;
  ch.save();
  return true;
}

/** Gives every point back. Saves. */
export function resetSkills(ch: Character): void {
  ch.skillLv = {};
  ch.save();
}

/** Whether slot `i` of the bar is open. */
export function slotOpen(ch: Character, i: number): boolean {
  return ch.level >= SLOT_LEVEL[i];
}

/** Puts `id` in slot `i` (null empties it); a skill already elsewhere on the bar swaps places
 * with what was there. False for a closed slot or a locked skill. Saves. */
export function place(ch: Character, i: number, id: SkillId | null): boolean {
  if (!slotOpen(ch, i) || (id !== null && skillLv(ch, id) === 0)) return false;
  const was = id === null ? -1 : ch.bar.indexOf(id);
  if (was >= 0) ch.bar[was] = ch.bar[i];
  ch.bar[i] = id;
  ch.save();
  return true;
}

/** Swaps two open slots. Saves. */
export function swap(ch: Character, i: number, j: number): boolean {
  if (!slotOpen(ch, i) || !slotOpen(ch, j)) return false;
  [ch.bar[i], ch.bar[j]] = [ch.bar[j], ch.bar[i]];
  ch.save();
  return true;
}

/** The bar as a run takes it: closed slots and locked skills left empty. */
export function runLoadout(ch: Character): Loadout {
  return ch.bar.map((id, i) => (id !== null && slotOpen(ch, i) && skillLv(ch, id) > 0 ? id : null));
}

/** The skill levels as a run takes them. */
export function runSkillLv(ch: Character): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  for (const id of SKILL_ORDER) if (skillLv(ch, id) > 1) out[id] = skillLv(ch, id);
  return out;
}

/** A fresh character's bar. */
export function defaultBar(): (SkillId | null)[] {
  return [...DEFAULT_LOADOUT];
}

/** Whether `id` names a skill. */
export function isSkill(id: unknown): id is SkillId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, id);
}
