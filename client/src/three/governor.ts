/**
 * Keeps a frame cap (`?fps=30`) held by trading picture quality for time: it watches the intervals
 * between drawn frames, steps one level down when frames start missing their slot, and probes one
 * level back up after a spell of clean frames (waiting longer each time a probe fails).
 *
 * A miss is a frame that came a whole display frame late (at 30 on a 60 Hz screen, 50 ms instead of
 * 33). Lone misses are scheduling noise that no quality level fixes (the A16 soak: 16 in 18000 at
 * full quality), so it only steps down on several within a couple of seconds.
 */
export class Governor {
  /** 0 is full quality; higher is cheaper. */
  level = 0;
  /** Up-steps wait for this many clean seconds; doubles when a probe fails. */
  private hold = 8;
  private clean = 0;
  /** Seconds since the last level change: misses right after one are the change itself (resizing). */
  private since = 0;
  /** The level probed up from, while the probe is on trial. */
  private probe = -1;
  private misses: number[] = [];
  /** The device says it is under pressure (Compute Pressure API, where there is one): no probing up. */
  private hot = false;

  constructor(
    private readonly target: number,
    private readonly levels: number,
    private readonly apply: (level: number) => void,
  ) {
    const P = (globalThis as { PressureObserver?: new (cb: (r: { state: string }[]) => void) => { observe(s: string): Promise<void> } }).PressureObserver;
    if (!P) return;
    try {
      void new P((records) => {
        const state = records[records.length - 1]?.state;
        const hot = state === 'serious' || state === 'critical';
        if (hot && !this.hot) this.step(1);
        this.hot = hot;
      })
        .observe('cpu')
        .catch(() => undefined);
    } catch {
      // not allowed here (a frame without permission): frame times alone then
    }
  }

  /** One drawn frame, `ms` after the one before it. */
  frame(ms: number): void {
    // a load or the tab coming back, not the drawing
    if (ms > 250) return;
    const s = ms / 1000;
    this.since += s;
    this.clean += s;
    if (this.since < 1) return;
    const now = this.since;
    if (ms > this.target + 12) {
      this.misses.push(now);
      this.clean = 0;
    }
    while (this.misses.length && now - this.misses[0] > 2) this.misses.shift();
    if (this.misses.length >= 3) {
      // a failed probe goes back down and waits twice as long before the next one
      if (this.probe >= 0) this.hold = Math.min(this.hold * 2, 120);
      this.step(1);
      return;
    }
    // a probe that held for 4 s is the new level
    if (this.probe >= 0 && this.since > 4) {
      this.probe = -1;
      this.hold = Math.max(8, this.hold / 2);
    }
    if (this.level > 0 && !this.hot && this.probe < 0 && this.clean > this.hold) {
      this.probe = this.level;
      this.step(-1);
    }
  }

  private step(d: number): void {
    const next = Math.min(Math.max(this.level + d, 0), this.levels - 1);
    if (d > 0) this.probe = -1;
    this.misses = [];
    this.clean = 0;
    this.since = 0;
    if (next === this.level) return;
    this.level = next;
    this.apply(next);
  }
}
