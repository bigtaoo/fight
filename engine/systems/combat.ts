import { BODIES, MONSTERS, MOVES, type HitBox, type HitData } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { randRange } from '../math/prng';
import { hittable, setState, type Entity, type SimState } from '../state';
import { armored } from './moves';

// Hit detection on the 2.5D floor and what a hit does. A hit lands when the attack box and the
// target overlap in x, the two are within the box's depth in y, and their heights overlap in z.
// Attackers are checked in array order, targets too, so every machine resolves a tick the same.
// A shield bearer guarding takes a hit from the front as a block: a sliver of the damage, the
// hitstop, no stun. It is not turned by hits, so a hero behind it stays behind it. A body under
// super armour takes the full damage and the hitstop but is not stunned, turned or launched.

/** A killed body that was on the ground pops up this fast before it falls dead. */
const DEATH_POP = toFp(16);
/** Each further hit in one juggle lifts this many percent less, down to JUGGLE_FLOOR. */
const JUGGLE_DECAY = 12;
const JUGGLE_FLOOR = 30;

export function combatSystem(s: SimState, events: SimEvent[]): void {
  for (const a of s.entities) {
    if (a.held || a.state !== 'act') continue;
    const m = MOVES[a.move];
    if (!m.box || a.st < m.active[0] || a.st > m.active[1]) continue;
    if (m.rehit && a.st > m.active[0] && (a.st - m.active[0]) % m.rehit === 0) a.hitList = [];
    for (const t of s.entities) {
      if (t.team === a.team || !hittable(t) || a.hitList.includes(t.id)) continue;
      if (!overlaps(a, a.facing, m.box, t)) continue;
      a.hitList.push(t.id);
      a.stop = Math.max(a.stop, m.stop);
      applyHit(s, events, a, a.facing, t, m);
    }
  }
}

/** Whether box `b` of something at `a` (a body, a projectile) heading `facing` touches body `t`. */
export function overlaps(a: { x: number; y: number; z: number }, facing: number, b: HitBox, t: Entity): boolean {
  const x0 = facing > 0 ? a.x + b.x0 : a.x - b.x1;
  const x1 = facing > 0 ? a.x + b.x1 : a.x - b.x0;
  const body = BODIES[t.kind];
  if (x1 < t.x - body.halfWidth || x0 > t.x + body.halfWidth) return false;
  if (Math.abs(a.y - t.y) > b.depth) return false;
  return a.z + b.z0 <= t.z + body.height && a.z + b.z1 >= t.z;
}

/** Whether `e` has its shield up: on its feet, standing, walking, or in its own attack up to the
 * end of the strike (the recovery after it, and turning round, leave it open). */
export function guarding(e: Entity): boolean {
  if (e.kind === 'hero' || !MONSTERS[e.kind].guard || e.z > 0) return false;
  if (e.state === 'idle' || e.state === 'walk') return true;
  return e.state === 'act' && e.move === MONSTERS[e.kind].attack && e.st <= MOVES[e.move].active[1];
}

/** Hit `t` with `m`, struck by `a` (a body, or the one that fired a projectile) heading `facing`. */
export function applyHit(s: SimState, events: SimEvent[], a: { id: number; team: number }, facing: number, t: Entity, m: HitData): void {
  let dmg = m.damage;
  if (a.team === 0) dmg = Math.trunc((dmg * s.config.heroDamagePct) / 100);
  dmg = Math.max(1, Math.trunc((dmg * randRange(s.rng, 'combat', 90, 110)) / 100));
  const guard = t.kind === 'hero' ? undefined : MONSTERS[t.kind].guard;
  if (guard && !m.breaks && t.facing === -facing && guarding(t)) {
    const chip = Math.max(1, Math.trunc((dmg * guard.pct) / 100));
    // a block that would kill is a hit: the last blow goes through
    if (chip < t.hp) {
      t.hp -= chip;
      t.stop = m.stop;
      events.push({ type: 'hit', attacker: a.id, target: t.id, dmg: chip, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: false, blocked: true, armor: false });
      return;
    }
  }
  t.hp -= dmg;
  t.stop = m.stop;
  if (t.hp > 0 && armored(t)) {
    events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: false, blocked: false, armor: true });
    return;
  }
  if (!guard) t.facing = -facing;

  const airborne = t.z > 0 || t.state === 'air';
  const kill = t.hp <= 0;
  if (kill || airborne || m.launch > 0) {
    const lift = airborne
      ? Math.trunc((m.lift * Math.max(JUGGLE_FLOOR, 100 - JUGGLE_DECAY * t.juggle)) / 100)
      : m.launch > 0 ? m.launch : DEATH_POP;
    setState(t, 'air');
    t.vz = lift;
    t.vx = facing * Math.trunc(m.push / 2);
    t.vy = 0;
    t.juggle++;
  } else {
    setState(t, 'hurt');
    t.timer = m.hitstun;
    t.vx = facing * m.push;
    t.vy = 0;
  }
  events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: t.state === 'air', blocked: false, armor: false });
  if (kill) events.push(t.team === 0 ? { type: 'heroDown', id: t.id } : { type: 'death', id: t.id });
}
