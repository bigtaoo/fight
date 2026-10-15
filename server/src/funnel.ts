import type { GameEvent } from './events';

// The drop-off report: from the logged events, how far visits got. Rooms are counted from 0,
// as the engine does; "furthest room" is over all of a visit's runs of that dungeon.

export interface Funnel {
  visits: number;
  firstVisits: number;
  touch: number;
  /** Visits that started at least one run. */
  played: number;
  /** Visits that started a second run (a retry, or a new dungeon). */
  again: number;
  /** Per dungeon. */
  dungeons: Record<string, DungeonFunnel>;
  /** Visit lengths in seconds (from `leave`), sorted. */
  seconds: number[];
}

export interface DungeonFunnel {
  /** Visits that started it. */
  visits: number;
  runs: number;
  clears: number;
  /** Visits by the furthest room they walked into. */
  furthest: Record<number, number>;
  /** Failed runs by the room they ended in. */
  deaths: Record<number, number>;
  /** Runs left with the page while still going, by room. */
  quits: Record<number, number>;
  /** Clears by grade. */
  grades: Record<string, number>;
}

export function funnel(events: readonly GameEvent[]): Funnel {
  const bySid = new Map<string, GameEvent[]>();
  for (const e of events) {
    const list = bySid.get(e.sid) ?? [];
    list.push(e);
    bySid.set(e.sid, list);
  }
  const f: Funnel = { visits: 0, firstVisits: 0, touch: 0, played: 0, again: 0, dungeons: {}, seconds: [] };
  const bump = (r: Record<string | number, number>, k: string | number) => (r[k] = (r[k] ?? 0) + 1);
  for (const list of bySid.values()) {
    list.sort((a, b) => a.t - b.t);
    f.visits++;
    const open = list.find((e) => e.ev === 'open');
    if (open?.first) f.firstVisits++;
    if (open?.touch) f.touch++;
    const starts = list.filter((e) => e.ev === 'start');
    if (starts.length) f.played++;
    if (starts.length > 1) f.again++;
    // the page can hide and come back: the last leave is the one that counts
    const leave = list.filter((e) => e.ev === 'leave').at(-1);
    if (leave?.sec !== undefined) f.seconds.push(leave.sec);
    const furthest = new Map<string, number>();
    let dungeon: string | undefined;
    for (const e of list) {
      if (e.ev === 'start') dungeon = e.dungeon;
      const d = e.dungeon ?? dungeon;
      if (!d) continue;
      const df = (f.dungeons[d] ??= { visits: 0, runs: 0, clears: 0, furthest: {}, deaths: {}, quits: {}, grades: {} });
      if (e.ev === 'start') {
        df.runs++;
        if (!furthest.has(d)) furthest.set(d, 0);
      } else if (e.ev === 'room' && e.room !== undefined) {
        furthest.set(d, Math.max(furthest.get(d) ?? 0, e.room));
      } else if (e.ev === 'end') {
        if (e.outcome === 'cleared') {
          df.clears++;
          if (e.grade) bump(df.grades, e.grade);
        } else if (e.room !== undefined) bump(df.deaths, e.room);
      } else if (e === leave && e.room !== undefined) bump(df.quits, e.room);
    }
    for (const [d, room] of furthest) {
      f.dungeons[d]!.visits++;
      bump(f.dungeons[d]!.furthest, room);
    }
  }
  f.seconds.sort((a, b) => a - b);
  return f;
}

/** The report as text. */
export function report(f: Funnel): string {
  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '-');
  const median = f.seconds.length ? f.seconds[f.seconds.length >> 1] : 0;
  const lines = [
    `visits ${f.visits} (first time ${pct(f.firstVisits, f.visits)}, touch ${pct(f.touch, f.visits)})`,
    `played ${f.played} (${pct(f.played, f.visits)}), played again ${f.again} (${pct(f.again, f.played)})`,
    `visit length: median ${median}s over ${f.seconds.length} that reported it`,
  ];
  for (const [d, df] of Object.entries(f.dungeons)) {
    lines.push('', `${d}: ${df.visits} visits, ${df.runs} runs, ${df.clears} clears (${pct(df.clears, df.runs)})`);
    const rooms = Object.keys({ ...df.furthest, ...df.deaths, ...df.quits }).map(Number).sort((a, b) => a - b);
    // visits that got at least this far
    let left = df.visits;
    lines.push('  room  reached  died  left');
    for (const r of rooms) {
      lines.push(`  ${String(r).padStart(4)}  ${`${left} ${pct(left, df.visits)}`.padStart(7)}  ${String(df.deaths[r] ?? 0).padStart(4)}  ${String(df.quits[r] ?? 0).padStart(4)}`);
      left -= df.furthest[r] ?? 0;
    }
    if (Object.keys(df.grades).length) lines.push(`  grades ${Object.entries(df.grades).map(([g, n]) => `${g} ${n}`).join(', ')}`);
  }
  return lines.join('\n');
}
