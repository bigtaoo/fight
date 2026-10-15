import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog, MAX_BODY, cleanEvent, parseBatch } from '../src/events';
import { funnel, report } from '../src/funnel';
import { startServer } from '../src/server';

// The drop-off analytics: what an event may hold, the POST /events route, and the report.

const SID = 'visit-0001';

describe('events', () => {
  it('keeps the known fields of a known event and rejects bad shapes', () => {
    expect(cleanEvent({ sid: SID, ev: 'room', t: 5, room: 2, dungeon: 'heifeng', name: 'x' })).toEqual({ sid: SID, ev: 'room', t: 5, room: 2, dungeon: 'heifeng' });
    expect(cleanEvent({ sid: SID, ev: 'hack', t: 1 })).toBeNull();
    expect(cleanEvent({ sid: 'short', ev: 'open', t: 1 })).toBeNull();
    expect(cleanEvent({ sid: SID, ev: 'open' })).toBeNull();
    expect(cleanEvent({ sid: SID, ev: 'room', t: 1, room: -1 })).toBeNull();
    expect(cleanEvent({ sid: SID, ev: 'room', t: 1, dungeon: '<script>' })).toBeNull();
    expect(cleanEvent({ sid: SID, ev: 'end', t: 1, outcome: 'won' })).toBeNull();
    expect(parseBatch('nope')).toEqual([]);
    expect(parseBatch(JSON.stringify(Array.from({ length: 80 }, (_, t) => ({ sid: SID, ev: 'open', t }))))).toHaveLength(50);
  });

  it('POST /events appends the day file, from any origin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dnf-events-'));
    const server = await startServer({ port: 0, dataFile: null, eventsDir: dir, log: () => {} });
    try {
      const url = `http://localhost:${server.port}/events`;
      const pre = await fetch(url, { method: 'OPTIONS' });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      const body = JSON.stringify([
        { sid: SID, ev: 'open', t: 0, first: true },
        { sid: SID, ev: 'bogus', t: 1 },
      ]);
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
      expect(res.status).toBe(204);
      expect((await fetch(url, { method: 'POST', body: 'x'.repeat(MAX_BODY + 1) })).status).toBe(413);
      const [file] = await readdir(dir);
      expect(file).toMatch(/^events-\d{4}-\d\d-\d\d\.jsonl$/);
      const lines = (await readFile(join(dir, file!), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ sid: SID, ev: 'open', first: true });
      expect(lines[0].at).toMatch(/^\d{4}-/);
    } finally {
      await server.close();
    }
  });

  it('the report counts how far visits got', async () => {
    const log = new EventLog(null);
    const a = 'visit-aaaa';
    const b = 'visit-bbbb';
    await log.write([
      { sid: a, ev: 'open', t: 0, first: true },
      { sid: a, ev: 'start', t: 1, dungeon: 'heifeng', n: 1 },
      { sid: a, ev: 'room', t: 2, dungeon: 'heifeng', room: 0 },
      { sid: a, ev: 'room', t: 3, dungeon: 'heifeng', room: 1 },
      { sid: a, ev: 'end', t: 4, dungeon: 'heifeng', outcome: 'failed', room: 1, tick: 900 },
      { sid: a, ev: 'start', t: 5, dungeon: 'heifeng', n: 2 },
      { sid: a, ev: 'room', t: 6, dungeon: 'heifeng', room: 2 },
      { sid: a, ev: 'end', t: 7, dungeon: 'heifeng', outcome: 'cleared', room: 2, grade: 'A' },
      { sid: a, ev: 'leave', t: 8, sec: 300 },
      { sid: b, ev: 'open', t: 0, touch: true },
      { sid: b, ev: 'start', t: 1, dungeon: 'heifeng', n: 1 },
      { sid: b, ev: 'room', t: 2, dungeon: 'heifeng', room: 0 },
      { sid: b, ev: 'leave', t: 3, sec: 20, dungeon: 'heifeng', room: 0 },
    ]);
    const f = funnel(log.kept);
    expect(f).toMatchObject({ visits: 2, firstVisits: 1, touch: 1, played: 2, again: 1, seconds: [20, 300] });
    expect(f.dungeons.heifeng).toEqual({ visits: 2, runs: 3, clears: 1, furthest: { 0: 1, 2: 1 }, deaths: { 1: 1 }, quits: { 0: 1 }, grades: { A: 1 } });
    expect(report(f)).toContain('heifeng: 2 visits, 3 runs, 1 clears (33%)');
  });
});
