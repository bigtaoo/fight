import { BODIES, MOVES, WORLD } from '../content';
import type { SimEvent } from '../events';
import { setState, type Entity, type SimState } from '../state';
import { startMove } from './moves';

// Moves every unfrozen body by its speed: gravity in the air, landing, the once-only bounce
// of a launched body, sliding out of a hit, and the room's walls and floor band.

export function physicsSystem(s: SimState, events: SimEvent[]): void {
  for (const e of s.entities) {
    if (e.held) continue;
    e.x += e.vx;
    e.y += e.vy;
    if (e.z > 0 || e.vz > 0) {
      e.vz -= e.state === 'air' ? WORLD.launchGravity : WORLD.gravity;
      e.z += e.vz;
      if (e.z <= 0) {
        e.z = 0;
        land(e, events);
      }
    } else {
      e.vz = 0;
    }
    if (sliding(e)) e.vx = towardZero(e.vx, WORLD.friction);
    const hw = BODIES[e.kind].halfWidth;
    e.x = Math.min(Math.max(e.x, hw), s.roomWidth - hw);
    e.y = Math.min(Math.max(e.y, 0), WORLD.depth);
  }
}

function sliding(e: Entity): boolean {
  return e.state === 'hurt' || e.state === 'down' || e.state === 'getup' || e.state === 'dead' || (e.state === 'air' && e.z === 0);
}

function towardZero(v: number, by: number): number {
  return v > 0 ? Math.max(0, v - by) : Math.min(0, v + by);
}

function land(e: Entity, events: SimEvent[]): void {
  if (e.state === 'air') {
    if (!e.bounced && e.vz < -WORLD.bounceSpeed) {
      e.bounced = true;
      e.vz = Math.trunc((-e.vz * 35) / 100);
      return;
    }
    e.vz = 0;
    e.juggle = 0;
    e.bounced = false;
    if (e.hp <= 0) setState(e, 'dead');
    else {
      setState(e, 'down');
      e.timer = WORLD.downTicks;
      events.push({ type: 'down', id: e.id });
    }
    return;
  }
  e.vz = 0;
  if (e.state === 'jump' || (e.state === 'act' && MOVES[e.move].air)) {
    const then = e.state === 'act' ? MOVES[e.move].land : undefined;
    e.airAtk = false;
    e.vx = 0;
    setState(e, 'idle');
    events.push({ type: 'land', id: e.id });
    if (then) startMove(e, then, events);
  }
}
