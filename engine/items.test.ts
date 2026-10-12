import { describe, expect, it } from 'vitest';
import { ITEMS, MONSTERS, type MonsterKind } from './content';
import { botButtons } from './bot';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { newEntity } from './state';
import { enterRoom } from './systems/room';
import { hero, newRun, play } from './testUtil';

// Potions: fallen monsters leave them at their rates, a hurt hero drinks one by walking over it,
// a hero at full health leaves it lying, and leaving the room leaves them behind.

/** A run with the room's monsters gone and one `kind` on 1 health in front of the hero. */
function oneToKill(kind: MonsterKind, seed: number) {
  const e = newRun({ seed });
  const s = e.state;
  s.entities = s.entities.filter((x) => x.team === 0);
  const h = hero(s);
  const m = newEntity(s, kind, 1, -1, h.x + toFp(110), h.y);
  m.hp = 1;
  m.cd[0] = 1000;
  return e;
}

/** Cuts down a monster set up by oneToKill; what it dropped. */
function kill(kind: MonsterKind, seed: number) {
  const e = oneToKill(kind, seed);
  play(e, 20, (_, t) => (t % 4 === 1 ? BTN.ATTACK : 0));
  expect(e.state.entities.some((x) => x.team === 1 && x.hp > 0)).toBe(false);
  return e;
}

describe('items', () => {
  it('fallen monsters drop potions at about their rates; the elite always leaves a big one', () => {
    for (const kind of ['bandit', 'shield'] as const) {
      const pct = MONSTERS[kind].drop!.pct;
      let n = 0;
      for (let seed = 1; seed <= 200; seed++) n += kill(kind, seed).state.items.length;
      expect(n, kind).toBeGreaterThan(pct * 2 * 0.5);
      expect(n, kind).toBeLessThan(pct * 2 * 1.6);
    }
    const e = kill('elite', 3);
    expect(e.state.items.map((i) => i.kind)).toEqual(['bigPotion']);
  });

  it('a hurt hero drinks a potion by walking over it; one at full health leaves it', () => {
    const e = newRun({ seed: 1 });
    const s = e.state;
    s.entities = s.entities.filter((x) => x.team === 0);
    s.roomCleared = true;
    const h = hero(s);
    s.items.push({ id: s.nextId++, kind: 'potion', x: h.x + toFp(150), y: h.y, tick: 0 });
    play(e, 30, () => BTN.RIGHT);
    expect(s.items).toHaveLength(1);
    expect(h.hp).toBe(h.maxHp);

    h.hp = 300;
    const ev = play(e, 30, () => BTN.LEFT);
    expect(s.items).toHaveLength(0);
    const heal = Math.trunc((h.maxHp * ITEMS.potion.heal) / 100);
    expect(h.hp).toBe(300 + heal);
    expect(ev.filter((x) => x.type === 'pickup')).toEqual([{ type: 'pickup', id: h.id, item: expect.any(Number), kind: 'potion', heal }]);
  });

  it('never heals past full health, and the potions stay in the room they fell in', () => {
    const e = newRun({ seed: 1 });
    const s = e.state;
    s.entities = s.entities.filter((x) => x.team === 0);
    const h = hero(s);
    h.hp = h.maxHp - 10;
    s.items.push({ id: s.nextId++, kind: 'bigPotion', x: h.x, y: h.y, tick: 0 });
    play(e, 1, () => 0);
    expect(h.hp).toBe(h.maxHp);
    s.items.push({ id: s.nextId++, kind: 'potion', x: h.x + toFp(900), y: h.y, tick: 0 });
    enterRoom(s, 1, []);
    expect(s.items).toHaveLength(0);
  });
  it('the bot walks to a potion when hurt and the room is clear', () => {
    const e = newRun({ seed: 1 });
    const s = e.state;
    s.entities = s.entities.filter((x) => x.team === 0);
    s.roomCleared = true;
    const h = hero(s);
    h.hp = 500;
    s.items.push({ id: s.nextId++, kind: 'potion', x: h.x + toFp(300), y: h.y + toFp(80), tick: 0 });
    const ev = play(e, 90, (st) => botButtons(st, 0));
    expect(ev.filter((x) => x.type === 'pickup')).toHaveLength(1);
    expect(s.items).toHaveLength(0);
  });
});
