import type { DungeonId, Grade } from '@dnf/engine';
import type { Key } from '../i18n';

// Chapter one as the section-select scroll shows it (design/CHAPTER1.md, 选节界面): its sections
// in order, where each lies on the chapter's long thumbnail (client/public/art/scroll/ch1.jpg, made
// by tools/scroll_strip.py), and what of the scroll a player's progress opens. Nothing here touches
// the DOM: the scroll's pictures are drawn by scrollSelect.ts, and a renderer without one (the
// WeChat mini-game) can take the same model and the same panning.

export interface Section {
  /** "1-1": its place in the chapter. */
  id: string;
  /** What it plays. 1-3 is the practice room inside the screen until its own dungeon is made. */
  dungeon: DungeonId;
  name: Key;
  rooms: number;
  /** Its stretch of the thumbnail, as fractions of the strip's width. */
  from: number;
  to: number;
  /** Where its title slip hangs, a fraction of the strip's width. */
  at: number;
}

/** The thumbnail's size in pixels: its width over its height lays the strip out. */
export const STRIP = { w: 2375, h: 640 };

export const CHAPTER1: readonly Section[] = [
  { id: '1-1', dungeon: 'luobi', name: 'section.luobi', rooms: 4, from: 0, to: 0.3, at: 0.1 },
  { id: '1-2', dungeon: 'jiangcun', name: 'section.jiangcun', rooms: 5, from: 0.3, to: 0.65, at: 0.42 },
  { id: '1-3', dungeon: 'pingfeng', name: 'section.screen', rooms: 4, from: 0.65, to: 1, at: 0.8 },
];

/** How much of the next, still shut section shows before the roller (a fraction of the strip). */
export const PEEK = 0.07;

/** What the select screen needs of the progress (progress.ts). */
export interface Cleared {
  cleared(dungeon: string): boolean;
  get(dungeon: string): { grade: Grade; ticks: number; clears: number } | null;
}

/** How many sections lie open: the first always, each after one cleared. */
export function openCount(p: Cleared, sections = CHAPTER1): number {
  let n = 1;
  while (n < sections.length && p.cleared(sections[n - 1].dungeon)) n++;
  return n;
}

/** How many sections from the first are cleared, one after another. */
export function clearedCount(p: Cleared, sections = CHAPTER1): number {
  let n = 0;
  while (n < sections.length && p.cleared(sections[n].dungeon)) n++;
  return n;
}

/** Where the roller stands with `open` sections unrolled: the end of the last open one and a peek
 * of the next, the whole strip once all are open (the chapter's later sections stay in the roll). */
export function unrolledTo(open: number, sections = CHAPTER1): number {
  if (open >= sections.length) return 1;
  return Math.min(1, sections[open - 1].to + PEEK);
}

/** How far the colour reaches with `cleared` sections done: the end of the last one. */
export function colouredTo(cleared: number, sections = CHAPTER1): number {
  return cleared > 0 ? sections[cleared - 1].to : 0;
}

/** The section under a point of the strip (a fraction of its width), or null. */
export function sectionAt(x: number, sections = CHAPTER1): Section | null {
  return sections.find((s) => x >= s.from && x < s.to) ?? (x === 1 ? sections[sections.length - 1] : null);
}

/** The chapter section a dungeon is, or null. */
export function sectionOf(dungeon: DungeonId, sections = CHAPTER1): Section | null {
  return sections.find((s) => s.dungeon === dungeon) ?? null;
}

/** The seal a grade is stamped with: the old ranks of painting (神品 the highest). */
export const SEAL: Record<Grade, Key> = { S: 'seal.S', A: 'seal.A', B: 'seal.B', C: 'seal.C' };

/** A pointer dragging the strip sideways: where it lies (`x`, the strip's left edge from the
 * view's), held between the two ends of what is unrolled, with a tap told apart from a drag and
 * a fling that runs on after a quick release. Times in ms, lengths in any one unit. */
export class Pan {
  x = 0;
  private down: { x: number; at: number; t: number } | null = null;
  private moved = false;
  private v = 0;
  private last = { x: 0, t: 0 };

  /** `view`: the width shown; `content`: the width of what can be dragged through it. */
  constructor(public view: number, public content: number) {}

  /** The leftmost the strip may go (its right end at the view's right), or the centre when it
   * is narrower than the view. */
  get min(): number {
    return this.content <= this.view ? (this.view - this.content) / 2 : this.view - this.content;
  }

  get max(): number {
    return this.content <= this.view ? (this.view - this.content) / 2 : 0;
  }

  clamp(): void {
    this.x = Math.max(this.min, Math.min(this.max, this.x));
  }

  /** Brings the strip's point `at` (in its own lengths) to the view's middle, held in bounds. */
  centre(at: number): void {
    this.x = this.view / 2 - at;
    this.clamp();
  }

  press(px: number, t: number): void {
    this.down = { x: px, at: this.x, t };
    this.moved = false;
    this.v = 0;
    this.last = { x: px, t };
  }

  move(px: number, t: number): void {
    if (!this.down) return;
    if (Math.abs(px - this.down.x) > TAP_SLOP) this.moved = true;
    if (!this.moved) return;
    this.x = this.down.at + px - this.down.x;
    this.clamp();
    const dt = t - this.last.t;
    if (dt > 0) this.v = (px - this.last.x) / dt;
    this.last = { x: px, t };
  }

  /** The pointer lifted: whether it was a tap (it never left its slop). */
  release(t: number): boolean {
    if (!this.down) return false;
    const tap = !this.moved;
    // a pause before lifting stops the fling
    if (t - this.last.t > 80) this.v = 0;
    this.down = null;
    return tap;
  }

  /** The wheel or a trackpad: `d` along. */
  nudge(d: number): void {
    this.v = 0;
    this.x -= d;
    this.clamp();
  }

  /** Runs the fling on by `dt` ms; whether it still moves. */
  step(dt: number): boolean {
    if (this.down || this.v === 0) return false;
    this.x += this.v * dt;
    this.v *= Math.pow(0.995, dt);
    if (Math.abs(this.v) < 0.02) this.v = 0;
    const before = this.x;
    this.clamp();
    if (this.x !== before) this.v = 0;
    return this.v !== 0;
  }
}

/** How far a press may wander and still be a tap, in the pan's lengths. */
const TAP_SLOP = 10;
