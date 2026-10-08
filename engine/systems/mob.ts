import { BANDIT, MOVES } from '../content';
import type { SimEvent } from '../events';
import { randRange } from '../math/prng';
import { setState, type Entity, type SimState } from '../state';
import { moveVelocity, startMove } from './moves';

// Monster brains. The bandit walks up to the nearest hero, lines up in depth and slashes,
// then waits a rolled cooldown. Dummies stand still.

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
  if (m.kind === 'dummy') {
    m.vx = 0;
    m.vy = 0;
    m.hp = m.maxHp;
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
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= BANDIT.range && ay <= BANDIT.alignY && m.cd[0] === 0) {
    startMove(m, 'slash', events);
    m.cd[0] = randRange(s.rng, 'ai', BANDIT.cooldown[0], BANDIT.cooldown[1]);
    return;
  }
  // close in to a bit inside striking range; too close, step back
  const want = Math.trunc((BANDIT.range * 3) / 4);
  m.vx = ax > want ? Math.sign(dx) * BANDIT.walkX : ax < BANDIT.sepX ? -Math.sign(dx) * Math.trunc(BANDIT.walkX / 2) : 0;
  m.vy = ay > Math.trunc(BANDIT.alignY / 2) ? Math.sign(dy) * BANDIT.walkY : 0;
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
      if (Math.abs(dx) >= BANDIT.sepX || Math.abs(b.y - a.y) >= BANDIT.sepY) continue;
      const dir = dx === 0 ? 1 : Math.sign(dx);
      a.x -= dir * BANDIT.sepPush;
      b.x += dir * BANDIT.sepPush;
    }
  }
}
