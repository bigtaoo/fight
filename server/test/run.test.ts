import { DEFAULT_LOADOUT, rateRun, type DungeonId, type SkillId } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WsLink } from '../../client/src/net/Link';
import { OnlineSession } from '../../client/src/net/OnlineSession';
import { startServer, type RunningServer } from '../src/server';

// End to end over a real socket: the client's online session, driven by the engine's bot,
// against the server's metronome and verifier. The frame clock runs at TICK_MS instead of
// 33 ms so a run takes seconds; lags are scaled the same way, so in ticks every case is what
// it would be in play.

const TICK_MS = 10;
const SCALE = TICK_MS / (1000 / 30);

let server: RunningServer;
/** Black Wind Fort takes the bot some 11,000 ticks: on its own server, faster still and on a
 * seed the bot is known to win (it wins about 97 seeds in 100). */
let fort: RunningServer;
const FORT_TICK_MS = 2;
const logs: string[] = [];

beforeAll(async () => {
  server = await startServer({ port: 0, dataFile: null, tickMs: TICK_MS, log: (m) => logs.push(m) });
  fort = await startServer({ port: 0, dataFile: null, tickMs: FORT_TICK_MS, seed: 7, log: (m) => logs.push(m) });
});

afterAll(async () => {
  await server.close();
  await fort.close();
});

interface PlayOptions {
  dungeon?: DungeonId;
  lagMs?: number;
  cheatDmg?: boolean;
  device?: string;
  loadout?: SkillId[];
  /** A lag spike: from `at` ms into the run, `lagMs` each way for `forMs`. */
  spike?: { at: number; forMs: number; lagMs: number };
}

async function playOnline(opts: PlayOptions) {
  const port = opts.dungeon === 'heifeng' ? fort.port : server.port;
  const link = await WsLink.connect(`ws://localhost:${port}`, (opts.lagMs ?? 0) * SCALE);
  const s = await OnlineSession.join(link, { dungeon: opts.dungeon ?? 'trial', device: opts.device ?? 'test-device-1', loadout: opts.loadout, cheatDmg: opts.cheatDmg ?? false });
  const t0 = performance.now();
  let last = t0;
  while (!s.result && performance.now() < t0 + 90_000) {
    await new Promise((r) => setTimeout(r, 1));
    const now = performance.now();
    if (opts.spike) {
      const { at, forMs, lagMs } = opts.spike;
      const on = now - t0 >= at * SCALE && now - t0 < (at + forMs) * SCALE;
      link.lagMs = (on ? lagMs : (opts.lagMs ?? 0)) * SCALE;
    }
    const n = s.ticksFor(now - last);
    last = now;
    for (let i = 0; i < n; i++) s.step(botButtons(s.engine.state, s.owner));
  }
  link.close();
  return s;
}

describe('online run', () => {
  it('clears, matches the verifier at every checkpoint and gets loot within a second', async () => {
    const s = await playOnline({});
    expect(s.flag).toBeNull();
    expect(s.result?.ok, JSON.stringify(s.result)).toBe(true);
    expect(s.engine.state.outcome).toBe('cleared');
    expect(s.result!.settleMs! * (1 / SCALE)).toBeLessThan(1000);
    const r = s.result!;
    if (!r.ok) throw new Error(r.reason);
    // the clear's own draw, and maybe a bandit's drop
    expect(r.loot.length).toBeGreaterThanOrEqual(1);
    expect(s.inventory).toEqual(r.loot);
    expect(r.rating).toEqual(rateRun(s.engine.state));
  }, 70_000);

  it('clears Black Wind Fort through the chief, rated the same by the replay, with its loot', async () => {
    const s = await playOnline({ dungeon: 'heifeng', device: 'test-device-fort' });
    expect(s.flag).toBeNull();
    expect(s.engine.state.outcome).toBe('cleared');
    const r = s.result!;
    if (!r.ok) throw new Error(r.reason);
    expect(r.rating).toEqual(rateRun(s.engine.state));
    expect(r.rating.grade).toMatch(/^[SABC]$/);
    expect(s.engine.state.kills.chief).toBe(1);
    // the chief's draws (two for an S), plus whatever the monsters on the way dropped
    expect(r.loot.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('flags a tampered client in the fort within its first room', async () => {
    const s = await playOnline({ dungeon: 'heifeng', cheatDmg: true, device: 'test-device-fort-cheat' });
    expect(s.flag?.reason).toMatch(/hash/);
    expect(s.engine.state.cleared).toEqual([]);
    expect(s.result?.ok).toBe(false);
    expect(s.inventory).toHaveLength(0);
  }, 70_000);

  it('runs the skills the client chose, checked: the swapped ones, or the default for a bad pick', async () => {
    const swapped: SkillId[] = ['dragon', 'crush', 'iai', 'phantom'];
    const s = await playOnline({ loadout: swapped, device: 'test-device-loadout' });
    expect(s.engine.state.players[0].skills).toEqual(swapped);
    expect(s.flag).toBeNull();
    expect(s.result?.ok ? 'cleared' : 'failed').toBe(s.engine.state.outcome);
    const link = await WsLink.connect(`ws://localhost:${server.port}`, 0);
    const bad = await OnlineSession.join(link, { dungeon: 'trial', device: 'test-device-loadout', loadout: ['upper', 'triple', 'iai', 'phantom'], cheatDmg: false });
    expect(bad.engine.state.players[0].skills).toEqual(DEFAULT_LOADOUT);
    link.close();
  }, 70_000);

  it('flags a client running x10 damage and grants nothing', async () => {
    const s = await playOnline({ cheatDmg: true, device: 'test-device-cheat' });
    expect(s.flag?.reason).toMatch(/hash/);
    expect(s.result?.ok).toBe(false);
    expect(s.inventory).toHaveLength(0);
  }, 70_000);

  it('keeps every input on the tick it was pressed at 150 ms each way', async () => {
    const s = await playOnline({ lagMs: 150, device: 'test-device-lag' });
    expect(s.result?.ok, JSON.stringify(s.result)).toBe(true);
    // a rollback means a command landed late; the kept lead should prevent that (the odd one
    // under this test's shared event loop is tolerated)
    expect(s.rollbacks).toBeLessThanOrEqual(1);
  }, 70_000);

  it('rolls back the commands a lag spike made late and still agrees with the verifier', async () => {
    const s = await playOnline({ lagMs: 50, spike: { at: 8000, forMs: 1500, lagMs: 400 }, device: 'test-device-spike' });
    expect(s.rollbacks).toBeGreaterThan(0);
    expect(s.flag).toBeNull();
    // the bot may lose the fight to its delayed inputs; either way the replay agreed on it
    const r = s.result!;
    expect(r.ok || r.reason === 'the hero fell', JSON.stringify(r)).toBe(true);
    expect(r.ok ? 'cleared' : 'failed').toBe(s.engine.state.outcome);
  }, 70_000);
});
