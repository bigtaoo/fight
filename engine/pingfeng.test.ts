import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DUNGEONS, MONSTERS } from './content';
import { hashState } from './hash';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hittable, type SimState } from './state';
import { hero, newRun, play } from './testUtil';

// 1-3, inside the screen: finches hidden in the blossom start out as the hero comes near, a lone
// finch perched on a lily pad startles the rest of the pond when it is hit (or the hero comes
// near), big sparrows peck at the ground until then, and the golden pheasant's moves; the bot
// clears the whole of it.

const foes = (s: SimState) => s.entities.filter((m) => m.team === 1 && m.hp > 0);

/** A pingfeng run with the hero in room `room` (its spawns fresh), standing at x, y. */
function inRoom(room: number, x: number, y = 180) {
  const e = newRun({ dungeon: 'pingfeng', seed: 1 });
  play(e, 1, () => 0);
  const s = e.state;
  if (room > 0) {
    // clear the rooms before it by hand: take out what is there and walk on through the doors
    for (let r = 0; r < room; r++) {
      s.entities = s.entities.filter((m) => m.team !== 1);
      s.items = [];
      const h = hero(s);
      h.x = h.px = s.roomWidth - toFp(200);
      play(e, 60, (st) => (st.room === r ? BTN.RIGHT : 0));
      expect(s.room).toBe(r + 1);
    }
  }
  const h = hero(s);
  h.x = h.px = toFp(x);
  h.y = h.py = toFp(y);
  return { e, s, h };
}

describe('pingfeng (1-3)', () => {
  it('finches hidden in the blossom start out only as the hero comes near', () => {
    const { e, s } = inRoom(0, 200);
    const hidden = foes(s);
    expect(hidden).toHaveLength(6);
    expect(hidden.every((m) => m.lurk > 0 && !hittable(m) && m.z > 0)).toBe(true);
    play(e, 30, () => 0);
    expect(foes(s).every((m) => m.lurk > 0)).toBe(true);
    // walking on: the nearest pair first
    play(e, 90, () => BTN.RIGHT);
    const out = foes(s).filter((m) => m.lurk === 0);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThan(6);
  });

  it('the perched finch is there to hit; hitting it startles the rest of the pond', () => {
    const { e, s, h } = inRoom(1, 200);
    const perched = foes(s).find((m) => m.lurk < 0)!;
    const lotus = foes(s).filter((m) => m.lurk > 0);
    expect(hittable(perched)).toBe(true);
    expect(lotus).toHaveLength(5);
    expect(lotus.every((m) => !hittable(m))).toBe(true);
    // nothing wakes while the hero keeps away
    play(e, 30, () => 0);
    expect(perched.lurk).toBeLessThan(0);
    // the flying wave out of the way; the hero right up against the perched one, lined up, hitting
    s.entities = s.entities.filter((m) => m.team !== 1 || m.lurk !== 0);
    h.x = h.px = perched.x - toFp(80);
    h.y = h.py = perched.y;
    h.z = h.pz = perched.z;
    h.facing = 1;
    perched.lurk = -1; // only a hit wakes it now, not the hero standing beside it
    play(e, 6, (_, t) => (t % 2 ? BTN.ATTACK : 0));
    expect(perched.lurk).toBe(0);
    expect(lotus.every((m) => m.lurk === 0)).toBe(true);
  });

  it('coming near the perched finch startles the pond too', () => {
    const { e, s } = inRoom(1, 200);
    s.entities = s.entities.filter((m) => m.team !== 1 || m.lurk !== 0);
    play(e, 300, () => BTN.RIGHT);
    expect(foes(s).every((m) => m.lurk === 0)).toBe(true);
  });

  it('big sparrows peck at the ground until the hero comes near, with potions behind the rocks', () => {
    const { e, s } = inRoom(2, 200);
    const big = foes(s).filter((m) => m.kind === 'bigfinch');
    expect(big).toHaveLength(2);
    expect(foes(s).filter((m) => m.kind === 'finch')).toHaveLength(8);
    expect(s.items).toHaveLength(2);
    const at = big.map((m) => m.x);
    play(e, 30, () => 0);
    expect(big.map((m) => m.x)).toEqual(at);
    expect(big.every((m) => m.lurk < 0 && hittable(m))).toBe(true);
  });

  it('the pheasant sweeps behind it as far as in front, flies up and comes down on the hero, and throws feathers along its lane', () => {
    const { e, s } = inRoom(3, 300);
    const p = foes(s).find((m) => m.kind === 'pheasant')!;
    expect(MONSTERS.pheasant.elite).toBe(true);
    expect(s.config.dungeon === 'pingfeng' && s.room === DUNGEONS.pingfeng.boss).toBe(true);
    const seen = new Set<string>();
    let feathers = 0;
    let highest = 0;
    // a hero that only keeps near it, in and out of its reach: the pheasant shows its whole set
    play(e, 30 * 60, (st, t) => {
      if (p.move) seen.add(p.move);
      highest = Math.max(highest, p.z);
      feathers = Math.max(feathers, st.shots.filter((x) => x.kind === 'feather').length);
      hero(st).hp = hero(st).maxHp;
      const h = hero(st);
      const far = Math.trunc(t / 90) % 2 ? toFp(700) : toFp(120);
      const dx = p.x - h.x;
      return (Math.abs(dx) > far ? (dx > 0 ? BTN.RIGHT : BTN.LEFT) : 0) | (p.y > h.y + toFp(20) ? BTN.DOWN : p.y < h.y - toFp(20) ? BTN.UP : 0);
    });
    for (const id of ['tail', 'soar', 'soarAir', 'soarLand', 'fan', 'fan2', 'fan3']) expect(seen.has(id), id).toBe(true);
    expect(highest).toBeGreaterThan(toFp(300));
    expect(feathers).toBeGreaterThanOrEqual(1);
  });

  it('the bot clears it, the same way every time', () => {
    for (const seed of [1, 2, 3]) {
      const run = () => {
        const e = newRun({ dungeon: 'pingfeng', seed });
        let rooms = 0;
        const ev = play(e, 30 * 400, (s) => botButtons(s, 0));
        for (const x of ev) if (x.type === 'roomEnter') rooms++;
        return { outcome: e.state.outcome, rooms, tick: e.state.tick, hash: hashState(e.state), clear: ev.some((x) => x.type === 'dungeonClear') };
      };
      const a = run();
      expect(a.outcome, `seed ${seed}`).toBe('cleared');
      expect(a.clear).toBe(true);
      expect(a.rooms).toBe(DUNGEONS.pingfeng.rooms.length - 1);
      expect(a.tick).toBeLessThan(30 * 260);
      expect(run()).toEqual(a);
    }
  });
});
