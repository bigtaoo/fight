import { Engine } from './Engine';
import type { SimEvent } from './events';
import { LocalInputSource } from './input';
import { runConfig, type RunConfig, type SimState } from './state';

// Shared by the engine's tests: drive an engine with a button function, one command per tick.

export type Buttons = (s: SimState, tick: number) => number;

export function newRun(over: Partial<RunConfig> = {}): Engine {
  return new Engine(runConfig(over), new LocalInputSource());
}

/** Steps `n` ticks with player 0 holding `buttons(state, tick)`; returns every event, in order. */
export function play(e: Engine, n: number, buttons: Buttons): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n && e.state.outcome === 'playing'; i++) {
    e.submit({ owner: 0, tick: e.nextTick, buttons: buttons(e.state, e.nextTick) });
    const ev = e.advance();
    if (ev) all.push(...ev);
  }
  return all;
}

export function hero(s: SimState) {
  return s.entities.find((e) => e.team === 0)!;
}
