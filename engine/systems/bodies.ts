import { WORLD } from '../content';
import type { SimEvent } from '../events';
import { setState, type Entity, type SimState } from '../state';
import { heroControl, quickRise, tickBuffer } from './hero';
import { mobControl } from './mob';

// The start of every tick and each body's own step: hitstop, timers, cooldowns, the reaction
// states shared by heroes and monsters, then the hero's controls or the monster's brain.

/** Remembers where every body was (for interpolation) and freezes the ones in hitstop. */
export function prologue(s: SimState): void {
  for (const e of s.entities) {
    e.px = e.x;
    e.py = e.y;
    e.pz = e.z;
    e.held = e.stop > 0;
    if (e.held) e.stop--;
  }
}

export function bodiesSystem(s: SimState, events: SimEvent[]): void {
  for (const e of s.entities) {
    if (e.held) continue;
    e.st++;
    for (let i = 0; i < e.cd.length; i++) if (e.cd[i] > 0) e.cd[i]--;
    if (e.inv > 0) e.inv--;
    if (e.team === 0 && quickRise(s, e, events)) continue;
    if (react(e)) {
      if (e.team === 0) {
        const p = s.players.find((q) => q.hero === e.id);
        if (p) tickBuffer(p);
      }
      continue;
    }
    if (e.team === 0) heroControl(s, e, events);
    else mobControl(s, e, events);
  }
}

/** Runs a reaction state's timer; true when the body is in one (and not under its own control). */
function react(e: Entity): boolean {
  switch (e.state) {
    case 'hurt':
      if (--e.timer <= 0) setState(e, 'idle');
      return true;
    case 'down':
      if (--e.timer <= 0) {
        setState(e, 'getup');
        e.timer = WORLD.getupTicks;
      }
      return true;
    case 'getup':
      if (--e.timer <= 0) setState(e, 'idle');
      return true;
    case 'air':
    case 'dead':
      return true;
    default:
      return false;
  }
}
