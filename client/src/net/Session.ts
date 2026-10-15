import { Engine, LocalInputSource, TICK_RATE, type RunConfig, type SimEvent } from '@dnf/engine';
import { Character } from '../rpg/character';
import { settleRun, type Reward } from '../rpg/rewards';
import { browserStore, deviceRand } from '../platform/store';

// What the game loop drives: something that says how many ticks to step for the time that
// passed, and steps one tick with the local player's buttons. Offline that is the engine on a
// plain clock; online (OnlineSession) it also predicts, rolls back and keeps pace with the
// server's frame clock.

export interface Session {
  readonly engine: Engine;
  /** Ticks to step for `dtMs` of wall time. */
  ticksFor(dtMs: number): number;
  /** How far the wall clock is into the next tick, 0..1, for interpolation. */
  readonly alpha: number;
  /** Steps one tick with the local player holding `buttons`; the events of that tick. */
  step(buttons: number): SimEvent[];
  /** A line for the HUD about the connection, or '' offline. */
  status(): string;
  close(): void;
}

/** At most this many ticks per frame; beyond it the game slows down rather than spiralling. */
export const MAX_STEPS = 8;

/** Wall time to ticks. Past MAX_STEPS in one frame the rest waits for later frames, up to
 * `backlog` ticks; anything beyond that is dropped. Ticks owed to catch up (after a stalled tab,
 * online) are never dropped: they go out MAX_STEPS a frame until paid. */
export class Clock {
  private acc = 0;
  /** Ticks still owed to catch up. */
  owed = 0;

  constructor(private readonly tickMs: number, private readonly backlog = 0) {}

  get alpha(): number {
    return Math.min(1, this.acc);
  }

  /** Whole ticks for `dtMs` at `speed`, plus `extra` ticks to catch up or (negative) wait. */
  ticks(dtMs: number, speed = 1, extra = 0): number {
    this.acc += (Math.min(dtMs, 250) / this.tickMs) * speed + Math.min(0, extra);
    this.owed += Math.max(0, extra);
    const n = Math.max(0, Math.min(MAX_STEPS, Math.floor(this.acc)));
    this.acc -= n;
    if (this.acc > this.backlog + 1) this.acc = this.backlog;
    const paid = Math.min(MAX_STEPS - n, Math.floor(this.owed));
    this.owed -= paid;
    return n + paid;
  }
}

export class OfflineSession implements Session {
  readonly engine: Engine;
  private readonly clock = new Clock(1000 / TICK_RATE);
  /** What the run earned once it is decided (null before, and for practice). */
  reward: Reward | null = null;
  private settled = false;

  /** `character`: the single-player character the run's experience and gear go to. */
  constructor(config: RunConfig, readonly character = new Character(browserStore)) {
    this.engine = new Engine(config, new LocalInputSource());
  }

  get alpha(): number {
    return this.clock.alpha;
  }

  ticksFor(dtMs: number): number {
    return this.clock.ticks(dtMs);
  }

  step(buttons: number): SimEvent[] {
    const e = this.engine;
    e.submit({ owner: 0, tick: e.nextTick, buttons });
    const events = e.advance() ?? [];
    if (!this.settled && e.state.outcome !== 'playing') {
      this.settled = true;
      this.reward = settleRun(e.state, this.character, deviceRand);
    }
    return events;
  }

  status(): string {
    return '';
  }

  close(): void {}
}
