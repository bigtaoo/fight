import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, DODGE, SKILLS, WORLD, validLoadout, type SkillId } from './content';
import type { SimEvent } from './events';
import { hashState } from './hash';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { newEntity, type Entity } from './state';
import { startMove } from './systems/moves';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';

// The swordsman's skill set: parts chained by presses (triple slash) or by themselves (dragon
// dash, crushing upper), cancelling recovery into skills and the dodge, the ultimate that nothing
// cancels and its early finish, super armour, the dodge's and the quick rise's untouchable
// moments, and the loadout.

/** The hero at `x` (790: close in) facing the first training dummy (x 900), both at depth 180. */
function atDummy(loadout: readonly SkillId[] = DEFAULT_LOADOUT, x = 790): Engine {
  const e = newRun({ dungeon: 'training', loadout });
  const s = e.state;
  for (const x of s.entities) {
    x.y = x.py = toFp(180);
  }
  const h = hero(s);
  h.x = h.px = toFp(x);
  return e;
}

/** Holds `held` throughout and presses `btn` (on top of it) on each of `ticks`, counted from 1. */
function presses(btn: number, ticks: number[], held = 0) {
  let t0 = -1;
  return (_s: unknown, tick: number) => {
    if (t0 < 0) t0 = tick - 1;
    return held | (ticks.includes(tick - t0) ? btn : 0);
  };
}

function swings(ev: SimEvent[], id: number): string[] {
  return ev.flatMap((x) => (x.type === 'swing' && x.id === id ? [x.move] : []));
}

function hitsBy(ev: SimEvent[], id: number) {
  return ev.flatMap((x) => (x.type === 'hit' && x.attacker === id ? [x] : []));
}

/** A bandit just behind the hero, facing it and starting its slash (strikes on tick 17). */
function slashingBandit(e: Engine): Entity {
  const s = e.state;
  const h = hero(s);
  const b = newEntity(s, 'bandit', 1, -1, h.x - toFp(110), h.y);
  b.facing = 1;
  b.cd[0] = 1000;
  startMove(b, 'slash', []);
  return b;
}

