import { Engine, hashState, type Outcome, type PlayerCommand, type RunConfig } from '@dnf/engine';
import { CHECK_EVERY, type Frame } from '../protocol';

// The verifier's shadow simulation: the same engine source as the client, fed only the frames
// the metronome made final, with the config the server chose (whatever the client claims to
// run). Its hashes are the truth the client's checkpoints are held to, and its end of the run
// is the only one loot is granted on.

export type ReplayOut =
  | { type: 'hash'; tick: number; hash: number }
  | { type: 'end'; tick: number; outcome: Exclude<Outcome, 'playing'> };

export class Replayer {
  private readonly engine: Engine;
  private ended = false;

  constructor(config: RunConfig) {
    this.engine = new Engine(config);
  }

  get tick(): number {
    return this.engine.state.tick;
  }

  /** Steps every frame up to `to`; `frames` lists the ones that carry commands. Returns the
   * checkpoint hashes passed on the way, and the end of the run once it is decided. */
  advance(to: number, frames: readonly Frame[]): ReplayOut[] {
    const byFrame = new Map(frames.map((f) => [f.frame, f.cmds]));
    const out: ReplayOut[] = [];
    const s = () => this.engine.state;
    while (!this.ended && this.engine.state.tick < to) {
      const tick = this.engine.nextTick;
      const cmds: PlayerCommand[] = (byFrame.get(tick) ?? []).map((c) => ({ owner: c.owner, tick, buttons: c.buttons }));
      this.engine.step(cmds);
      const outcome = s().outcome;
      if (tick % CHECK_EVERY === 0 || outcome !== 'playing') out.push({ type: 'hash', tick, hash: hashState(s()) });
      if (outcome !== 'playing') {
        out.push({ type: 'end', tick, outcome });
        this.ended = true;
      }
    }
    return out;
  }
}
