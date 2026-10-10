// Player input, the only thing that enters the simulation from outside once it is running.
//
// A command is the full set of buttons a player holds on a tick, not key events: the engine
// finds presses (edges), double taps and buffered presses itself, so every machine derives
// them identically from the same button states. A player who sends nothing on a tick holds
// the buttons of their last command, so a client only needs to send when something changes.
//
// An InputSource hands the engine each tick's commands. The local one never stalls; the
// network one returns null until the server has confirmed the tick.

export const BTN = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  ATTACK: 16,
  JUMP: 32,
  /** The skill slots (whatever skill the loadout puts in each) and the ultimate. */
  SKILL1: 64,
  SKILL2: 128,
  SKILL3: 256,
  ULT: 512,
  /** The dodge: a hop back. */
  DODGE: 1024,
} as const;

/** Every button bit: what a command from outside is masked to. */
export const BTN_ALL = Object.values(BTN).reduce((m, b) => m | b, 0);

export interface PlayerCommand {
  owner: number;
  tick: number;
  /** BTN bits held on this tick. */
  buttons: number;
}

export interface InputSource {
  submit(cmd: PlayerCommand): void;
  /** The commands for `tick`, or null while they are not known yet (a network stall). */
  take(tick: number): readonly PlayerCommand[] | null;
}

/** Single player offline: commands are known as soon as they are made. Keeps them all for a replay. */
export class LocalInputSource implements InputSource {
  private readonly pending = new Map<number, PlayerCommand[]>();
  readonly history: PlayerCommand[] = [];

  submit(cmd: PlayerCommand): void {
    const list = this.pending.get(cmd.tick);
    if (list) list.push(cmd);
    else this.pending.set(cmd.tick, [cmd]);
    this.history.push(cmd);
  }

  take(tick: number): readonly PlayerCommand[] {
    const list = this.pending.get(tick) ?? [];
    this.pending.delete(tick);
    return list;
  }
}

/** Plays back a recorded command list. */
export class ReplayInputSource implements InputSource {
  private readonly byTick = new Map<number, PlayerCommand[]>();

  constructor(history: readonly PlayerCommand[]) {
    for (const c of history) {
      const list = this.byTick.get(c.tick);
      if (list) list.push(c);
      else this.byTick.set(c.tick, [c]);
    }
  }

  submit(): void {}

  take(tick: number): readonly PlayerCommand[] {
    return this.byTick.get(tick) ?? [];
  }
}
