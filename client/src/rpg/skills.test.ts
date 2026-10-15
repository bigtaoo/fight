import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, MAX_SKILL_LV } from '@dnf/engine';
import type { BagStore } from '../platform/store';
import { Character } from './character';
import { SP_PER_LEVEL, freePoints, place, raise, resetSkills, runLoadout, runSkillLv, skillCap, skillLv, slotOpen, swap } from './skills';

// Skill points, levels and caps, the bar, and what a run takes from them.

const memory = (): BagStore => {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

const at = (level: number, store = memory()) => {
  const c = new Character(store);
  c.level = level;
  return c;
};

describe('skills', () => {
  it('a fresh character has the default bar, every unlocked skill at 1 and no points', () => {
    const c = at(1);
    expect(c.bar).toEqual([...DEFAULT_LOADOUT]);
    expect(skillLv(c, 'triple')).toBe(1);
    expect(skillLv(c, 'dragon')).toBe(0);
    expect(freePoints(c)).toBe(0);
    expect(runSkillLv(c)).toEqual({});
  });

  it('points come with levels and caps rise every three levels', () => {
    const c = at(4);
    expect(freePoints(c)).toBe(3 * SP_PER_LEVEL);
    expect(skillCap('triple', 4)).toBe(2);
    expect(skillCap('dragon', 4)).toBe(1);
    expect(skillCap('crush', 5)).toBe(0);
    expect(raise(c, 'triple')).toBe(true);
    expect(raise(c, 'triple')).toBe(false); // at its cap
    expect(raise(c, 'crush')).toBe(false); // locked
    expect(skillLv(c, 'triple')).toBe(2);
    expect(freePoints(c)).toBe(3 * SP_PER_LEVEL - 1);
    expect(runSkillLv(c)).toEqual({ triple: 2 });
    resetSkills(c);
    expect(freePoints(c)).toBe(3 * SP_PER_LEVEL);
  });

  it('points run out, and levels never pass the top', () => {
    const c = at(2);
    expect(raise(c, 'triple')).toBe(false); // cap 1 at level 2
    const top = at(60);
    for (let i = 0; i < 20; i++) raise(top, 'upper');
    expect(skillLv(top, 'upper')).toBe(MAX_SKILL_LV);
    const one = at(4);
    for (const id of ['triple', 'upper', 'iai', 'phantom'] as const) raise(one, id);
    expect(raise(one, 'dragon')).toBe(false); // dragon's cap is 1
    expect(freePoints(one)).toBe(2);
  });

  it('places, swaps and empties slots; closed slots and locked skills are refused', () => {
    const c = at(6);
    expect(place(c, 0, 'crush')).toBe(true);
    expect(c.bar.slice(0, 4)).toEqual(['crush', 'upper', 'iai', 'phantom']);
    expect(place(c, 1, 'crush')).toBe(true); // already on the bar: the two swap
    expect(c.bar.slice(0, 2)).toEqual(['upper', 'crush']);
    expect(swap(c, 0, 3)).toBe(true);
    expect(c.bar.slice(0, 4)).toEqual(['phantom', 'crush', 'iai', 'upper']);
    expect(place(c, 2, null)).toBe(true);
    expect(c.bar[2]).toBeNull();
    expect(slotOpen(c, 4)).toBe(false);
    expect(place(c, 4, 'iai')).toBe(false);
    expect(swap(c, 0, 5)).toBe(false);
    expect(place(at(1), 0, 'crush')).toBe(false);
  });

  it('the run leaves closed slots and skills locked again empty', () => {
    const c = at(1);
    c.bar = ['crush', 'upper', null, 'phantom', 'iai', 'triple'];
    expect(runLoadout(c)).toEqual([null, 'upper', null, 'phantom', null, null]);
    c.level = 25;
    expect(runLoadout(c)).toEqual(c.bar);
  });

  it('the levels and the bar are saved, and a broken save is ignored', () => {
    const store = memory();
    const c = at(10, store);
    raise(c, 'iai');
    place(c, 0, 'dragon');
    const back = new Character(store);
    expect(skillLv(back, 'iai')).toBe(2);
    expect(back.bar[0]).toBe('dragon');

    const raw = JSON.parse(store.get('dnf.char')!);
    store.set('dnf.char', JSON.stringify({ ...raw, skillLv: { iai: 99, nope: 3, upper: 2.5 }, bar: ['iai', 'iai', null, null, null, null] }));
    const bad = new Character(store);
    expect(bad.skillLv).toEqual({});
    expect(bad.bar).toEqual([...DEFAULT_LOADOUT]);
  });
});
