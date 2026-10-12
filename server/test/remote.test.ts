import { rateRun } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { describe, expect, it } from 'vitest';
import { WsLink } from '../../client/src/net/Link';
import { OnlineSession } from '../../client/src/net/OnlineSession';

// A smoke test of a running server, skipped unless DNF_SERVER_URL names one: the bot clears
// the trial online against it, in real time, and the server's verdict must agree. For the
// bundled build (npm run build -w server, then node server/dist/server.mjs) and the deployed
// server (DNF_SERVER_URL=wss://fs.gamestao.com npx vitest run test/remote.test.ts).

const url = process.env.DNF_SERVER_URL;

describe.skipIf(!url)('a running server', () => {
  it('verifies a clear of the trial and hands out its loot', async () => {
    const link = await WsLink.connect(url!, 0);
    const s = await OnlineSession.join(link, { dungeon: 'trial', device: 'smoke-test', cheatDmg: false });
    const t0 = performance.now();
    let last = t0;
    while (!s.result && performance.now() < t0 + 150_000) {
      await new Promise((r) => setTimeout(r, 5));
      const now = performance.now();
      const n = s.ticksFor(now - last);
      last = now;
      for (let i = 0; i < n; i++) s.step(botButtons(s.engine.state, s.owner));
    }
    link.close();
    expect(s.flag).toBeNull();
    const r = s.result!;
    if (!r.ok) throw new Error(r.reason);
    expect(r.rating).toEqual(rateRun(s.engine.state));
    expect(r.loot.length).toBeGreaterThanOrEqual(1);
  }, 160_000);
});
