import { describe, expect, it } from 'vitest';
import { HERO, MOVES } from './content';
import type { Engine } from './Engine';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hero, newRun, play, type Buttons } from './testUtil';

// The feel of the hero's controls on the training dummies (x 900 and 1300): a press made during a
// move waits for its cancel, the basic string loops, the dash attack and the jump out of a cut.

/** Walks the hero up to the first dummy, in range of the basic attack. */
function approach(): Engine {
  const e = newRun({ dungeon: 'training' });
  play(e, 400, (s) => (hero(s).x < toFp(790) ? BTN.RIGHT : 0));
  play(e, 10, () => 0);
  return e;
}

const dummyOf = (e: Engine) => e.state.entities.find((x) => x.kind === 'dummy')!;

/** Steps one tick at a time until `move` starts (up to `n` ticks); the move the hero was in the
 * tick before and how far into it, or null if it never started. */
function until(e: Engine, move: string, n: number, buttons: Buttons): { from: string; st: number } | null {
  const h = hero(e.state);
  for (let i = 0; i < n; i++) {
    const before = { from: h.state === 'act' ? h.move : h.state, st: h.st };
    const ev = play(e, 1, buttons);
    if (ev.some((x) => x.type === 'swing' && x.id === h.id && x.move === move)) return before;
  }
  return null;
}

