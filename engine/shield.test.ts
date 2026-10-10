import { describe, expect, it } from 'vitest';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { newEntity, type Entity } from './state';
import { guarding } from './systems/combat';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';
import type { SimEvent } from './events';

// The shield bearer, alone with the hero in the first room of Black Wind Fort: a hit from the
// front is blocked (chip damage, no stun), one from behind lands and does not turn it, a hero
// behind it makes it turn round slowly, the rising slash breaks the guard, and the recovery
// after its own bash leaves it open.

/** The hero at `hx` facing `hf` and a shield bearer at `sx` facing `sf`, both at depth 180, holding its bash. */
function duel(hx: number, hf: number, sx: number, sf: number): { e: Engine; shield: Entity } {
  const e = newRun({ dungeon: 'heifeng', seed: 1 });
  const s = e.state;
  s.entities = s.entities.filter((x) => x.team === 0);
  const shield = newEntity(s, 'shield', 1, -1, toFp(sx), toFp(180));
  shield.facing = sf;
  shield.cd[0] = 1000;
  const h = hero(s);
  h.x = h.px = toFp(hx);
  h.y = h.py = toFp(180);
  h.facing = hf;
  return { e, shield };
}

/** Presses `btn` on the first tick, then lets go. */
const press = (btn: number) => (_: unknown, tick: number) => (tick === 1 ? btn : 0);

function hits(ev: SimEvent[]) {
  return ev.flatMap((x) => (x.type === 'hit' ? [x] : []));
}

describe('shield bearer', () => {
  it('blocks a hit from the front: a sliver of the damage and no stun', () => {
    const { e, shield } = duel(1000, 1, 1100, -1);
    let hurt = false;
    const ev = play(e, 12, (s, t) => {
      hurt ||= shield.state === 'hurt';
      return press(BTN.ATTACK)(s, t);
    });
    const [hit] = hits(ev);
    expect(hit).toMatchObject({ target: shield.id, blocked: true, launch: false });
    expect(hit.dmg).toBeLessThanOrEqual(6);
    expect(shield.maxHp - shield.hp).toBe(hit.dmg);
    expect(hurt).toBe(false);
  });

  it('a hit from behind lands in full and does not turn it', () => {
    const { e, shield } = duel(1200, -1, 1100, -1);
    const ev = play(e, 6, press(BTN.ATTACK));
    const [hit] = hits(ev);
    expect(hit).toMatchObject({ target: shield.id, blocked: false });
    expect(hit.dmg).toBeGreaterThan(25);
    expect(shield.state).toBe('hurt');
    expect(shield.facing).toBe(-1);
  });

  it('turns round slowly to a hero behind it, open from both sides meanwhile', () => {
    const { e, shield } = duel(1300, -1, 1100, -1);
    play(e, 1, () => 0);
    expect(shield.move).toBe('turn');
    expect(guarding(shield)).toBe(false);
    play(e, 14, () => 0);
    expect(shield.facing).toBe(-1);
    play(e, 2, () => 0);
    expect(shield.facing).toBe(1);
    expect(guarding(shield)).toBe(true);
  });

  it('the rising slash breaks the guard and launches it', () => {
    const { e, shield } = duel(1000, 1, 1100, -1);
    const ev = play(e, 10, press(BTN.SKILL2));
    const [hit] = hits(ev);
    expect(hit).toMatchObject({ target: shield.id, blocked: false, launch: true });
    expect(shield.state).toBe('air');
  });

  it('guards through its bash up to the strike, not in the recovery', () => {
    const { shield } = duel(1000, 1, 1100, -1);
    shield.state = 'act';
    shield.move = 'bash';
    shield.st = 16;
    expect(guarding(shield)).toBe(true);
    shield.st = 18;
    expect(guarding(shield)).toBe(false);
  });

  it('bashes a hero in front of it back', () => {
    const { e, shield } = duel(1000, 1, 1100, -1);
    shield.cd[0] = 0;
    const x0 = hero(e.state).x;
    const ev = play(e, 30, () => 0);
    expect(hits(ev)[0]).toMatchObject({ attacker: shield.id, target: hero(e.state).id, blocked: false });
    expect(x0 - hero(e.state).x).toBeGreaterThan(toFp(80));
  });
});
