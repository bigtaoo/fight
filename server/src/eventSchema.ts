// What a drop-off analytics event may hold (no Node imports: the client's tests check against it).
// Drop-off analytics for the single-player test: where strangers stop playing. The client posts
// a batch of anonymous events (a random id per visit, no personal data); each valid one becomes a
// line of `events-YYYY-MM-DD.jsonl` in the data directory, stamped with the server's time.
// Nothing here is trusted for anything but counting.

/** What a visit can report:
 * - open: the page loaded (`first`: no earlier visit on this device; `touch`: a touch screen);
 * - start: a run began (`n`: the visit's how-many-th);
 * - room: the heroes walked into room `room`;
 * - end: the run ended (`outcome` cleared or failed; `room`, `tick` where; `grade` on a clear);
 * - leave: the page went away (`room`, `tick` of the run still on, if any; `sec`: the visit's length). */
export const EVENT_NAMES = ['open', 'start', 'room', 'end', 'leave'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface GameEvent {
  /** The visit's random id. */
  sid: string;
  ev: EventName;
  /** Milliseconds since the page opened. */
  t: number;
  dungeon?: string;
  room?: number;
  tick?: number;
  n?: number;
  sec?: number;
  outcome?: 'cleared' | 'failed';
  grade?: string;
  first?: boolean;
  touch?: boolean;
  lang?: string;
}

/** The most a batch may hold, and its most bytes. */
export const MAX_BATCH = 50;
export const MAX_BODY = 16 * 1024;

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const WORD = /^[A-Za-z0-9_-]{1,24}$/;
const NUMBERS = ['t', 'room', 'tick', 'n', 'sec'] as const;
const WORDS = ['dungeon', 'grade', 'lang'] as const;
const FLAGS = ['first', 'touch'] as const;

/** The event as we keep it, or null when it is not one we know: unknown fields are dropped,
 * a known field of the wrong shape rejects the event. */
export function cleanEvent(v: unknown): GameEvent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.sid !== 'string' || !ID.test(o.sid)) return null;
  if (!EVENT_NAMES.includes(o.ev as EventName)) return null;
  const out: Record<string, unknown> = { sid: o.sid, ev: o.ev };
  for (const k of NUMBERS) {
    if (o[k] === undefined) continue;
    if (!Number.isSafeInteger(o[k]) || (o[k] as number) < 0) return null;
    out[k] = o[k];
  }
  for (const k of WORDS) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string' || !WORD.test(o[k] as string)) return null;
    out[k] = o[k];
  }
  for (const k of FLAGS) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'boolean') return null;
    out[k] = o[k];
  }
  if (o.outcome !== undefined) {
    if (o.outcome !== 'cleared' && o.outcome !== 'failed') return null;
    out.outcome = o.outcome;
  }
  if (typeof out.t !== 'number') return null;
  return out as unknown as GameEvent;
}

/** The valid events of a posted body (a JSON array), at most MAX_BATCH. */
export function parseBatch(body: string): GameEvent[] {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_BATCH)
    .map(cleanEvent)
    .filter((e): e is GameEvent => e !== null);
}

