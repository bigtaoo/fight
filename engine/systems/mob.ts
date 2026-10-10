import { BODIES, CROWD, MONSTERS, MOVES, WORLD, type BossMove, type Monster, type MonsterKind } from '../content';
import type { SimEvent } from '../events';
import { randInt, randRange } from '../math/prng';
import { newEntity, setState, type Entity, type SimState } from '../state';
import { moveVelocity, startMove } from './moves';

// Monster brains, picked by each kind's `brain` in content.ts. A melee monster walks up to the
// nearest hero, lines up in depth and swings, then waits a rolled cooldown; in a crowd it lines up
// beside the ones ahead of it instead (see lane). A ranged one keeps
// its distance and shoots down its lane once lined up; a hero closing in makes it hop back, or
// back off on foot while the hop is not ready (not into a wall, though: cornered, it stands and
// shoots). A guard one fights like a melee one behind its shield, but does not just face the hero:
// with the hero behind it, it plays its slow turn (open from both sides until it is round). A
// still one stands.

function nearestHero(s: SimState, m: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = 0;
  for (const e of s.entities) {
    if (e.team !== 0 || e.hp <= 0) continue;
    const d = Math.abs(e.x - m.x) + Math.abs(e.y - m.y);
    if (!best || d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

export function mobControl(s: SimState, m: Entity, events: SimEvent[]): void {
  const def = MONSTERS[m.kind as MonsterKind];
  if (def.immortal) m.hp = m.maxHp;
  if (def.brain === 'still') {
    m.vx = 0;
    m.vy = 0;
    return;
  }
  if (m.state === 'act') {
    const mv = MOVES[m.move];
    moveVelocity(m, mv);
    if (m.st >= mv.total) {
      if (mv.turn) m.facing = -m.facing;
      setState(m, 'idle');
      if (mv.then) chain(s, m, mv.then, events);
    }
    return;
  }
  if (def.boss && m.phase === 0 && m.hp * 100 <= m.maxHp * def.boss.phase2Pct) return phase2(s, m, def, events);
  const t = nearestHero(s, m);
  if (!t) {
    m.vx = 0;
    m.vy = 0;
    if (m.state !== 'idle') setState(m, 'idle');
    return;
  }
  const dx = t.x - m.x;
  const dy = t.y - m.y;
  if (def.guard && dx * m.facing < 0) {
    m.vx = 0;
    m.vy = 0;
    startMove(m, def.guard.turn, events);
    return;
  }
  if (dx !== 0) m.facing = Math.sign(dx);
  if (def.brain === 'ranged') return ranged(s, m, def, dx, dy, events);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (def.boss && m.cd[0] === 0 && pickMove(s, m, def, ax, ay, events)) return;
  if (!def.boss && ax <= def.range && ay <= def.alignY && m.cd[0] === 0) {
    startMove(m, def.attack, events);
    m.cd[0] = randRange(s.rng, 'ai', def.cooldown[0], def.cooldown[1]);
    return;
  }
  // close in to a bit inside striking range; too close, step back. Waiting in a lane beside
  // the hero's, just out of its reach, so the crowd queues aslant instead of all closing in
  const ly = def.brain === 'melee' ? lane(s, m, t) : t.y;
  const want = ly === t.y ? Math.trunc((def.range * 3) / 4) : def.range + Math.trunc(CROWD.sepX / 2);
  m.vx = ax > want ? Math.sign(dx) * def.walkX : ax < CROWD.sepX ? -Math.sign(dx) * Math.trunc(def.walkX / 2) : 0;
  const ldy = ly - m.y;
  m.vy = Math.abs(ldy) > Math.trunc(def.alignY / 2) ? Math.sign(ldy) * def.walkY : 0;
  const next = m.vx === 0 && m.vy === 0 ? 'idle' : 'walk';
  if (next !== m.state) setState(m, next);
}

/** The depth melee monster `m` lines up at against hero `t` (see CROWD): the hero's own, or, taken
 * by a monster nearer the hero on the same side, the free lane beside it nearest `m`, so a crowd
 * spreads out in depth instead of stacking on one line. All taken: the hero's. */
function lane(s: SimState, m: Entity, t: Entity): number {
  const side = m.x < t.x ? -1 : 1;
  const mine = Math.abs(m.x - t.x);
  const taken = (y: number) =>
    s.entities.some((o) => {
      if (o === m || o.team !== 1 || o.hp <= 0 || (o.x < t.x ? -1 : 1) !== side) return false;
      const d = Math.abs(o.x - t.x);
      return (d < mine || (d === mine && o.id < m.id)) && Math.abs(o.y - y) < CROWD.sepY;
    });
  if (!taken(t.y)) return t.y;
  // the side nearer where m stands first
  const first = m.y < t.y ? -1 : 1;
  for (let k = 1; k <= CROWD.lanes; k++) {
    for (const dir of [first, -first]) {
      const y = t.y + dir * k * CROWD.laneY;
      if (y >= 0 && y <= WORLD.depth && !taken(y)) return y;
    }
  }
  return t.y;
}

function ranged(s: SimState, m: Entity, def: Monster, dx: number, dy: number, events: SimEvent[]): void {
  const r = def.ranged!;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const away = -Math.sign(dx);
  const hw = BODIES[m.kind].halfWidth;
  // room to back off: the wall behind is more than a hop away
  const room = away > 0 ? s.roomWidth - hw - m.x : m.x - hw;
  const cornered = room < r.flee;
  if (ax <= r.flee && ay <= r.fleeY && m.cd[1] === 0 && !cornered) {
    startMove(m, r.backstep, events);
    m.cd[1] = r.backstepCd;
    return;
  }
  if (ax <= def.range && ay <= def.alignY && m.cd[0] === 0) {
    startMove(m, def.attack, events);
    m.cd[0] = randRange(s.rng, 'ai', def.cooldown[0], def.cooldown[1]);
    return;
  }
  m.vx = ax < r.keep && !cornered ? away * def.walkX : ax > def.range ? -away * def.walkX : 0;
  m.vy = ay > Math.trunc(def.alignY / 2) ? Math.sign(dy) * def.walkY : 0;
  const next = m.vx === 0 && m.vy === 0 ? 'idle' : 'walk';
  if (next !== m.state) setState(m, next);
}

/** Draws a boss move for the distance to the hero, among those it is in reach and line for:
 * false when there is none (it walks on). */
function pickMove(s: SimState, m: Entity, def: Monster, ax: number, ay: number, events: SimEvent[]): boolean {
  const b = def.boss!;
  const band = ax <= b.bands[0] ? 0 : ax <= b.bands[1] ? 1 : 2;
  const weight = (bm: BossMove) => (ax <= bm.reach && ay <= bm.alignY ? bm.weight[band] : 0);
  let total = 0;
  for (const bm of b.moves) total += weight(bm);
  if (total === 0) return false;
  let r = randInt(s.rng, 'ai', total);
  const bm = b.moves.find((x) => (r -= weight(x)) < 0)!;
  m.vx = 0;
  m.vy = 0;
  startMove(m, m.phase > 0 ? bm.fast : bm.move, events);
  const cd = randRange(s.rng, 'ai', def.cooldown[0], def.cooldown[1]);
  m.cd[0] = m.phase > 0 ? Math.trunc((cd * b.fastPct) / 100) : cd;
  return true;
}

/** Starts the part that follows a move by itself; a leap is aimed to land on the nearest hero. */
function chain(s: SimState, m: Entity, id: string, events: SimEvent[]): void {
  startMove(m, id, events);
  const mv = MOVES[id];
  const t = nearestHero(s, m);
  if (!mv.leap || !mv.hop || !t) return;
  if (t.x !== m.x) m.facing = Math.sign(t.x - m.x);
  const flight = Math.trunc((2 * mv.hop.up) / WORLD.gravity);
  m.vx = Math.max(-mv.leap, Math.min(mv.leap, Math.trunc((t.x - m.x) / flight)));
}

/** The boss's second phase starts: it roars and its help comes in, from the wall farther from the hero. */
function phase2(s: SimState, m: Entity, def: Monster, events: SimEvent[]): void {
  const b = def.boss!;
  m.phase = 1;
  m.vx = 0;
  m.vy = 0;
  startMove(m, b.roar, events);
  events.push({ type: 'phase', id: m.id, phase: m.phase });
  const t = nearestHero(s, m);
  const fromRight = !t || t.x < Math.trunc(s.roomWidth / 2);
  for (const sp of b.summon) {
    const help = newEntity(s, sp.kind, 1, -1, fromRight ? s.roomWidth - sp.x : sp.x, sp.y);
    const first = MONSTERS[sp.kind].firstCooldown;
    if (first) help.cd[0] = randRange(s.rng, 'ai', first[0], first[1]);
  }
}

/** Monsters standing on the same spot push apart, in array order. */
export function separate(s: SimState): void {
  const mobs = s.entities.filter((e) => e.team === 1 && e.hp > 0 && e.z === 0 && !e.held);
  for (let i = 0; i < mobs.length; i++) {
    for (let j = i + 1; j < mobs.length; j++) {
      const a = mobs[i];
      const b = mobs[j];
      const dx = b.x - a.x;
      if (Math.abs(dx) >= CROWD.sepX || Math.abs(b.y - a.y) >= CROWD.sepY) continue;
      const dir = dx === 0 ? 1 : Math.sign(dx);
      a.x -= dir * CROWD.push;
      b.x += dir * CROWD.push;
    }
  }
}
