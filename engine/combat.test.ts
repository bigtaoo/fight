import { describe, expect, it } from 'vitest';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';

// The hero's moves against the training dummies (x 900 and 1300): chains, hitstop, launch, juggle.

/** Walks the hero up to the first dummy, in range of the basic attack. */
function approach(): Engine {
  const e = newRun({ dungeon: 'training' });
  play(e, 400, (s) => (hero(s).x < toFp(790) ? BTN.RIGHT : 0));
  play(e, 10, () => 0);
  return e;
}

const dummyOf = (e: Engine) => e.state.entities.find((x) => x.kind === 'dummy')!;

describe('combat', () => {
  it('a tap of attack lands one hit and stuns the dummy', () => {
    const e = approach();
    const t0 = e.state.tick;
    const ev = play(e, 15, (_s, t) => (t === t0 + 1 ? BTN.ATTACK : 0));
    const hits = ev.filter((x) => x.type === 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ target: dummyOf(e).id, launch: false });
  });

  it('holding attack chains the three-hit combo', () => {
    const e = approach();
    const ev = play(e, 60, () => BTN.ATTACK);
    const swings = ev.flatMap((x) => (x.type === 'swing' && x.id === hero(e.state).id ? [x.move] : []));
    expect(swings.slice(0, 3)).toEqual(['atk1', 'atk2', 'atk3']);
  });

  it('hitstop freezes attacker and target for the move\'s stop ticks', () => {
    const e = approach();
    let hitTick = -1;
    for (let i = 0; i < 15 && hitTick < 0; i++) {
      const ev = play(e, 1, () => BTN.ATTACK);
      if (ev.some((x) => x.type === 'hit')) hitTick = e.state.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    const h = hero(e.state);
    const d = dummyOf(e);
    const before = { hx: h.x, hst: h.st, dx: d.x };
    play(e, 3, () => BTN.ATTACK);
    expect({ hx: h.x, hst: h.st, dx: d.x }).toEqual(before);
    play(e, 1, () => BTN.ATTACK);
    expect(h.st).toBe(before.hst + 1);
  });

  it('the rising slash launches, and a jump attack juggles the dummy in the air', () => {
    const e = approach();
    const t0 = e.state.tick;
    const ev = play(e, 70, (_s, t) => {
      const k = t - t0;
      if (k === 1) return BTN.SKILL1;
      if (k === 22) return BTN.JUMP;
      if (k >= 25 && k <= 27) return BTN.ATTACK;
      return 0;
    });
    const hits = ev.filter((x) => x.type === 'hit');
    expect(hits[0]).toMatchObject({ launch: true });
    expect(hits.slice(1).some((x) => x.type === 'hit' && x.z > 0)).toBe(true);
  });

  it('a launched dummy bounces once, lies down, then gets up', () => {
    const e = approach();
    const t0 = e.state.tick;
    const states = new Set<string>();
    const ev = play(e, 90, (_s, t) => {
      states.add(dummyOf(e).state);
      return t === t0 + 1 ? BTN.SKILL1 : 0;
    });
    expect(ev.some((x) => x.type === 'down')).toBe(true);
    expect([...states]).toEqual(expect.arrayContaining(['air', 'down', 'getup', 'idle']));
  });
});