describe('feel', () => {
  it('a skill pressed in the hitstop of the third cut starts on its cancel tick', () => {
    const e = approach();
    const h = hero(e.state);
    // hold attack into the third cut, up to its hit
    for (let i = 0; i < 80 && !(h.move === 'atk3' && h.stop > 0); i++) play(e, 1, () => BTN.ATTACK);
    expect(h.move).toBe('atk3');
    expect(h.stop).toBeGreaterThan(0);
    const pressedAt = h.st;
    play(e, 1, () => BTN.SKILL2);
    const at = until(e, 'upper', 40, () => 0);
    expect(at).toEqual({ from: 'atk3', st: MOVES.atk3.cancel - 1 });
    expect(pressedAt).toBeLessThan(MOVES.atk3.cancel);
  });

  it('a dodge pressed early in the gathering cut is kept until the cut can be cancelled', () => {
    const e = approach();
    const h = hero(e.state);
    play(e, 1, () => BTN.SKILL3);
    expect(h.move).toBe('iai');
    play(e, 1, () => 0);
    play(e, 1, () => BTN.DODGE);
    // far longer than the plain buffer, so only the move's own buffer keeps it
    expect(MOVES.iai.cancel - h.st).toBeGreaterThan(HERO.buffer);
    const at = until(e, 'backstep', 60, () => 0);
    expect(at).toEqual({ from: 'iai', st: MOVES.iai.cancel - 1 });
  });

  it('a press is kept only a few ticks past the cancel', () => {
    const e = approach();
    const h = hero(e.state);
    play(e, 1, () => BTN.SKILL3);
    play(e, 1, () => BTN.JUMP);
    // the gathering cut does not cancel into a jump, and the press is gone once it ends
    const at = until(e, 'never', MOVES.iai.total + 10, () => 0);
    expect(at).toBeNull();
    expect(h.state).toBe('idle');
    expect(e.state.players[0].buf).toBe(0);
  });

  it('mashing attack does not push out a skill waiting for the cancel', () => {
    const e = approach();
    const h = hero(e.state);
    for (let i = 0; i < 80 && !(h.move === 'atk3' && h.stop > 0); i++) play(e, 1, () => BTN.ATTACK);
    play(e, 1, () => BTN.SKILL2);
    const at = until(e, 'upper', 40, (s) => (s.tick % 2 ? BTN.ATTACK : 0));
    expect(at?.from).toBe('atk3');
  });

  it('holding attack loops the basic string, the third cut back into the first', () => {
    const e = approach();
    const h = hero(e.state);
    const ev = play(e, 90, () => BTN.ATTACK);
    const swings = ev.flatMap((x) => (x.type === 'swing' && x.id === h.id ? [x.move] : []));
    expect(swings.slice(0, 6)).toEqual(['atk1', 'atk2', 'atk3', 'atk1', 'atk2', 'atk3']);
  });

  it('the third cut chains into the first from its cancel tick', () => {
    const e = approach();
    const h = hero(e.state);
    for (let i = 0; i < 80 && h.move !== 'atk3'; i++) play(e, 1, () => BTN.ATTACK);
    const at = until(e, 'atk1', 40, () => BTN.ATTACK);
    expect(at).toEqual({ from: 'atk3', st: MOVES.atk3.cancel - 1 });
  });

  it('a hero hit freezes the target longer than the hero', () => {
    const e = approach();
    const h = hero(e.state);
    const d = dummyOf(e);
    for (let i = 0; i < 15 && h.stop === 0; i++) play(e, 1, () => BTN.ATTACK);
    expect(h.stop).toBeGreaterThan(0);
    expect(HERO.hitstopLead).toBeGreaterThan(0);
    expect(d.stop).toBe(h.stop + HERO.hitstopLead);
  });

  it('attack on the run is the dash attack: a lunge of about 120 px', () => {
    const e = newRun({ dungeon: 'training' });
    const h = hero(e.state);
    play(e, 5, () => 0);
    // a double tap starts the run
    play(e, 2, () => BTN.RIGHT);
    play(e, 2, () => 0);
    play(e, 6, () => BTN.RIGHT);
    expect(h.state).toBe('run');
    const x0 = h.x;
    const ev = play(e, 1, () => BTN.RIGHT | BTN.ATTACK);
    expect(ev.some((x) => x.type === 'swing' && x.move === 'dashAtk')).toBe(true);
    play(e, MOVES.dashAtk.total + 2, () => 0);
    expect(h.state).toBe('idle');
    const moved = h.x - x0;
    expect(moved).toBeGreaterThan(toFp(100));
    expect(moved).toBeLessThan(toFp(140));
  });

  it('the dash attack hits and chains into the basic string', () => {
    const e = newRun({ dungeon: 'training' });
    const h = hero(e.state);
    play(e, 400, (s) => (hero(s).x < toFp(600) ? BTN.RIGHT : 0));
    play(e, 10, () => 0);
    play(e, 2, () => BTN.RIGHT);
    play(e, 2, () => 0);
    play(e, 4, () => BTN.RIGHT);
    expect(h.state).toBe('run');
    // run up to the dummy, strike on the run, then keep holding attack
    for (let i = 0; i < 40 && dummyOf(e).x - h.x > toFp(240); i++) play(e, 1, () => BTN.RIGHT);
    expect(h.state).toBe('run');
    const ev = play(e, 60, (s) => BTN.ATTACK | (hero(s).state === 'run' ? BTN.RIGHT : 0));
    const swings = ev.flatMap((x) => (x.type === 'swing' && x.id === h.id ? [x.move] : []));
    expect(ev.some((x) => x.type === 'hit' && x.attacker === h.id)).toBe(true);
    expect(swings.slice(0, 2)).toEqual(['dashAtk', 'atk1']);
  });

  it('a jump cancels a basic cut from its cancel tick, and a skill does not', () => {
    const e = approach();
    const h = hero(e.state);
    play(e, 1, () => BTN.ATTACK);
    expect(h.move).toBe('atk1');
    // pressed before the cancel: buffered, it jumps on the cancel tick
    play(e, 1, () => BTN.JUMP);
    for (let i = 0; i < 20 && h.state === 'act'; i++) play(e, 1, () => 0);
    expect(h.state).toBe('jump');
    expect(h.z).toBeGreaterThan(0);

    const f = approach();
    const g = hero(f.state);
    play(f, 1, () => BTN.SKILL2);
    play(f, 1, () => BTN.JUMP);
    for (let i = 0; i < 40 && g.state === 'act'; i++) play(f, 1, () => 0);
    expect(g.state).not.toBe('jump');
  });
});