describe('skills', () => {
  it('triple slash: one press, one cut; pressing on chains the next two, the third launching', () => {
    const one = atDummy();
    const h1 = hero(one.state);
    expect(swings(play(one, 40, presses(BTN.SKILL1, [1])), h1.id)).toEqual(['tri1']);
    expect(h1.cd[0]).toBeGreaterThan(SKILLS.triple.cooldown - 41);

    // from further off, so the dashes carry the hero up to the dummy rather than past it
    const e = atDummy(DEFAULT_LOADOUT, 500);
    const h = hero(e.state);
    const ev = play(e, 60, presses(BTN.SKILL1, [1, 12, 24]));
    expect(swings(ev, h.id)).toEqual(['tri1', 'tri2', 'tri3']);
    expect(hitsBy(ev, h.id).slice(-1)[0]).toMatchObject({ launch: true });
  });

  it('triple slash turns round between parts with the stick', () => {
    const e = atDummy();
    const h = hero(e.state);
    play(e, 10, presses(BTN.SKILL1, [1]));
    expect(h.facing).toBe(1);
    play(e, 6, presses(BTN.SKILL1, [1], BTN.LEFT));
    expect(h.move).toBe('tri2');
    expect(h.facing).toBe(-1);
  });

  it('a skill cancels the recovery of an attack and of another skill', () => {
    const e = atDummy();
    const h = hero(e.state);
    // atk1 cancels from its tick 6, upper from its tick 13 (each a few ticks later for the hitstop)
    const ev = play(e, 60, (_s, t) => (t === 1 ? BTN.ATTACK : t === 7 ? BTN.SKILL2 : t === 26 ? BTN.SKILL3 : 0));
    expect(swings(ev, h.id)).toEqual(['atk1', 'upper', 'iai']);
  });

  it('nothing cancels the ultimate, but jump cuts it short to its sword wave', () => {
    const e = atDummy();
    const h = hero(e.state);
    // a skill and the dodge pressed all through the dance
    const moves: string[] = [];
    const ev = play(e, 90, (_s, t) => {
      moves.push(h.move);
      return t === 1 ? BTN.ULT : t % 10 === 0 ? BTN.SKILL1 : t % 10 === 5 ? BTN.DODGE : 0;
    });
    expect(swings(ev, h.id)[0]).toBe('phantom');
    expect(moves.slice(2, 60).every((m) => m === 'phantom')).toBe(true);
    expect(hitsBy(ev, h.id).length).toBeGreaterThanOrEqual(10);
    expect(ev.some((x) => x.type === 'fire' && x.shot === 'wave')).toBe(true);

    const early = atDummy();
    const he = hero(early.state);
    let fireTick = -1;
    play(early, 40, (s, t) => {
      if (fireTick < 0 && s.shots.some((p) => p.kind === 'wave')) fireTick = t;
      return t === 1 ? BTN.ULT : t === 12 ? BTN.JUMP : 0;
    });
    expect(he.move === 'phantomEnd' || he.state === 'idle').toBe(true);
    expect(fireTick).toBeGreaterThan(0);
    expect(fireTick).toBeLessThan(25);
  });

  it('the sword wave flies through every monster in its way', () => {
    const e = atDummy();
    const h = hero(e.state);
    const ev = play(e, 120, (_s, t) => (t === 1 ? BTN.ULT : 0));
    const dummies = e.state.entities.filter((x) => x.kind === 'dummy').map((x) => x.id);
    const waveHits = ev.flatMap((x) => (x.type === 'hit' && x.attacker === h.id && x.launch ? [x.target] : []));
    expect(new Set(waveHits)).toEqual(new Set(dummies));
  });

  it('the dodge hops back, untouchable as it leaves the ground, and has a short cooldown', () => {
    const e = atDummy();
    const h = hero(e.state);
    const x0 = h.x;
    const ev = play(e, 3, presses(BTN.DODGE, [1]));
    expect(swings(ev, h.id)).toEqual(['backstep']);
    expect(h.inv).toBeGreaterThan(0);
    expect(h.cd[DODGE.slot]).toBeGreaterThan(0);
    // an arrow through the hero while it is untouchable
    const s = e.state;
    s.shots.push({ id: s.nextId++, kind: 'arrow', team: 1, owner: -1, x: h.x + toFp(40), y: h.y, z: h.z + toFp(100), px: 0, py: 0, pz: 0, vx: toFp(-60), life: 30, pierce: 1, hitList: [] });
    const ev2 = play(e, 6, () => 0);
    expect(ev2.some((x) => x.type === 'hit')).toBe(false);
    play(e, 40, () => 0);
    expect(h.state).toBe('idle');
    expect(h.x).toBeLessThan(x0 - toFp(120));
  });

  it('the same arrow hits a hero that does not dodge', () => {
    const e = atDummy();
    const h = hero(e.state);
    const s = e.state;
    s.shots.push({ id: s.nextId++, kind: 'arrow', team: 1, owner: -1, x: h.x + toFp(40), y: h.y, z: toFp(100), px: 0, py: 0, pz: 0, vx: toFp(-24), life: 30, pierce: 1, hitList: [] });
    const ev = play(e, 6, () => 0);
    expect(ev.some((x) => x.type === 'hit' && x.target === h.id)).toBe(true);
  });

  it('the dodge cancels the recovery of a skill', () => {
    const e = atDummy();
    const h = hero(e.state);
    // iai cancels from its tick 24, after 6 ticks of hitstop on the dummy
    const ev = play(e, 40, (_s, t) => (t === 1 ? BTN.SKILL3 : t === 27 ? BTN.DODGE : 0));
    expect(swings(ev, h.id)).toEqual(['iai', 'backstep']);
  });

  it('the crushing upper rams, then rises by itself, and shrugs off hits under super armour', () => {
    const e = atDummy(['triple', 'crush', 'iai', 'phantom']);
    const h = hero(e.state);
    const b = slashingBandit(e);
    // the bandit strikes on its tick 17: the hero starts the ram on tick 14, armoured through it
    const ev = play(e, 50, presses(BTN.SKILL2, [14]));
    expect(swings(ev, h.id)).toEqual(['crush1', 'crush2']);
    expect(ev.find((x) => x.type === 'hit' && x.attacker === b.id)).toMatchObject({ target: h.id, armor: true });
    expect(h.hp).toBeLessThan(h.maxHp);
    expect(ev.some((x) => x.type === 'hit' && x.target === h.id && !x.armor)).toBe(false);
  });

  it('super armour: struck mid-skill, the hero takes the damage and carries on', () => {
    const e = atDummy();
    const h = hero(e.state);
    const s = e.state;
    play(e, 6, presses(BTN.ULT, [1]));
    s.shots.push({ id: s.nextId++, kind: 'arrow', team: 1, owner: -1, x: h.x - toFp(40), y: h.y, z: toFp(100), px: 0, py: 0, pz: 0, vx: toFp(24), life: 30, pierce: 1, hitList: [] });
    const ev = play(e, 4, () => 0);
    expect(ev.find((x) => x.type === 'hit' && x.target === h.id)).toMatchObject({ armor: true });
    expect(h.hp).toBeLessThan(h.maxHp);
    expect(h.state).toBe('act');
    expect(h.move).toBe('phantom');
  });

  it('the dragon dash goes where the stick points, four times, the last launching', () => {
    const e = atDummy(['dragon', 'upper', 'iai', 'phantom']);
    const h = hero(e.state);
    h.y = h.py = toFp(60);
    const ev = play(e, 60, presses(BTN.SKILL1, [1], BTN.DOWN));
    expect(swings(ev, h.id)).toEqual(['dragon1', 'dragon2', 'dragon3', 'dragon4']);
    expect(h.y).toBeGreaterThan(toFp(300));
    // straight down the depth: no way forward was held
    expect(Math.abs(h.x - toFp(790))).toBeLessThan(toFp(5));
  });

  it('a quick rise gets a downed hero straight up, untouchable past the getup', () => {
    const e = atDummy();
    const h = hero(e.state);
    h.state = 'down';
    h.st = 0;
    h.timer = WORLD.downTicks;
    const ev = play(e, 2, presses(BTN.JUMP, [1]));
    expect(ev.some((x) => x.type === 'rise')).toBe(true);
    expect(h.state).toBe('getup');
    expect(h.inv).toBeGreaterThan(h.timer);
  });

  it('only a skill per slot, each in its own slot, is a loadout', () => {
    expect(validLoadout([...DEFAULT_LOADOUT])).toBe(true);
    expect(validLoadout(['dragon', 'crush', 'iai', 'phantom'])).toBe(true);
    expect(validLoadout(['upper', 'triple', 'iai', 'phantom'])).toBe(false);
    expect(validLoadout(['triple', 'upper', 'iai'])).toBe(false);
    expect(validLoadout(['triple', 'upper', 'iai', 'toString'])).toBe(false);
    expect(validLoadout('triple')).toBe(false);
  });

  it('the loadout is part of the state, so a run checked against the wrong one fails', () => {
    const a = newRun({ seed: 3 });
    const b = newRun({ seed: 3, loadout: ['dragon', 'upper', 'iai', 'phantom'] });
    expect(hashState(a.state)).not.toBe(hashState(b.state));
  });
});
