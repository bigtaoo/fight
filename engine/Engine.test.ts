import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { Engine, ENGINE_VERSION, STEP_ORDER } from './Engine';
import { hashState } from './hash';
import { ReplayInputSource, type PlayerCommand } from './input';
import { LocalInputSource } from './input';
import { runConfig } from './state';
import { newRun, play } from './testUtil';

// Determinism: the same seed and commands give the same state on every run, a recorded run
// replays bit for bit, a snapshot resumes exactly, and a tampered damage number shows in the
// checkpoint hashes. Plus the bot clearing the trial dungeon, so the content stays beatable.

const bot = (s: Parameters<typeof botButtons>[0]) => botButtons(s, 0);

/** Hash of the state every 30 ticks (the checkpoints the client will report). */
function checkpoints(e: Engine, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n / 30 && e.state.outcome === 'playing'; i++) {
    play(e, 30, bot);
    out.push(hashState(e.state));
  }
  return out;
}

describe('engine', () => {
  it('keeps the system order', () => {
    expect(STEP_ORDER).toEqual(['prologue', 'input', 'bodies', 'fire', 'physics', 'separate', 'combat', 'shots', 'cleanup', 'room']);
  });

  it('the bot clears the trial dungeon', () => {
    const e = newRun({ seed: 7 });
    const ev = play(e, 30 * 180, bot);
    expect(e.state.outcome).toBe('cleared');
    expect(ev.filter((x) => x.type === 'roomEnter').map((x) => x.type === 'roomEnter' && x.room)).toEqual([1]);
    expect(ev.filter((x) => x.type === 'death')).toHaveLength(7);
  });

  it('runs the same twice and differs by seed', () => {
    const a = checkpoints(newRun({ seed: 3 }), 900);
    const b = checkpoints(newRun({ seed: 3 }), 900);
    const c = checkpoints(newRun({ seed: 4 }), 900);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('replays a recorded run bit for bit', () => {
    const live = newRun({ seed: 11 });
    play(live, 1500, bot);
    const history = (live.input as LocalInputSource).history;
    const replay = new Engine(runConfig({ seed: 11 }), new ReplayInputSource(history));
    while (replay.state.tick < live.state.tick) replay.advance();
    expect(hashState(replay.state)).toBe(hashState(live.state));
  });

  it('resumes a snapshot exactly', () => {
    const e = newRun({ seed: 5 });
    play(e, 200, bot);
    const snap = e.snapshot();
    const cmds: PlayerCommand[] = [];
    for (let i = 0; i < 300; i++) {
      const cmd = { owner: 0, tick: e.nextTick, buttons: bot(e.state) };
      cmds.push(cmd);
      e.step([cmd]);
    }
    const again = newRun({ seed: 5 });
    again.restore(snap);
    for (const c of cmds) again.step([c]);
    expect(hashState(again.state)).toBe(hashState(e.state));
    expect(again.state.tick).toBe(e.state.tick);
  });

  it('a client with tampered damage drifts from the honest state at a checkpoint', () => {
    const honest = checkpoints(newRun({ seed: 9 }), 600);
    const cheat = checkpoints(newRun({ seed: 9, heroDamagePct: 1000 }), 600);
    const first = honest.findIndex((h, i) => h !== cheat[i]);
    expect(first).toBeGreaterThanOrEqual(0);
  });

  it('refuses a float in the state', () => {
    const e = newRun();
    e.state.entities[0].x = 0.5;
    expect(() => hashState(e.state)).toThrow(/non-integer/);
  });

  it('matches the golden hash (bump ENGINE_VERSION when this changes on purpose)', () => {
    const e = newRun({ seed: 42 });
    play(e, 600, bot);
    expect({ version: ENGINE_VERSION, tick: e.state.tick, hash: hashState(e.state) }).toEqual({ version: 7, tick: 600, hash: 3924039462 });
  });

  it('matches the golden hash in Black Wind Fort: arrows, shields, sword waves, super armour, the chief', () => {
    // (the bot falls to the chief in its second phase, at tick 6876)
    const e = newRun({ dungeon: 'heifeng', seed: 7 });
    const ev = play(e, 7200, bot);
    expect(ev.filter((x) => x.type === 'fire' && x.shot === 'arrow').length).toBeGreaterThan(3);
    expect(ev.filter((x) => x.type === 'fire' && x.shot === 'wave').length).toBeGreaterThan(1);
    expect(ev.filter((x) => x.type === 'hit' && x.blocked).length).toBeGreaterThan(3);
    expect(ev.filter((x) => x.type === 'hit' && x.armor).length).toBeGreaterThan(1);
    expect(ev.filter((x) => x.type === 'fire' && x.shot === 'quake').length).toBeGreaterThan(3);
    expect(ev.filter((x) => x.type === 'phase')).toHaveLength(1);
    expect({ version: ENGINE_VERSION, tick: e.state.tick, hash: hashState(e.state) }).toEqual({ version: 7, tick: 6876, hash: 1862208211 });
  });
});
