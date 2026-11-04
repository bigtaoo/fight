import { describe, expect, it } from 'vitest';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { WORLD } from './content';
import { setState } from './state';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';

// The hero's moves against the training dummies (x 900 and 1300): chains, hitstop, launch, juggle,
// hits on a body lying down, the relaunch off the floor and the jump attack's slam.

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
      if (k === 1) return BTN.SKILL2;
      if (k === 24) return BTN.JUMP;
      if (k >= 28 && k <= 30) return BTN.ATTACK;
      return 0;
    });
    const hits = ev.filter((x) => x.type === 'hit');
    expect(hits[0]).toMatchObject({ launch: true });
    expect(hits.slice(1).some((x) => x.type === 'hit' && x.z > 0)).toBe(true);
    expect(ev.some((x) => x.type === 'swing' && x.move === 'jumpAtk')).toBe(true);
  });

  it('a launched dummy bounces once, lies down, then gets up', () => {
    const e = approach();
    const t0 = e.state.tick;
    const states = new Set<string>();
    const ev = play(e, 90, (_s, t) => {
      states.add(dummyOf(e).state);
      return t === t0 + 1 ? BTN.SKILL2 : 0;
    });
    expect(ev.some((x) => x.type === 'down')).toBe(true);
    expect([...states]).toEqual(expect.arrayContaining(['air', 'down', 'getup', 'idle']));
  });

  it('a dummy lying down takes a few hits, for less, then is untouchable until it is up', () => {
    const e = approach();
    const d = dummyOf(e);
    const t0 = e.state.tick;
    play(e, 200, (_s, t) => (t === t0 + 1 ? BTN.SKILL2 : 0));
    // knock it down again where it now stands, then tap attack at it while it lies there
    const ev: { hit: boolean; state: string; dmg: number }[] = [];
    setState(d, 'down');
    d.timer = 20;
    const h = hero(e.state);
    h.x = d.x - toFp(100);
    h.y = d.y;
    h.facing = 1;
    for (let i = 0; i < 90 && d.state !== 'idle'; i++) {
      const was = d.state;
      const out = play(e, 1, (_s, t) => (was === 'down' && t % 2 === 0 ? BTN.ATTACK : 0));
      const hit = out.find((x) => x.type === 'hit' && x.target === d.id);
      ev.push({ hit: !!hit, state: was, dmg: hit && hit.type === 'hit' ? hit.dmg : 0 });
    }
    const down = ev.filter((x) => x.hit && x.state === 'down');
    expect(down).toHaveLength(WORLD.downHits);
    expect(ev.some((x) => x.hit && x.state !== 'down')).toBe(false);
    expect(ev.some((x) => x.state === 'getup')).toBe(true);
    // the lying body's timer stretched by every hit: it lay longer than the 20 ticks it was given
    expect(ev.filter((x) => x.state === 'down').length).toBeGreaterThan(20);
  });

  it('a launcher lifts a dummy lying down off the floor again, lower than from its feet', () => {
    const e = approach();
    const d = dummyOf(e);
    setState(d, 'down');
    d.timer = 40;
    const t0 = e.state.tick;
    let top = 0;
    const ev = play(e, 40, (_s, t) => {
      top = Math.max(top, d.z);
      return t === t0 + 1 ? BTN.SKILL2 : 0;
    });
    expect(ev.find((x) => x.type === 'hit')).toMatchObject({ target: d.id, launch: true });
    // and from its feet
    const f = approach();
    const g = dummyOf(f);
    const t1 = f.state.tick;
    let peak = 0;
    play(f, 40, (_s, t) => {
      peak = Math.max(peak, g.z);
      return t === t1 + 1 ? BTN.SKILL2 : 0;
    });
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(peak);
  });

  it('a second attack in the air dives and slams the juggled dummy into the floor; it bounces', () => {
    const e = approach();
    const d = dummyOf(e);
    const t0 = e.state.tick;
    let spiked = false;
    let bounced = false;
    let cut = -1;
    const ev = play(e, 90, (_s, t) => {
      const h = hero(e.state);
      if (spiked && d.vz > 0 && d.state === 'air') bounced = true;
      if (h.move === 'jumpSlam' && d.vz < -toFp(20)) spiked = true;
      if (t === t0 + 1) return BTN.SKILL2;
      if (t < t0 + 3) return 0;
      // up after it as soon as the rising cut is done, cut once on the way up, then again
      if (h.state === 'idle' && cut < 0) return BTN.JUMP;
      if (h.state === 'jump' && cut < 0 && h.vz < toFp(10)) {
        cut = t;
        return BTN.ATTACK;
      }
      return cut > 0 && t === cut + 5 ? BTN.ATTACK : 0;
    });
    const swings = ev.flatMap((x) => (x.type === 'swing' && x.id === hero(e.state).id ? [x.move] : []));
    expect(swings).toEqual(expect.arrayContaining(['jumpAtk', 'jumpSlam']));
    expect(spiked).toBe(true);
    expect(bounced).toBe(true);
  });
});
