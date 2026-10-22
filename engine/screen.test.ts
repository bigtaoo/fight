import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { MONSTERS, MOVES } from './content';
import { hashState } from './hash';
import { BTN } from './input';
import { toFp } from './math/fixed';
import type { Entity, SimState } from './state';
import { groundOf } from './systems/ground';
import { hero, newRun, play } from './testUtil';

// Inside the folding screen (?dungeon=screen, 1-3's mechanics): platforms to jump onto, walk off
// and drop through; a finch flock hovering out of reach of ground moves, diving at the hero and
// open to them while it pecks on the ground. Its room: platforms A (700..1500 x 90..210, 110 high),
// B on top of A (1050..1350 x 110..190, 220 high) and C (1800..2100 x 200..320, 90 high).

const A = toFp(110);
const B = toFp(220);

/** The screen room, with the monsters `keep` passes left as they are and the rest turned into a
 * still, immortal dummy far off to the right (so the room never clears). */
function screen(keep: (m: Entity) => boolean = () => false) {
  const e = newRun({ dungeon: 'screen', seed: 1 });
  play(e, 1, () => 0);
  for (const m of e.state.entities) {
    if (m.team !== 1 || keep(m)) continue;
    m.kind = 'dummy';
    m.x = toFp(2350);
    m.y = toFp(340);
    m.z = m.pz = 0;
  }
  return e;
}

function put(e: Entity, x: number, y: number, z = 0): void {
  e.x = e.px = toFp(x);
  e.y = e.py = toFp(y);
  e.z = e.pz = z;
  e.vx = e.vy = e.vz = 0;
}

/** Buttons by the tick's index within this `play` call (0, 1, ...). */
function seq(f: (i: number) => number) {
  let i = 0;
  return () => f(i++);
}

const finches = (s: SimState) => s.entities.filter((m) => m.kind === 'finch' && m.hp > 0);

describe('platforms', () => {
  it('a jump lands on a platform, and from there onto the one above it', () => {
    const e = screen();
    const h = hero(e.state);
    put(h, 650, 150);
    play(e, 40, seq((i) => (i < 25 ? BTN.RIGHT : 0) | (i === 2 ? BTN.JUMP : 0)));
    expect(h.z).toBe(A);
    expect(groundOf(e.state, h)).toBe(A);
    expect(h.state).toBe('idle');
    put(h, 1000, 150, A);
    play(e, 40, seq((i) => (i < 10 ? BTN.RIGHT : 0) | (i === 2 ? BTN.JUMP : 0)));
    expect(h.z).toBe(B);
    expect(h.state).toBe('idle');
  });

  it('comes up through a platform from below and stands under it otherwise', () => {
    const e = screen();
    const h = hero(e.state);
    put(h, 1000, 150);
    play(e, 30, () => 0);
    expect(h.z).toBe(0);
    // a jump straight up under the platform: through it on the way up, onto it on the way down
    play(e, 40, seq((i) => (i === 2 ? BTN.JUMP : 0)));
    expect(h.z).toBe(A);
  });

  it('walking off the edge falls as from a jump, and lands on the floor', () => {
    const e = screen();
    const h = hero(e.state);
    put(h, 1450, 150, A);
    const states: string[] = [];
    const ev = play(e, 40, (s) => {
      states.push(hero(s).state);
      return BTN.RIGHT;
    });
    expect(states).toContain('jump');
    expect(ev.some((x) => x.type === 'land')).toBe(true);
    expect(h.z).toBe(0);
    expect(h.state).toBe('walk');
  });

  it('down + jump drops through the platform; plain jump does not', () => {
    const e = screen();
    const h = hero(e.state);
    put(h, 1000, 150, A);
    play(e, 30, seq((i) => (i === 2 ? BTN.JUMP : 0)));
    expect(h.z).toBe(A);
    play(e, 30, seq((i) => (i === 2 ? BTN.JUMP | BTN.DOWN : 0)));
    expect(h.z).toBe(0);
    expect(h.state).toBe('idle');
    // on the floor, down + jump is an ordinary jump (with a step toward the front)
    play(e, 4, seq((i) => (i === 1 ? BTN.JUMP | BTN.DOWN : 0)));
    expect(h.state).toBe('jump');
    expect(h.z).toBeGreaterThan(0);
  });

  it('a monster on a platform walks off toward a hero below; one below hops up to a hero above', () => {
    const e = screen((m) => m.kind === 'inkling');
    const h = hero(e.state);
    const ink = e.state.entities.find((m) => m.kind === 'inkling')!;
    expect(ink.z).toBe(A);
    put(h, 400, 150);
    h.inv = 10_000;
    play(e, 300, () => 0);
    expect(ink.z).toBe(0);
    expect(ink.x).toBeLessThan(toFp(700));
    // now the hero up on the platform, the inkling on the floor close by: it hops up after it
    put(h, 900, 150, A);
    put(ink, 640, 150);
    play(e, 60, () => 0);
    expect(ink.z).toBe(A);
  });

  it('a launched body lands on the platform it falls onto', () => {
    const e = screen((m) => m.kind === 'inkling');
    const h = hero(e.state);
    const ink = e.state.entities.find((m) => m.kind === 'inkling')!;
    // (clear of platform B above: x 1350 on)
    put(ink, 1440, 150, A);
    put(h, 1370, 150, A);
    h.facing = 1;
    ink.cd[0] = 10_000;
    h.inv = 10_000;
    // the upper launches it from the platform; it comes down on the platform, not the floor
    const ev = play(e, 90, seq((i) => (i === 2 ? BTN.SKILL2 : 0)));
    expect(ev.some((x) => x.type === 'hit' && x.target === ink.id && x.launch)).toBe(true);
    expect(ev.some((x) => x.type === 'down' && x.id === ink.id)).toBe(true);
    expect(ink.z).toBe(A);
  });
});

