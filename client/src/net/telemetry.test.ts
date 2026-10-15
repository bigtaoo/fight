import { describe, expect, it } from 'vitest';
import { runConfig } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { cleanEvent } from '../../../server/src/eventSchema';
import type { BagStore } from '../platform/store';
import { OfflineSession } from './Session';
import { Telemetry } from './telemetry';

// The drop-off analytics: a bot's run reports open, start, its rooms and its end, in batches the
// server's validator keeps whole.

const memory = (): BagStore => {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

describe('telemetry', () => {
  it('reports a cleared run, and the server keeps every event', () => {
    const sent: string[] = [];
    let now = 0;
    const store = memory();
    const t = new Telemetry('https://x/events', store, (_url, body) => (sent.push(body), true), () => now);
    t.open(false, 'en-US');
    const s = new OfflineSession(runConfig({ seed: 1, dungeon: 'trial' }));
    t.start('trial');
    for (let i = 0; i < 30 * 120 && s.engine.state.outcome === 'playing'; i++) {
      now += 1000 / 30;
      t.observe(s.engine.state, s.step(botButtons(s.engine.state, 0)));
    }
    expect(s.engine.state.outcome).toBe('cleared');
    t.leave();
    const events = sent.flatMap((b) => JSON.parse(b) as unknown[]);
    expect(events.map((e) => cleanEvent(e))).not.toContain(null);
    const names = events.map((e) => (e as { ev: string }).ev);
    expect(names[0]).toBe('open');
    expect(names[1]).toBe('start');
    expect(names).toContain('room');
    expect(names[names.length - 2]).toBe('end');
    expect(events[events.length - 2]).toMatchObject({ outcome: 'cleared', dungeon: 'trial' });
    expect(events[events.length - 1]).toMatchObject({ ev: 'leave' });
    expect(events[events.length - 1]).not.toHaveProperty('room');
    expect(new Set(events.map((e) => (e as { sid: string }).sid)).size).toBe(1);
    // the second visit on this device is not a first one
    const again: string[] = [];
    const t2 = new Telemetry('https://x/events', store, (_u, b) => (again.push(b), true));
    t2.open(true, 'zh-CN');
    t2.flush();
    expect(JSON.parse(again[0]!)[0]).toMatchObject({ ev: 'open', first: false, touch: true, lang: 'zh-CN' });
  });

  it('sends nothing without a url', () => {
    const sent: string[] = [];
    const t = new Telemetry(null, memory(), (_u, b) => (sent.push(b), true));
    t.open(false, 'en');
    t.leave();
    expect(sent).toEqual([]);
  });
});
