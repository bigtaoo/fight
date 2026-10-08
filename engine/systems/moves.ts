import { MOVES, SKILLS, type Move } from '../content';
import type { SimEvent } from '../events';
import { setState, type Entity } from '../state';

// Starting and running a move, shared by heroes and monsters.

export function startMove(e: Entity, id: string, events: SimEvent[], turnTo = 0): void {
  const m = MOVES[id];
  if (turnTo !== 0 && !m.air) e.facing = turnTo;
  setState(e, 'act');
  e.move = id;
  e.hitList = [];
  const slot = SKILLS.indexOf(id as (typeof SKILLS)[number]);
  if (slot >= 0 && m.cooldown) e.cd[slot] = m.cooldown;
  events.push({ type: 'swing', id: e.id, move: id });
}

/** Sets the body's speed for this tick of its move: a ground move only moves where it advances. */
export function moveVelocity(e: Entity, m: Move): void {
  if (m.air) {
    e.vy = 0;
    return;
  }
  const a = m.advance;
  e.vx = a && e.st >= a.from && e.st <= a.to ? e.facing * a.speed : 0;
  e.vy = 0;
}

/** True when `slot`'s skill is off cooldown. */
export function skillReady(e: Entity, slot: number): boolean {
  return e.cd[slot] === 0;
}
