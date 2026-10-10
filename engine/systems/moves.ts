import { MONSTERS, MOVES, type Move } from '../content';
import type { SimEvent } from '../events';
import { setState, type Entity } from '../state';

// Starting and running a move, shared by heroes and monsters.

/** Starts move `id`; `turnTo` is the held direction along x (0: none), `dy` along the depth,
 * which a steered move heads by. */
export function startMove(e: Entity, id: string, events: SimEvent[], turnTo = 0, dy = 0): void {
  const m = MOVES[id];
  if (turnTo !== 0 && !m.air) e.facing = turnTo;
  setState(e, 'act');
  e.move = id;
  e.hitList = [];
  // steered: along the depth only when that is all the stick says, else forward and maybe aslant
  e.aimX = m.steer && turnTo === 0 && dy !== 0 ? 0 : 1;
  e.aimY = m.steer ? dy : 0;
  if (m.inv) e.inv = Math.max(e.inv, m.inv);
  if (m.hop) {
    e.vx = -e.facing * m.hop.back;
    e.vz = m.hop.up;
  }
  events.push({ type: 'swing', id: e.id, move: id });
}

/** Sets the body's speed for this tick of its move: a ground move only moves where it advances,
 * the way it was aimed (the depth at 6/10 of the speed, as walking is slower in depth; aslant
 * at 7/10 along each). */
export function moveVelocity(e: Entity, m: Move): void {
  if (m.air) {
    // airborne: the speed it took off with (or steers) carries on
    e.vy = 0;
    return;
  }
  const a = m.advance;
  if (!a || e.st < a.from || e.st > a.to) {
    e.vx = 0;
    e.vy = 0;
    return;
  }
  const slant = e.aimX !== 0 && e.aimY !== 0 ? 7 : 10;
  e.vx = Math.trunc((e.facing * e.aimX * a.speed * slant) / 10);
  e.vy = Math.trunc((e.aimY * a.speed * 6 * slant) / 100);
}

/** Whether `e` is in a super armour window of its move, or standing or walking in the armour of
 * a monster that has it always. */
export function armored(e: Entity): boolean {
  if (e.state === 'idle' || e.state === 'walk') return e.kind !== 'hero' && MONSTERS[e.kind].armor === true;
  if (e.state !== 'act') return false;
  const w = MOVES[e.move].armor;
  return w !== undefined && e.st >= w[0] && e.st <= w[1];
}
