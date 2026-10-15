import { AFFIX, BODIES, MONSTERS, MOVES, TIERS, WORLD, type HitBox, type HitData, type SkillId } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { randInt, randRange } from '../math/prng';
import { hittable, setState, skillDamagePct, tierOf, type Entity, type SimState } from '../state';
import { dropAffix, hasAffix } from './affix';
import { armored } from './moves';

// Hit detection on the 2.5D floor and what a hit does. A hit lands when the attack box and the
// target overlap in x, the two are within the box's depth in y, and their heights overlap in z.
// Attackers are checked in array order, targets too, so every machine resolves a tick the same.
// A shield bearer guarding takes a hit from the front as a block: a sliver of the damage, the
// hitstop, no stun. It is not turned by hits, so a hero behind it stays behind it. A body under
// super armour takes the full damage and the hitstop but is not stunned, turned or launched.
// On the harder tiers monsters hit harder; a ward takes the hits (no stun) until it breaks, a
// monster that revives gets up once from the blow that would kill it, and one with miasma leaves
// a poison cloud where it dies (affix.ts).

/** A killed body that was on the ground pops up this fast before it falls dead. */
const DEATH_POP = toFp(16);
/** Each further hit in one juggle lifts this many percent less, down to the floor (unless the
 * monster has its own, see Monster.juggle). */
const JUGGLE = { decay: 12, floor: 30 };

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
      applyHit(s, events, a, a.facing, t, m, m.of);
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

/** Hit `t` with `m`, struck by `a` (a body, or the one that fired a projectile) heading `facing`;
 * `of`: the skill it is part of, whose level adds to a hero's damage. */
export function applyHit(s: SimState, events: SimEvent[], a: { id: number; team: number }, facing: number, t: Entity, m: HitData, of?: SkillId): void {
  let dmg = m.damage;
  let crit = false;
  if (a.team === 0) {
    const h = s.config.hero;
    dmg = Math.trunc((dmg * s.config.heroDamagePct * h.atk) / 10000);
    if (of) dmg = Math.trunc((dmg * skillDamagePct(s, of)) / 100);
    // the crit stream is drawn only by a hero that can crit, so base stats leave it untouched
    if (h.crit > 0 && randInt(s.rng, 'crit', 100) < h.crit) {
      crit = true;
      dmg = Math.trunc((dmg * h.critDmg) / 100);
    }
  } else {
    dmg = Math.trunc((dmg * TIERS[tierOf(s)].dmgPct) / 100);
  }
  dmg = Math.max(1, Math.trunc((dmg * randRange(s.rng, 'combat', 90, 110)) / 100));
  const guard = t.kind === 'hero' ? undefined : MONSTERS[t.kind].guard;
  if (guard && !m.breaks && t.facing === -facing && guarding(t)) {
    const chip = Math.max(1, Math.trunc((dmg * guard.pct) / 100));
    // a block that would kill is a hit: the last blow goes through
    if (chip < t.hp) {
      t.hp -= chip;
      t.stop = m.stop;
      tally(s, a, t);
      events.push({ type: 'hit', attacker: a.id, target: t.id, dmg: chip, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: false, blocked: true, armor: false, crit });
      return;
    }
  }
  if (t.ward > 0) {
    t.ward = Math.max(0, t.ward - dmg);
    t.stop = m.stop;
    tally(s, a, t);
    events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: false, blocked: true, armor: false, crit });
    if (t.ward === 0) events.push({ type: 'affix', id: t.id, affix: 'ward' });
    return;
  }
  t.hp -= dmg;
  t.stop = m.stop;
  if (t.hp <= 0 && t.team === 1 && hasAffix(t, 'revive')) {
    dropAffix(t, 'revive');
    t.hp = Math.trunc(t.maxHp / 2);
    events.push({ type: 'affix', id: t.id, affix: 'revive' });
  }
  tally(s, a, t);
  if (t.hp > 0 && armored(t)) {
    events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: false, blocked: false, armor: true, crit });
    return;
  }
  if (!guard) t.facing = -facing;

  const airborne = t.z > 0 || t.state === 'air';
  const kill = t.hp <= 0;
  if (kill || airborne || m.launch > 0) {
    const j = (t.kind !== 'hero' && MONSTERS[t.kind].juggle) || JUGGLE;
    const lift = airborne
      ? Math.trunc((m.lift * Math.max(j.floor, 100 - j.decay * t.juggle)) / 100)
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
  events.push({ type: 'hit', attacker: a.id, target: t.id, dmg, x: t.x, y: t.y, z: t.z, dir: facing, stop: m.stop, launch: t.state === 'air', blocked: false, armor: false, crit });
  if (kill) events.push(t.team === 0 ? { type: 'heroDown', id: t.id } : { type: 'death', id: t.id });
  if (kill && t.team === 1 && hasAffix(t, 'miasma')) {
    s.clouds.push({ id: s.nextId++, x: t.x, y: t.y, life: AFFIX.miasma.life });
    events.push({ type: 'affix', id: t.id, affix: 'miasma' });
  }
}

/** Counts a landed hit for the rating: the striking hero's combo, the struck hero's hits taken,
 * a monster's death. */
function tally(s: SimState, a: { id: number; team: number }, t: Entity): void {
  for (const p of s.players) {
    if (p.hero === a.id) {
      p.combo++;
      p.comboLeft = WORLD.comboTicks;
      if (p.combo > p.maxCombo) p.maxCombo = p.combo;
    }
    if (p.hero === t.id) p.hitsTaken++;
  }
  if (t.team === 1 && t.hp <= 0 && t.kind !== 'hero') {
    s.kills[t.kind] = (s.kills[t.kind] ?? 0) + 1;
    const drop = MONSTERS[t.kind].drop;
    if (drop && randInt(s.rng, 'drop', 100) < drop.pct) s.items.push({ id: s.nextId++, kind: drop.item, x: t.x, y: t.y, tick: s.tick });
  }
}
