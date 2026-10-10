import { describe, expect, it } from 'vitest';
import { DUNGEONS, MONSTERS, MOVES, SHOTS } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { newEntity, type Entity } from './state';
import { applyHit } from './systems/combat';
import { startMove } from './systems/moves';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';
import type { SimEvent } from './events';

// The chief, alone with the hero in the hall of Black Wind Fort: super armour except in the
// recovery of its moves, a chop that knocks down, a charge along its lane, a slam that leaps onto
// the hero and sends a shockwave along the floor, a quick end to juggles, moves drawn by the
// distance to the hero, and the second phase at half health.

/** The hero at `hx` facing `hf` and the chief at `cx` facing `cf`, both at depth 180, the chief
 * holding its moves. */
function duel(hx: number, hf: number, cx: number, cf: number, seed = 1): { e: Engine; chief: Entity } {
  const e = newRun({ dungeon: 'heifeng', seed });
  const s = e.state;
  s.entities = s.entities.filter((x) => x.team === 0);
  s.roomWidth = DUNGEONS.heifeng.rooms[5].width;
  const chief = newEntity(s, 'chief', 1, -1, toFp(cx), toFp(180));
  chief.facing = cf;
  chief.cd[0] = 1000;
  const h = hero(s);
  h.x = h.px = toFp(hx);
  h.y = h.py = toFp(180);
  h.facing = hf;
  return { e, chief };
}

/** Presses `btn` on the first tick, then lets go. */
function press(btn: number) {
  let first = true;
  return () => (first ? ((first = false), btn) : 0);
}
const idle = () => 0;

function hits(ev: SimEvent[]) {
  return ev.flatMap((x) => (x.type === 'hit' ? [x] : []));
}

