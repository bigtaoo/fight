import { Engine, hashState, type DungeonId, type PlayerCommand, type SimEvent, type SimState } from '@dnf/engine';
import { CHECK_EVERY, type Frame, type Item, type ServerMsg } from '@dnf/server/protocol';
import type { Link } from './Link';
import { Clock, type Session } from './Session';

// Online play against the server's metronome. The local player's buttons take effect on the
// tick they are pressed: the session steps ahead of the server's frame clock by about one
// round trip, sends each change stamped with its tick, and treats it as confirmed. When the
// server's frames disagree with what was stepped (a command that arrived late landed on a
// later frame), it restores the snapshot before the first difference and steps forward again
// with the confirmed commands, silently. Solo, that only happens when the line hiccups.
//
// It also reports the hash of every confirmed checkpoint tick to the verifier, and keeps its
// lead over the frame clock near TARGET_SLACK with pings.

/** Ticks a command should reach the server ahead of the frame it is stamped for. */
const TARGET_SLACK = 4;
const PING_MS = 500;
/** Snapshots kept behind the head; a rollback deeper than this is a desync. */
const RING = 300;

export interface JoinOptions {
  dungeon: DungeonId;
  device: string;
  /** ?cheat=dmg: run the hero's damage x10 locally, as a tampered client would. */
  cheatDmg: boolean;
}

interface OwnCmd {
  seq: number;
  tick: number;
  buttons: number;
}

export type RunResult = Extract<ServerMsg, { type: 'result' }> & { settleMs: number | null };

export class OnlineSession implements Session {
  readonly engine: Engine;
  readonly owner: number;
  readonly tickMs: number;
  /** Rollbacks so far and the deepest one, in ticks (HUD and tests). */
  rollbacks = 0;
  deepest = 0;
  flag: { tick: number; reason: string } | null = null;
  result: RunResult | null = null;
  inventory: Item[];
  rtt: number;
  desync = false;

  private readonly clock: Clock;
  private readonly ring = new Map<number, SimState>();
  private readonly used = new Map<number, PlayerCommand[]>();
  private readonly auth = new Map<number, PlayerCommand[]>();
  private confirmed = 0;
  /** Own commands the server has not confirmed yet, in order. */
  private own: OwnCmd[] = [];
  private seq = 0;
  private lastButtons = 0;
  private checked = 0;
  private endReported = false;
  private clearedAt: number | null = null;
  /** Ticks still to gain (positive) or give back to reach TARGET_SLACK. */
  private drift = 0;
  private pingId = 0;
  private pingSent = new Map<number, number>();
  private lastPing = 0;
  /** Pongs of pings sent before the last correction say nothing new. */
  private syncedAfter = 0;

  private constructor(
    private readonly link: Link,
    start: Extract<ServerMsg, { type: 'start' }>,
    cheatDmg: boolean,
    rtt: number,
    private readonly now: () => number,
  ) {
    this.owner = start.owner;
    this.tickMs = start.tickMs;
    this.inventory = start.inventory;
    this.rtt = rtt;
    this.clock = new Clock(start.tickMs, 90);
    this.engine = new Engine({ ...start.config, heroDamagePct: cheatDmg ? 1000 : 100 });
    this.ring.set(0, this.engine.snapshot());
    link.onMessage((m) => this.onMessage(m));
    // start about a round trip ahead of the frame clock, so the first command is already on time
    const lead = Math.ceil(rtt / this.tickMs) + TARGET_SLACK;
    for (let i = 0; i < lead; i++) this.step(0);
  }

  /** Joins a run on `link` and resolves once the server has started it. */
  static join(link: Link, opts: JoinOptions, now: () => number = () => performance.now()): Promise<OnlineSession> {
    return new Promise((resolve, reject) => {
      const t0 = now();
      const timer = setTimeout(() => reject(new Error('the server did not start the run')), 5000);
      link.onMessage((m) => {
        if (m.type !== 'start') return;
        clearTimeout(timer);
        resolve(new OnlineSession(link, m, opts.cheatDmg, now() - t0, now));
      });
      link.send({ type: 'join', dungeon: opts.dungeon, device: opts.device });
    });
  }

  get alpha(): number {
    return this.clock.alpha;
  }

  /** The server's last final frame. */
  get confirmedTick(): number {
    return this.confirmed;
  }

  ticksFor(dtMs: number): number {
    const t = this.now();
    if (t - this.lastPing >= PING_MS && this.link.open) {
      this.lastPing = t;
      this.pingSent.set(++this.pingId, t);
      this.link.send({ type: 'ping', id: this.pingId, tick: this.engine.nextTick });
    }
    // small differences are worked off at +-20% speed; a big one (a stalled tab) at once
    let extra = 0;
    if (Math.abs(this.drift) > 15) {
      extra = this.drift;
      this.drift = 0;
    }
    const speed = this.drift > 0.5 ? 1.2 : this.drift < -0.5 ? 0.8 : 1;
    this.drift -= (Math.min(dtMs, 250) / this.tickMs) * (speed - 1);
    return this.clock.ticks(dtMs, speed, extra);
  }

