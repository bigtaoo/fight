import { describe, expect, it } from 'vitest';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';
import type { Entity } from './state';

// The archer and its arrows, alone with the hero in the first room of Black Wind Fort: it shoots
// down its lane, stepping out of the lane dodges, the arrow is spent on its first hit, a hero
// closing in makes it hop back, and backed against a wall it stands its ground.

/** The hero at `hx` and one archer at `ax`, both at depth 180, the archer ready to shoot. */
function duel(hx: number, ax: number): { e: Engine; archer: Entity } {
  const e = newRun({ dungeon: 'heifeng', seed: 1 });
  const s = e.state;
  s.entities = s.entities.filter((x) => x.team === 0 || x.kind === 'archer');
  const archer = s.entities.find((x) => x.kind === 'archer')!;
  const h = hero(s);
  h.x = h.px = toFp(hx);
  archer.x = archer.px = toFp(ax);
  h.y = h.py = archer.y = archer.py = toFp(180);
  archer.cd[0] = 0;
  return { e, archer };
}

describe('archer', () => {
  it('shoots a hero in its lane; the arrow is spent on the hit', () => {
    const { e, archer } = duel(900, 1500);
    const ev = play(e, 60, () => 0);
    const fire = ev.find((x) => x.type === 'fire');
    expect(fire).toMatchObject({ owner: archer.id, shot: 'arrow' });
    const hit = ev.find((x) => x.type === 'hit');
    expect(hit).toMatchObject({ attacker: archer.id, target: hero(e.state).id, dir: -1 });
    expect(e.state.shots).toHaveLength(0);
    expect(hero(e.state).hp).toBeLessThan(hero(e.state).maxHp);
  });

  it('stepping out of the lane while it draws dodges the arrow', () => {
    const { e, archer } = duel(900, 1500);
    let fired = false;
    const ev = play(e, 100, (s) => {
      fired ||= s.shots.length > 0;
      // walk down once the draw has started
      return archer.state === 'act' || fired ? BTN.DOWN : 0;
    });
    expect(ev.some((x) => x.type === 'fire')).toBe(true);
    expect(ev.some((x) => x.type === 'hit')).toBe(false);
    expect(hero(e.state).hp).toBe(hero(e.state).maxHp);
    // flown out past the hero into the wall
    expect(e.state.shots).toHaveLength(0);
  });

  it('hops back from a hero who closes in, then keeps its distance', () => {
    const { e, archer } = duel(1100, 1500);
    archer.cd[0] = 1000;
    const x0 = archer.x;
    let rose = false;
    let hopped = false;
    // chase it until it hops, then stand
    play(e, 90, () => {
      rose ||= archer.z > 0;
      hopped ||= archer.move === 'hop';
      return hopped ? 0 : BTN.RIGHT;
    });
    expect(hopped).toBe(true);
    expect(rose).toBe(true);
    expect(archer.x - x0).toBeGreaterThan(toFp(150));
    expect(archer.x - hero(e.state).x).toBeGreaterThan(toFp(300));
  });

  it('backed against the wall, it does not hop', () => {
    const { e, archer } = duel(2000, 2350);
    archer.cd[0] = 1000;
    let hopped = false;
    play(e, 60, () => {
      hopped ||= archer.move === 'hop';
      return 0;
    });
    expect(hopped).toBe(false);
    expect(archer.x).toBeGreaterThan(toFp(2300));
  });
});
