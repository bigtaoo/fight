import { describe, expect, it } from 'vitest';
import { SKILLS } from './content';
import { hashState } from './hash';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { BASE_HERO, MAX_CDR, type HeroStats } from './state';
import { botButtons } from './bot';
import { hero, newRun, play } from './testUtil';

// The character's stats as the engine takes them: health at spawn, damage in percent, critical
// hits on their own random stream, and the skills' cooldowns cut short.

const bot = (s: Parameters<typeof botButtons>[0]) => botButtons(s, 0);

function training(stats: Partial<HeroStats>) {
  const e = newRun({ dungeon: 'training', hero: { ...BASE_HERO, ...stats } });
  const s = e.state;
  for (const x of s.entities) x.y = x.py = toFp(180);
  const h = hero(s);
  h.x = h.px = toFp(790);
  return e;
}

/** The damage of the hero's hits over a few seconds of plain attacks on the dummy. */
function hits(stats: Partial<HeroStats>) {
  const e = training(stats);
  const ev = play(e, 120, (_s, t) => (t % 4 === 0 ? BTN.ATTACK : 0));
  const id = hero(e.state).id;
  return ev.flatMap((x) => (x.type === 'hit' && x.attacker === id ? [x] : []));
}

describe('hero stats', () => {
  it('the hero starts with the health it is given', () => {
    const e = newRun({ hero: { ...BASE_HERO, hp: 2345 } });
    expect(hero(e.state).hp).toBe(2345);
    expect(hero(e.state).maxHp).toBe(2345);
  });

  it('attack scales the damage in percent', () => {
    const base = hits({});
    const strong = hits({ atk: 200 });
    expect(base.length).toBeGreaterThan(2);
    const sum = (h: typeof base) => h.reduce((n, x) => n + x.dmg, 0);
    // the same damage rolls on the same seed: about double, give or take the rounding
    expect(Math.abs(sum(strong) - 2 * sum(base))).toBeLessThanOrEqual(strong.length * 2);
  });

  it('crits never happen at 0, always at 100, and multiply by the crit damage', () => {
    expect(hits({}).some((x) => x.crit)).toBe(false);
    const base = hits({});
    const all = hits({ crit: 100, critDmg: 200 });
    expect(all.every((x) => x.crit)).toBe(true);
    expect(all.reduce((n, x) => n + x.dmg, 0)).toBeGreaterThan(1.9 * base.reduce((n, x) => n + x.dmg, 0));
  });

  it('a hero who cannot crit draws nothing from the crit stream (base stats replay as before)', () => {
    const a = newRun({ seed: 9 });
    play(a, 300, bot);
    expect(a.state.rng.crit).toBe(newRun({ seed: 9 }).state.rng.crit);
  });

  it('runs with the same stats replay the same', () => {
    const run = () => {
      const e = newRun({ seed: 5, hero: { ...BASE_HERO, crit: 30, atk: 140 } });
      play(e, 600, bot);
      return hashState(e.state);
    };
    expect(run()).toBe(run());
  });

  it('cooldown reduction cuts the skills, capped, and leaves the dodge alone', () => {
    const cd = (cdr: number) => {
      const e = training({ cdr });
      play(e, 2, (_s, t) => (t === 1 ? BTN.SKILL1 : 0));
      return hero(e.state).cd[0];
    };
    const full = SKILLS.triple.cooldown;
    expect(cd(0)).toBeGreaterThan(full - 3);
    expect(cd(20)).toBeGreaterThan(full - Math.trunc(full / 5) - 3);
    expect(cd(20)).toBeLessThanOrEqual(full - Math.trunc(full / 5));
    expect(cd(90)).toBe(cd(MAX_CDR));
  });
});