  step(buttons: number): SimEvent[] {
    const tick = this.engine.nextTick;
    if (buttons !== this.lastButtons) {
      this.lastButtons = buttons;
      this.own.push({ seq: ++this.seq, tick, buttons });
      this.link.send({ type: 'cmd', seq: this.seq, tick, buttons });
    }
    const events = this.stepTick(tick);
    if (this.clearedAt === null && this.engine.state.outcome === 'cleared') this.clearedAt = this.now();
    this.prune();
    return events;
  }

  status(): string {
    if (this.desync) return '联机：状态失步';
    if (!this.link.open) return '联机：已断开';
    const parts = [`联机 ${Math.round(this.rtt)}ms`];
    if (this.rollbacks) parts.push(`回滚 ${this.rollbacks} 次（最深 ${this.deepest} 帧）`);
    return parts.join('  ');
  }

  close(): void {
    this.link.onMessage(() => {});
  }

  private stepTick(tick: number): SimEvent[] {
    const cmds = this.inputsFor(tick);
    const events = this.engine.step(cmds);
    this.used.set(tick, cmds);
    this.ring.set(tick, this.engine.snapshot());
    return events;
  }

  /** Confirmed frames as the server sent them; past those, the own commands as predicted (the
   * other players hold their last buttons, which the engine does by itself). */
  private inputsFor(tick: number): PlayerCommand[] {
    if (tick <= this.confirmed) return this.auth.get(tick) ?? [];
    return this.own.filter((c) => c.tick === tick).map((c) => ({ owner: this.owner, tick, buttons: c.buttons }));
  }

  private onMessage(m: ServerMsg): void {
    if (m.type === 'frames') this.onFrames(m.to, m.frames);
    else if (m.type === 'pong') this.onPong(m.id, m.slack);
    else if (m.type === 'flag') this.flag = { tick: m.tick, reason: m.reason };
    else if (m.type === 'result') {
      this.result = { ...m, settleMs: this.clearedAt === null ? null : this.now() - this.clearedAt };
      if (m.ok) this.inventory = m.inventory;
    }
  }

  private onFrames(to: number, frames: readonly Frame[]): void {
    if (this.desync) return;
    const head = this.engine.state.tick;
    for (const f of frames) {
      this.auth.set(f.frame, f.cmds.map((c) => ({ owner: c.owner, tick: f.frame, buttons: c.buttons })));
      for (const c of f.cmds) if (c.owner === this.owner) this.own = this.own.filter((o) => o.seq !== c.seq);
    }
    let first = 0;
    for (let t = this.confirmed + 1; t <= Math.min(to, head); t++) {
      if (!sameCmds(this.used.get(t), this.auth.get(t))) {
        first = t;
        break;
      }
    }
    this.confirmed = to;
    // own commands still in flight but stamped for a frame that is now final will land later
    let next = to + 1;
    for (const c of this.own) {
      if (c.tick < next) c.tick = next;
      next = c.tick + 1;
    }
    if (first) this.rollback(first, head);
    this.report();
  }

  /** Goes back to the state before `first` and steps forward again to `head`. */
  private rollback(first: number, head: number): void {
    const base = this.ring.get(first - 1);
    if (!base) {
      this.desync = true;
      return;
    }
    this.engine.restore(base);
    for (let t = first; t <= head; t++) this.stepTick(t);
    this.rollbacks++;
    this.deepest = Math.max(this.deepest, head - first + 1);
  }

  /** Sends the hash of every checkpoint tick that is final now, up to the end of the run. */
  private report(): void {
    const upto = Math.min(this.confirmed, this.engine.state.tick);
    for (let t = this.checked + 1; t <= upto && !this.endReported; t++) {
      const s = this.ring.get(t);
      if (!s) continue;
      const ended = s.outcome !== 'playing';
      if (t % CHECK_EVERY === 0 || ended) this.link.send({ type: 'hash', tick: t, hash: hashState(s) });
      if (ended) this.endReported = true;
    }
    this.checked = Math.max(this.checked, upto);
  }

  private onPong(id: number, slack: number): void {
    const sent = this.pingSent.get(id);
    this.pingSent.delete(id);
    if (sent !== undefined) this.rtt = this.rtt * 0.7 + (this.now() - sent) * 0.3;
    if (id <= this.syncedAfter) return;
    const err = TARGET_SLACK - slack;
    if (Math.abs(err) > 1) {
      this.drift = err;
      this.syncedAfter = this.pingId;
    }
  }

  private prune(): void {
    const keep = Math.min(this.confirmed, this.checked, this.engine.state.tick - 1);
    const floor = Math.max(keep, this.engine.state.tick - RING);
    for (const map of [this.ring, this.used, this.auth]) {
      for (const t of map.keys()) {
        if (t < floor) map.delete(t);
        else break;
      }
    }
  }
}

function sameCmds(a: readonly PlayerCommand[] = [], b: readonly PlayerCommand[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].owner !== b[i].owner || a[i].buttons !== b[i].buttons) return false;
  return true;
}
