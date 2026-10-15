import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent } from './eventSchema';

export * from './eventSchema';

/** Appends events to the day's file in `dir`; null `dir` keeps them in memory (tests). */
export class EventLog {
  /** Everything logged, when kept in memory. */
  readonly kept: (GameEvent & { at: string })[] = [];
  private ready: Promise<unknown> | null = null;

  constructor(private readonly dir: string | null, private readonly now: () => Date = () => new Date()) {}

  async write(events: readonly GameEvent[]): Promise<void> {
    if (!events.length) return;
    const at = this.now().toISOString();
    const stamped = events.map((e) => ({ at, ...e }));
    if (!this.dir) {
      this.kept.push(...stamped);
      return;
    }
    this.ready ??= mkdir(this.dir, { recursive: true });
    await this.ready;
    const file = join(this.dir, `events-${at.slice(0, 10)}.jsonl`);
    await appendFile(file, stamped.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}
