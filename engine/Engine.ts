import { ENTRY } from './content';
import type { SimEvent } from './events';
import { LocalInputSource, type InputSource, type PlayerCommand } from './input';
import { cloneState } from './snapshot';
import { createState, newEntity, type RunConfig, type SimState } from './state';
import { bodiesSystem, prologue } from './systems/bodies';
import { combatSystem } from './systems/combat';
import { applyInput } from './systems/hero';
import { separate } from './systems/mob';
import { physicsSystem } from './systems/physics';
import { cleanup, enterRoom, roomSystem } from './systems/room';
import { fireSystem, shotsSystem } from './systems/shots';

// The simulation: fixed 30 Hz steps over plain integer state, fed only by player commands.
// The system order below is part of the determinism contract: changing it, or any rule inside
// a system or any number in content.ts, changes every replay, so bump ENGINE_VERSION (and
// record the new golden hash in Engine.test.ts on purpose).

export const ENGINE_VERSION = 7;

export const STEP_ORDER = ['prologue', 'input', 'bodies', 'fire', 'physics', 'separate', 'combat', 'shots', 'cleanup', 'room'] as const;

export class Engine {
  state: SimState;
  private events: SimEvent[] = [];

  /** A new run of `config`, or with `restored` one that goes on from that state. */
  constructor(config: RunConfig, readonly input: InputSource = new LocalInputSource(), restored?: SimState) {
    this.state = restored ?? createState(config);
    if (!restored) this.events = setup(this.state);
  }

  /** The next tick to be stepped; commands for it are submitted ahead of advance(). */
  get nextTick(): number {
    return this.state.tick + 1;
  }

  submit(cmd: PlayerCommand): void {
    this.input.submit(cmd);
  }

  /** Steps one tick if its commands are known; null while the input source stalls. */
  advance(): SimEvent[] | null {
    const cmds = this.input.take(this.nextTick);
    return cmds ? this.step(cmds) : null;
  }

  /** One tick with these commands (a player without one holds their last buttons). */
  step(cmds: readonly PlayerCommand[]): SimEvent[] {
    const s = this.state;
    const events: SimEvent[] = (this.events = []);
    s.tick++;
    prologue(s);
    applyInput(s, cmds);
    bodiesSystem(s, events);
    fireSystem(s, events);
    physicsSystem(s, events);
    separate(s);
    combatSystem(s, events);
    shotsSystem(s, events);
    cleanup(s);
    roomSystem(s, events);
    return events;
  }

  /** A copy of the state that shares nothing with it (rollback, reconnect). */
  snapshot(): SimState {
    return cloneState(this.state);
  }

  /** Goes back to a state taken with snapshot(); the snapshot stays usable. */
  restore(snap: SimState): void {
    this.state = cloneState(snap);
  }

  /** The events of the last step (or of the setup, before the first step). */
  get lastEvents(): readonly SimEvent[] {
    return this.events;
  }
}

/** One hero per player, then the first room. */
function setup(s: SimState): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < s.config.players; i++) {
    const h = newEntity(s, 'hero', 0, i, ENTRY.x, ENTRY.y);
    s.players.push({ owner: i, hero: h.id, buttons: 0, prev: 0, tapDir: 0, tapTick: -100, running: false, buf: 0, bufLeft: 0, skills: [...s.config.loadout] });
  }
  enterRoom(s, 0, events);
  return events;
}
