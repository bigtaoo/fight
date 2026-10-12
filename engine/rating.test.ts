import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DUNGEONS, WORLD } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { rateRun } from './rating';
import { hero, newRun, play } from './testUtil';

// What the simulation counts for the rating (combos, hits taken, kills) and how a clear is graded.

describe('rating', () => {
  it('counts a combo of hits, which lapses without one for a while', () => {
    const e = newRun({ dungeon: 'training' });
    const h = hero(e.state);
    const dummy = e.state.entities.find((x) => x.team === 1)!;
    h.x = dummy.x - toFp(100);
    h.y = dummy.y;
    play(e, 60, (_s, t) => (t % 2 ? BTN.ATTACK : 0));
    const p = e.state.players[0];
    expect(p.combo).toBeGreaterThanOrEqual(3);
    expect(p.maxCombo).toBe(p.combo);
    play(e, WORLD.comboTicks + 20, () => 0);
    expect(p.combo).toBe(0);
    expect(p.maxCombo).toBeGreaterThanOrEqual(3);
  });

  it('counts the hits the hero takes and the monsters it kills, by kind', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 7 });
    play(e, 30 * 30, () => 0);
    expect(e.state.players[0].hitsTaken).toBeGreaterThan(0);
    expect(e.state.kills).toEqual({});
    const f = newRun({ dungeon: 'heifeng', seed: 7 });
    play(f, 30 * 120, (s) => (s.room < 2 ? botButtons(s, 0) : 0));
    expect(f.state.kills).toEqual({ bandit: 3, archer: 3 });
  });

  it('grades a clear against the par: all three at par is an S, none near it a C', () => {
    const e = newRun({ dungeon: 'heifeng' });
    const par = DUNGEONS.heifeng.par;
    const p = e.state.players[0];
    const grade = (tick: number, combo: number, hits: number) => {
      e.state.tick = tick;
      p.maxCombo = combo;
      p.hitsTaken = hits;
      return rateRun(e.state).grade;
    };
    expect(grade(par.ticks, par.combo, par.hits)).toBe('S');
    expect(grade(par.ticks + 1, par.combo, par.hits)).toBe('A');
    expect(grade(par.ticks * 2, par.combo, par.hits)).toBe('A');
    expect(grade(par.ticks * 2, par.combo / 2, par.hits * 2)).toBe('B');
    expect(grade(par.ticks * 2, 0, par.hits * 3)).toBe('C');
  });
});