describe('the chief', () => {
  it('is in super armour standing: full damage, no stun', () => {
    const { e, chief } = duel(1000, 1, 1100, -1);
    const ev = play(e, 8, press(BTN.ATTACK));
    const [hit] = hits(ev);
    expect(hit).toMatchObject({ target: chief.id, armor: true, launch: false });
    expect(chief.maxHp - chief.hp).toBe(hit.dmg);
    expect(chief.state).not.toBe('hurt');
  });

  it('is open in the recovery of a move', () => {
    const { e, chief } = duel(1000, 1, 1100, 1);
    startMove(chief, 'chop', []);
    const mv = MOVES.chop;
    play(e, mv.active[1] + 1, idle);
    expect(chief.st).toBeGreaterThan(mv.active[1]);
    chief.facing = -1;
    const ev = play(e, 6, press(BTN.ATTACK));
    expect(hits(ev)[0]).toMatchObject({ target: chief.id, armor: false });
    expect(chief.state).toBe('hurt');
  });

  it('chops wide in front and knocks the hero down', () => {
    const { e, chief } = duel(1300, -1, 1100, 1);
    startMove(chief, 'chop', []);
    const ev = play(e, MOVES.chop.active[1] + 30, idle);
    expect(hits(ev)[0]).toMatchObject({ attacker: chief.id, launch: true });
    expect(ev.some((x) => x.type === 'down' && x.id === hero(e.state).id)).toBe(true);
  });

  it('charges across half the room along its lane: a step out of it is enough', () => {
    const run = (dy: number) => {
      const { e, chief } = duel(1400, -1, 400, 1);
      hero(e.state).y = toFp(180 + dy);
      startMove(chief, 'charge', []);
      const ev = play(e, MOVES.charge.total, idle);
      return { chief, hit: hits(ev).some((h) => h.attacker === chief.id) };
    };
    const inLane = run(20);
    expect(inLane.hit).toBe(true);
    const out = run(70);
    expect(out.hit).toBe(false);
    expect(out.chief.x - toFp(400)).toBeGreaterThan(toFp(850));
  });

  it('a jump clears the charge', () => {
    const { e, chief } = duel(900, -1, 400, 1);
    startMove(chief, 'charge', []);
    const mv = MOVES.charge;
    // jump some five ticks before the charge reaches the hero
    const jump = (s: Parameters<typeof hero>[0]) => chief.st >= mv.active[0] && hero(s).x - chief.x < toFp(320) && hero(s).state !== 'jump' && hero(s).z === 0;
    const ev = play(e, mv.total, (s) => (chief.st <= mv.active[1] && jump(s) ? BTN.JUMP : 0));
    expect(hits(ev).some((h) => h.attacker === chief.id)).toBe(false);
    expect(chief.x).toBeGreaterThan(hero(e.state).x);
  });

  it('leaps onto the hero and lands with a shockwave both ways', () => {
    const { e, chief } = duel(1500, -1, 1100, 1);
    startMove(chief, 'slam', []);
    const ev = play(e, MOVES.slam.total + 40, idle);
    expect(Math.abs(chief.x - toFp(1500))).toBeLessThan(toFp(40));
    expect(ev.filter((x) => x.type === 'fire' && x.shot === 'quake')).toHaveLength(2);
    expect(hits(ev).some((h) => h.attacker === chief.id && h.launch)).toBe(true);
  });

  it('the shockwave runs along the floor: it hits a hero standing in its way, not one jumping over it', () => {
    const run = (jump: boolean) => {
      const { e, chief } = duel(1350, -1, 1100, 1);
      startMove(chief, 'slamLand', []);
      const near = (q: { x: number }) => Math.abs(q.x - hero(e.state).x) < toFp(130);
      const ev = play(e, 30, (s) => (jump && s.shots.some(near) && hero(s).z === 0 ? BTN.JUMP : 0));
      return hits(ev).filter((h) => h.attacker === chief.id);
    };
    expect(run(false)).toHaveLength(1);
    expect(run(true)).toHaveLength(0);
    expect(SHOTS.quake.box.z1).toBeLessThan(toFp(60));
  });

  it('falls out of a juggle quickly', () => {
    const { e, chief } = duel(1000, 1, 1100, -1);
    chief.state = 'air';
    chief.z = toFp(100);
    chief.juggle = 3;
    applyHit(e.state, [], hero(e.state), 1, chief, MOVES.atk1);
    expect(chief.vz).toBe(0);
  });

  it('picks its moves by distance: only the charge from afar, nothing from afar out of line', () => {
    const picks = (hx: number, dy: number) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        const { e, chief } = duel(hx, -1, 300, 1, seed);
        hero(e.state).y = toFp(180 + dy);
        chief.cd[0] = 0;
        play(e, 1, idle);
        seen.add(chief.state === 'act' ? chief.move : chief.state);
      }
      return [...seen].sort();
    };
    expect(picks(1500, 0)).toEqual(['charge']);
    expect(picks(1500, 100)).toEqual(['walk']);
    expect(picks(500, 0)).toEqual(['charge', 'chop', 'slam']);
    expect(picks(800, 100)).toEqual(['slam']);
  });

  it('at half health roars, calls in two bandits from the far wall and moves quicker', () => {
    const { e, chief } = duel(400, 1, 1100, -1);
    chief.hp = Math.trunc(chief.maxHp / 2);
    const ev = play(e, 1, idle);
    expect(ev).toContainEqual({ type: 'phase', id: chief.id, phase: 1 });
    expect(chief.move).toBe('roar');
    const help = e.state.entities.filter((x) => x.kind === 'bandit');
    expect(help).toHaveLength(2);
    for (const b of help) expect(b.x).toBeGreaterThan(e.state.roomWidth - toFp(400));
    play(e, MOVES.roar.total, idle);
    chief.cd[0] = 0;
    hero(e.state).x = chief.x - toFp(200);
    play(e, 2, idle);
    expect(chief.move).toMatch(/F$/);
    expect(MOVES.chopF.active[0]).toBeLessThan(MOVES.chop.active[0]);
    expect(MONSTERS.chief.boss!.summon).toHaveLength(2);
  });
});
