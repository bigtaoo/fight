import { BODIES, MOVES, type Move } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { randRange } from '../math/prng';
import { hittable, setState, type Entity, type SimState } from '../state';

// Hit detection on the 2.5D floor and what a hit does. A hit lands when the attack box and the
// target overlap in x, the two are within the box's depth in y, and their heights overlap in z.
// Attackers are checked in array order, targets too, so every machine resolves a tick the same.

/** A killed body that was on the ground pops up this fast before it falls dead. */
const DEATH_POP = toFp(16);
/** Each further hit in one juggle lifts this many percent less, down to JUGGLE_FLOOR. */
const JUGGLE_DECAY = 12;
const JUGGLE_FLOOR = 30;

export function combatSystem(s: SimState, events: SimEvent[]): void {
  for (const a of s.entities) {
    if (a.held || a.state !== 'act') continue;
    const m = MOVES[a.move];
    if (a.st < m.active[0] || a.st > m.active[1]) continue;
    for (const t of s.entities) {
      if (t.team === a.team || !hittable(t) || a.hitList.includes(t.id)) continue;
      if (!overlaps(a, m, t)) continue;
      applyHit(s, events, a, t, m);
    }
  }
}

export function overlaps(a: Entity, m: Move, t: Entity): boolean {
  const b = m.box;
  const x0 = a.facing > 0 ? a.x + b.x0 : a.x - b.x1;
  const x1 = a.facing > 0 ? a.x + b.x1 : a.x - b.x0;
  const body = BODIES[t.kind];
  if (x1 < t.x - body.halfWidth || x0 > t.x + body.halfWidth) return false;
  if (Math.abs(a.y - t.y) > b.depth) return false;
  return a.z + b.z0 <= t.z + body.height && a.z + b.z1 >= t.z;
}

function applyHit(s: SimState, events: SimEvent[], a: Entity, t: Entity, m: Move): void {
  let dmg = m.damage;
  if (a.team === 0) dmg = Math.trunc((dmg * s.config.heroDamagePct) / 100);
  dmg = Math.max(1, Math.trunc((dmg * randRange(s.rng, 'combat', 90, 110)) / 100));
  t.hp -= dmg;
  a.hitList.push(t.id);
  a.stop = Math.max(a.stop, m.stop);
  t.stop = m.stop;
  t.facing = -a.facing;

  const airborne = t.z > 0 || t.state === 'air';
  const kill = t.hp <= 0;
  if (kill || airborne || m.launch > 0) {
    const lift = airborne
      ? Math.trunc((m.lift * Math.max(JUGGLE_FLOOR, 100 - JUGGLE_DECAY * t.juggle)) / 100)
      : m.launch > 0 ? m.launch : DEATH_POP;
    setState(t, 'air');
    t.vz = lift;
    t.vx = a.facing * Math.trunc(m.push / 2);
    t.vy = 0;
    t.juggle++;
  } else {
    setState(t, 'hurt');
    t.timer = m.hitstun;
    t.vx = a.facing * m.push;
    t.vy = 0;
  }
  events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, stop: m.stop, launch: t.state === 'air' });
  if (kill) events.push(t.team === 0 ? { type: 'heroDown', id: t.id } : { type: 'death', id: t.id });
}
