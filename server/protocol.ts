import type { DungeonId, RunConfig, SkillId } from '@dnf/engine';

// The wire protocol between the client and the server, JSON over one WebSocket. Types only, so
// the client imports it as source. JSON is enough for M1 (one player, a few messages a second);
// protobuf contracts like funny's come with the real services.
//
// The server is a metronome: it owns the frame clock, stamps every command with the frame it
// lands on and relays the frames back. It never reads the buttons; its verifier replays them.

/** Default WebSocket port of the dev server. */
export const SERVER_PORT = 5181;

/** A client reports the hash of its state on every tick that is a multiple of this, and on the
 * tick the run ends. */
export const CHECK_EVERY = 30;

export interface Item {
  id: string;
  name: string;
  /** 1 common .. 3 rare. */
  rarity: number;
}

/** A command as the client sends it: the buttons it holds from `tick` on. */
export interface CmdMsg {
  type: 'cmd';
  /** 1, 2, 3 ... per run; the server drops anything out of order. */
  seq: number;
  /** The tick the client applied it on. A suggestion: a late one lands on a later frame. */
  tick: number;
  buttons: number;
}

/** A command as the server confirms it, on the frame it landed on. */
export interface FrameCmd {
  owner: number;
  seq: number;
  buttons: number;
}

export interface Frame {
  frame: number;
  cmds: FrameCmd[];
}

export type ClientMsg =
  /** `loadout`: the skill wanted in each slot; the server falls back to the default for one it
   * does not accept. */
  | { type: 'join'; dungeon: DungeonId; device: string; loadout?: SkillId[] }
  | CmdMsg
  | { type: 'hash'; tick: number; hash: number }
  /** `tick` is the tick the client would stamp a command with right now. */
  | { type: 'ping'; id: number; tick: number };

export type ServerMsg =
  | {
      type: 'start';
      run: string;
      owner: number;
      /** The run as the server plays it; the client must run exactly this. */
      config: RunConfig;
      /** Wall time of one frame. 1000/30 in play, faster in tests. */
      tickMs: number;
      inventory: Item[];
    }
  /** Every frame up to `to` is final; only the frames that carry commands are listed. */
  | { type: 'frames'; to: number; frames: Frame[] }
  /** `slack`: the ping's tick minus the server's frame when it arrived. Negative: the client's
   * commands land late. */
  | { type: 'pong'; id: number; slack: number }
  /** The verifier's state differs from the client's: the run gets no loot. */
  | { type: 'flag'; tick: number; reason: string }
  | { type: 'result'; ok: true; tick: number; loot: Item; inventory: Item[] }
  | { type: 'result'; ok: false; tick: number; reason: string };
