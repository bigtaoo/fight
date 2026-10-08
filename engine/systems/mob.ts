import { BODIES, CROWD, MONSTERS, MOVES, type Monster, type MonsterKind } from '../content';
import type { SimEvent } from '../events';
import { randRange } from '../math/prng';
import { setState, type Entity, type SimState } from '../state';
import { moveVelocity, startMove } from './moves';

// Monster brains, picked by each kind's `brain` in content.ts. A melee monster walks up to the
// nearest hero, lines up in depth and swings, then waits a rolled cooldown. A ranged one keeps
// its distance and shoots down its lane once lined up; a hero closing in makes it hop back, or
// back off on foot while the hop is not ready (not into a wall, though: cornered, it stands and
// shoots). A still one stands.

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
    if (m.st >= mv.total) setState(m, 'idle');
    return;
  }
  const t = nearestHero(s, m);
  if (!t) {
    m.vx = 0;
    m.vy = 0;
    if (m.state !== 'idle') setState(m, 'idle');
    return;
  }
  const dx = t.x - m.x;
  const dy = t.y - m.y;
  if (dx !== 0) m.facing = Math.sign(dx);
  if (def.brain === 'ranged') return ranged(s, m, def, dx, dy, events);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= def.range && ay <= def.alignY && m.cd[0] === 0) {
    startMove(m, def.attack, events);
    m.cd[0] = randRange(s.rng, 'ai', def.cooldown[0], def.cooldown[1]);
    return;
  }
  // close in to a bit inside striking range; too close, step back
  const want = Math.trunc((def.range * 3) / 4);
  m.vx = ax > want ? Math.sign(dx) * def.walkX : ax < CROWD.sepX ? -Math.sign(dx) * Math.trunc(def.walkX / 2) : 0;
  m.vy = ay > Math.trunc(def.alignY / 2) ? Math.sign(dy) * def.walkY : 0;
  const next = m.vx === 0 && m.vy === 0 ? 'idle' : 'walk';
  if (next !== m.state) setState(m, next);
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