describe('flyers', () => {
  it('the flock spawns at its hover height, above the reach of every ground move', () => {
    const e = newRun({ dungeon: 'screen', seed: 1 });
    play(e, 1, () => 0);
    const f = finches(e.state);
    expect(f.length).toBe(6);
    const hover = MONSTERS.finch.fly!.hover;
    for (const m of f) expect(m.z).toBe(hover);
    for (const id of ['atk1', 'atk2', 'atk3', 'iai', 'phantom']) expect(MOVES[id].box!.z1).toBeLessThan(hover);
  });

  /** One finch frozen in its hover right in front of the hero, the others gone. */
  function hovering() {
    const e = screen((m) => m.kind === 'finch');
    const [f, ...rest] = finches(e.state);
    for (const m of rest) {
      m.kind = 'dummy';
      put(m, 2350, 340);
    }
    const h = hero(e.state);
    put(h, 400, 180);
    h.facing = 1;
    put(f, 470, 180, MONSTERS.finch.fly!.hover);
    f.stop = 1000;
    return { e, h, f };
  }

  it('ground attacks pass under a hovering finch', () => {
    const { e, f } = hovering();
    const ev = play(e, 40, () => BTN.ATTACK);
    expect(ev.some((x) => x.type === 'swing')).toBe(true);
    expect(ev.some((x) => x.type === 'hit' && x.target === f.id)).toBe(false);
  });

  it('the launcher reaches it, and so does a jump attack', () => {
    const up = hovering();
    const ev = play(up.e, 20, seq((i) => (i === 2 ? BTN.SKILL2 : 0)));
    expect(ev.some((x) => x.type === 'hit' && x.target === up.f.id && x.launch)).toBe(true);
    // launched, gravity has it: it falls, lies down and rises back to its hover
    play(up.e, 60, () => 0);
    expect(up.f.z).toBe(0);
    up.f.cd[0] = 10_000;
    play(up.e, 120, () => 0);
    expect(up.f.z).toBe(MONSTERS.finch.fly!.hover);

    const jump = hovering();
    const ev2 = play(jump.e, 30, seq((i) => (i === 2 ? BTN.JUMP : i === 8 ? BTN.ATTACK : 0)));
    expect(ev2.some((x) => x.type === 'swing' && x.move === 'jumpAtk')).toBe(true);
    expect(ev2.some((x) => x.type === 'hit' && x.target === jump.f.id)).toBe(true);
  });

  it('a hero up on a platform reaches it with ground attacks', () => {
    const { e, h, f } = hovering();
    put(h, 1000, 150, B);
    put(f, 1080, 150, MONSTERS.finch.fly!.hover);
    const ev = play(e, 20, () => BTN.ATTACK);
    expect(ev.some((x) => x.type === 'hit' && x.target === f.id)).toBe(true);
  });

  it('dives at the hero and hits, then pecks on the ground where ground attacks hit it', () => {
    const { e, h, f } = hovering();
    f.stop = 0;
    f.cd[0] = 0;
    const seen: string[] = [];
    let ev = play(e, 120, (s) => {
      const m = s.entities.find((x) => x.id === f.id)!;
      if (m.state === 'act' && seen[seen.length - 1] !== m.move) seen.push(m.move);
      return 0;
    });
    expect(seen.slice(0, 3)).toEqual(['flash', 'dive', 'peck']);
    expect(ev.some((x) => x.type === 'hit' && x.target === h.id && x.attacker === f.id)).toBe(true);

    // again, the hero untouchable this time: once it pecks, a plain attack hits it on the ground
    const two = hovering();
    two.f.stop = 0;
    two.f.cd[0] = 0;
    two.h.inv = 10_000;
    let pecked = 0;
    ev = play(two.e, 120, (s) => {
      const m = s.entities.find((x) => x.id === two.f.id);
      if (!m) return 0;
      if (m.move === 'peck' && !pecked) pecked = s.tick;
      const hh = hero(s);
      if (pecked && hh.facing * (m.x - hh.x) < 0) return m.x > hh.x ? BTN.RIGHT : BTN.LEFT;
      return pecked ? BTN.ATTACK : 0;
    });
    expect(pecked).toBeGreaterThan(0);
    const hit = ev.find((x) => x.type === 'hit' && x.target === two.f.id);
    expect(hit && hit.type === 'hit' && !hit.launch).toBe(true);
  });

  it('never has more than two birds diving at once', () => {
    const e = newRun({ dungeon: 'screen', seed: 3 });
    const h = hero(e.state);
    let most = 0;
    play(e, 30 * 30, (s) => {
      h.inv = 10_000;
      h.hp = h.maxHp;
      const n = finches(s).filter((m) => m.state === 'act' && (m.move === 'flash' || m.move === 'dive')).length;
      most = Math.max(most, n);
      return 0;
    });
    expect(most).toBe(2);
  });
});

describe('screen (dev dungeon)', () => {
  it('the bot clears it, the same way every time, and a snapshot replays it exactly', () => {
    const run = (seed: number) => {
      const e = newRun({ dungeon: 'screen', seed });
      play(e, 30 * 240, (s) => botButtons(s, 0));
      return e;
    };
    for (const seed of [1, 2, 3]) {
      const e = run(seed);
      expect(e.state.outcome).toBe('cleared');
      expect(e.state.kills.finch).toBe(6);
    }
    expect(hashState(run(5).state)).toBe(hashState(run(5).state));
    // a rollback snapshot taken mid-fight, birds in the air and bodies on platforms, steps on to
    // the same state
    const a = newRun({ dungeon: 'screen', seed: 9 });
    play(a, 300, (s) => botButtons(s, 0));
    const snap = a.snapshot();
    play(a, 300, (s) => botButtons(s, 0));
    const want = hashState(a.state);
    a.restore(snap);
    play(a, 300, (s) => botButtons(s, 0));
    expect(hashState(a.state)).toBe(want);
  });
});
