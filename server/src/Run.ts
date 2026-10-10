import { randomBytes, randomInt } from 'node:crypto';
import { BTN_ALL, DUNGEONS, runConfig, type DungeonId, type RunConfig, type SkillId } from '@dnf/engine';
import { CHECK_EVERY, type ClientMsg, type CmdMsg, type Frame, type FrameCmd, type ServerMsg } from '../protocol';
import { rollLoot, type Inventory } from './loot';
import type { ReplayOut } from './replay';
import { Verifier } from './Verifier';

// One player's run through a dungeon: the metronome, the verifier following it, and the
// settlement. The frame clock is the server's wall clock, so a run cannot be played faster
// than real time even solo. A command lands on the tick the client stamped it with if that
// frame is not final yet, else on the next open one; the client predicts the first case and
// rolls back on the second. Loot is drawn only when the verifier's replay cleared the dungeon
// and every checkpoint the client reported on the way matched it (and never for a practice one).

export interface RunOptions {
  tickMs: number;
  /** How far ahead of the frame clock a command may be stamped, in ticks. */
  maxLead: number;
  /** How long settlement waits for the client's last checkpoints. */
  settleMs: number;
  /** A run longer than this many frames is abandoned. */
  maxFrames: number;
}

export const DEFAULT_OPTIONS: RunOptions = { tickMs: 1000 / 30, maxLead: 45, settleMs: 3000, maxFrames: 30 * 60 * 20 };

type End = Extract<ReplayOut, { type: 'end' }>;

export class Run {
  readonly id = randomBytes(8).toString('hex');
  readonly config: RunConfig;
  private readonly t0 = performance.now();
  /** Every frame up to this one is final and relayed. */
  private frame = 0;
  private readonly pending = new Map<number, FrameCmd[]>();
  private lastSeq = 0;
  private lastAssigned = 0;
  private readonly serverHash = new Map<number, number>();
  private readonly clientHash = new Map<number, number>();
  private end: End | null = null;
  private flagged: { tick: number; reason: string } | null = null;
  private settled = false;
  private readonly timer: NodeJS.Timeout;
  private settleTimer?: NodeJS.Timeout;
  private readonly verifier: Verifier;

  constructor(
    dungeon: DungeonId,
    loadout: SkillId[],
    private readonly device: string,
    private readonly inventory: Inventory,
    private readonly send: (msg: ServerMsg) => void,
    private readonly opts: RunOptions,
    private readonly log: (msg: string) => void,
  ) {
    this.config = runConfig({ seed: randomInt(1, 2 ** 31 - 1), dungeon, players: 1, heroDamagePct: 100, loadout });
    this.verifier = new Verifier(this.config, (out) => this.onVerifier(out), (err) => this.fail(`verifier crashed: ${err.message}`));
    send({ type: 'start', run: this.id, owner: 0, config: this.config, tickMs: opts.tickMs, inventory: inventory.get(device) });
    this.timer = setInterval(() => this.flush(), Math.max(10, Math.min(50, opts.tickMs * 2)));
    log(`run ${this.id} start: ${dungeon}, seed ${this.config.seed}, skills ${loadout.join(' ')}`);
  }

  handle(msg: ClientMsg): void {
    if (msg.type === 'cmd') this.onCmd(msg);
    else if (msg.type === 'hash') this.onHash(msg.tick, msg.hash);
    else if (msg.type === 'ping' && Number.isSafeInteger(msg.tick)) this.send({ type: 'pong', id: msg.id, slack: msg.tick - this.clock() });
  }

  close(): void {
    clearInterval(this.timer);
    clearTimeout(this.settleTimer);
    this.verifier.close();
  }

  /** The frame the wall clock is at. */
  private clock(): number {
    return Math.floor((performance.now() - this.t0) / this.opts.tickMs);
  }

  private onCmd(m: CmdMsg): void {
    if (m.seq !== this.lastSeq + 1 || !Number.isSafeInteger(m.tick) || typeof m.buttons !== 'number') return;
    this.lastSeq = m.seq;
    if (m.tick > this.clock() + this.opts.maxLead) this.flag(m.tick, 'commands stamped ahead of the clock');
    // strictly after the last one, so a late tap and its release never collapse into one frame
    const frame = Math.max(m.tick, this.frame + 1, this.lastAssigned + 1);
    this.lastAssigned = frame;
    const cmd: FrameCmd = { owner: 0, seq: m.seq, buttons: m.buttons & BTN_ALL };
    const list = this.pending.get(frame);
    if (list) list.push(cmd);
    else this.pending.set(frame, [cmd]);
  }

  private flush(): void {
    const to = this.clock();
    if (to <= this.frame) return;
    if (to > this.opts.maxFrames) {
      clearInterval(this.timer);
      return this.fail('run too long');
    }
    const frames: Frame[] = [];
    for (const f of [...this.pending.keys()].sort((a, b) => a - b)) {
      if (f > to) break;
      frames.push({ frame: f, cmds: this.pending.get(f)! });
      this.pending.delete(f);
    }
    this.frame = to;
    this.send({ type: 'frames', to, frames });
    this.verifier.advance(to, frames);
  }

  private onHash(tick: number, hash: number): void {
    if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(hash) || this.clientHash.has(tick)) return;
    if (this.end && tick > this.end.tick) return;
    this.clientHash.set(tick, hash);
    this.compare(tick);
  }

  private onVerifier(out: ReplayOut[]): void {
    for (const o of out) {
      if (o.type === 'hash') {
        this.serverHash.set(o.tick, o.hash);
        this.compare(o.tick);
      } else {
        this.end = o;
        this.log(`run ${this.id} verifier: ${o.outcome} at tick ${o.tick}`);
        this.settleTimer = setTimeout(() => this.fail('checkpoints missing'), this.opts.settleMs);
        this.settle();
      }
    }
  }

  private compare(tick: number): void {
    const s = this.serverHash.get(tick);
    const c = this.clientHash.get(tick);
    if (s !== undefined && c !== undefined && s !== c) this.flag(tick, 'state hash differs from the replay');
    this.settle();
  }

  private flag(tick: number, reason: string): void {
    if (this.flagged) return;
    this.flagged = { tick, reason };
    this.log(`run ${this.id} flagged at tick ${tick}: ${reason}`);
    this.send({ type: 'flag', tick, reason });
    this.fail(reason);
  }

  /** Settles once the verifier has ended the run and the client's checkpoints are all in. */
  private settle(): void {
    if (this.settled || !this.end) return;
    const { tick, outcome } = this.end;
    for (let t = CHECK_EVERY; t <= tick; t += CHECK_EVERY) if (!this.clientHash.has(t)) return;
    if (!this.clientHash.has(tick)) return;
    if (outcome === 'failed') return this.fail('the hero fell');
    if (DUNGEONS[this.config.dungeon].practice) return this.fail('practice');
    this.settled = true;
    clearTimeout(this.settleTimer);
    const loot = rollLoot();
    const inventory = this.inventory.add(this.device, loot);
    this.log(`run ${this.id} cleared at tick ${tick}: ${loot.name}`);
    this.send({ type: 'result', ok: true, tick, loot, inventory });
  }

  private fail(reason: string): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.settleTimer);
    this.log(`run ${this.id} no loot: ${reason}`);
    this.send({ type: 'result', ok: false, tick: this.end?.tick ?? this.frame, reason });
  }
}
