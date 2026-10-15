import { rateRun, type SimEvent, type SimState } from '@dnf/engine';
import type { BagStore } from '../platform/store';

// Drop-off analytics for the platform test: how far strangers get before they stop. Anonymous:
// a random id per visit, the dungeon, rooms, outcomes and times, nothing about the person.
// Events gather in a buffer and go out as one beacon when a run ends, when it fills, and when
// the page is hidden (the last moment a closing tab is sure to send). The server side is
// server/src/events.ts, the report server/scripts/funnel.ts.

export interface TelemetryEvent {
  ev: 'open' | 'start' | 'room' | 'end' | 'leave';
  dungeon?: string;
  room?: number;
  tick?: number;
  n?: number;
  sec?: number;
  outcome?: 'cleared' | 'failed';
  grade?: string;
  first?: boolean;
  touch?: boolean;
  lang?: string;
}

/** Sends a body; false when it could not be queued. */
export type Sink = (url: string, body: string) => boolean;

/** A beacon: survives the page closing, and as text/plain it needs no CORS preflight. */
const beacon: Sink = (url, body) => {
  try {
    return navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
  } catch {
    return false;
  }
};

const SEEN_KEY = 'dnf.seen';
const FLUSH_AT = 20;

export class Telemetry {
  readonly sid = randomId();
  private buffer: (TelemetryEvent & { sid: string; t: number })[] = [];
  private runs = 0;
  /** The run on now: its dungeon and the room it is in; null between runs. */
  private run: { dungeon: string; room: number; tick: number } | null = null;
  private readonly t0: number;

  /** `url` null: nothing is sent (dev builds, bots). */
  constructor(
    private readonly url: string | null,
    private readonly store: BagStore,
    private readonly sink: Sink = beacon,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.t0 = now();
  }

  /** The page opened. */
  open(touch: boolean, lang: string): void {
    const first = this.store.get(SEEN_KEY) === null;
    if (first) this.store.set(SEEN_KEY, '1');
    this.push({ ev: 'open', first, touch, lang: lang.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x' });
  }

  /** A run began in `dungeon`. */
  start(dungeon: string): void {
    this.runs++;
    this.run = { dungeon, room: 0, tick: 0 };
    this.push({ ev: 'start', dungeon, n: this.runs });
  }

  /** One tick's events, and the state after it. */
  observe(s: SimState, events: readonly SimEvent[]): void {
    const run = this.run;
    if (!run) return;
    run.tick = s.tick;
    for (const ev of events) {
      if (ev.type === 'roomEnter') {
        run.room = ev.room;
        this.push({ ev: 'room', dungeon: run.dungeon, room: ev.room });
      }
    }
    if (s.outcome !== 'playing') {
      const cleared = s.outcome === 'cleared';
      this.push({ ev: 'end', dungeon: run.dungeon, outcome: cleared ? 'cleared' : 'failed', room: run.room, tick: s.tick, ...(cleared ? { grade: rateRun(s).grade } : {}) });
      this.run = null;
      this.flush();
    }
  }

  /** The page is being hidden (maybe closed): say where the visit stands and send everything. */
  leave(): void {
    const run = this.run;
    this.push({ ev: 'leave', sec: Math.round((this.now() - this.t0) / 1000), ...(run ? { dungeon: run.dungeon, room: run.room, tick: run.tick } : {}) });
    this.flush();
  }

  flush(): void {
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    if (this.url) this.sink(this.url, JSON.stringify(batch));
  }

  private push(e: TelemetryEvent): void {
    this.buffer.push({ sid: this.sid, t: Math.round(this.now() - this.t0), ...e });
    if (this.buffer.length >= FLUSH_AT) this.flush();
  }
}

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
