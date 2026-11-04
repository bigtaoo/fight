import type { Grade } from '@dnf/engine';
import { CHAPTER1, PEEK, Pan, SEAL, clock, colouredTo, openCount, opening, replay, sectionAt, unrolledTo, type Cleared, type Section, type Seen } from './chapter';
import { INK, PAPER, RED } from './dom';
import { column, columnHeight, font, pressedAt, roundRect, seal, spaced, spareCanvas, type Picture } from './paint';
import { getLang, t } from '../i18n';
import type { BagStore } from '../platform/store';

// The section select drawn on a canvas, for a renderer without a DOM (the WeChat mini-game; see
// scrollSelect.ts for the HTML one the web build shows, design/CHAPTER1.md 选节界面). The same
// handscroll and the same flow: dragged sideways, cleared sections in colour with their seal by
// the title slip, the open one in ink, the rest in the roller with a shaded peek of the next; a
// clear since it last opened blooms in, is stamped and unrolls on. A tap opens a section's slip
// (name, rooms, best clear or 尚未入画, the swordsman, 入画). Laid out in CSS pixels from the
// height of the painting, as the HTML one is.

const DESK = '#2b2723';
const SILK = '#9fb4ab';
/** The desk left at either end of the scroll, a fraction of the painting's height. */
const MARGIN = 0.04;
const ROD: [number, string][] = [
  [0, '#3b2a1e'],
  [0.35, '#7a5a3e'],
  [0.5, '#a07850'],
  [0.7, '#6a4a30'],
  [1, '#2e2016'],
];

export interface ScrollPictures {
  ink: Picture;
  colour: Picture;
  silk: Picture | null;
}

interface Card {
  section: Section;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The start button, when the section is open. */
  go: { x: number; y: number; w: number; h: number } | null;
}

export class ScrollCanvas {
  private readonly pan = new Pan(1, 1);
  private vw = 1;
  private vh = 1;
  private dpr = 1;
  /** The band the scroll lies in, the painting's height and width, the left roller's and the
   * right roll's widths (CSS px). */
  private bandTop = 0;
  private bandH = 1;
  private h = 1;
  private w = 1;
  private rodW = 1;
  private rollW = 1;
  private unrolled = 0;
  private coloured = 0;
  private anim: { from: Seen; to: Seen; t: number } | null = null;
  private progress: Cleared | null = null;
  private card: Card | null = null;
  /** How many sections' seals are on the scroll, and when each was stamped (ms of `clock`). */
  private stamped = 0;
  private readonly stampedAt: number[] = [];
  private time = 0;
  /** The soft edge of the colour, made on a spare canvas. */
  private edge: HTMLCanvasElement | null = null;
  /** Something changed since the last draw. */
  dirty = true;
  open = false;
  /** All sections unrolled whatever the progress (?unroll, for development). */
  unrollAll = false;

  onStart: (s: Section) => void = () => {};
  onClick: () => void = () => {};

  constructor(
    private readonly store: BagStore,
    private readonly pics: ScrollPictures,
  ) {}

  /** The view's size in CSS px and its pixel ratio. */
  resize(w: number, h: number, dpr: number): void {
    this.vw = w;
    this.vh = h;
    this.dpr = dpr;
    this.layout();
    this.pan.clamp();
    this.dirty = true;
  }

  /** Opens the scroll, with what cleared since it last opened played in. */
  show(progress: Cleared): void {
    this.progress = progress;
    this.open = true;
    const { from, to } = opening(this.store, progress, this.unrollAll);
    this.anim = from.open !== to.open || from.cleared !== to.cleared ? { from, to, t: 0 } : null;
    this.unrolled = unrolledTo(from.open);
    this.coloured = colouredTo(from.cleared);
    this.stamped = from.cleared;
    this.stampedAt.length = 0;
    this.card = null;
    this.layout();
    const open = CHAPTER1[Math.min(to.open, CHAPTER1.length) - 1];
    this.pan.centre(MARGIN * this.h + this.rodW + (this.anim ? this.unrolled : open.at) * this.w);
    this.syncContent();
    this.dirty = true;
  }

  hide(): void {
    this.open = false;
  }

  private layout(): void {
    const iw = this.vw;
    const ih = this.vh;
    this.bandH = Math.min(ih * 0.78, iw * 0.62);
    this.bandTop = (ih - this.bandH) / 2 + ih * 0.03;
    this.h = this.bandH * 0.86;
    this.w = (this.h * this.pics.ink.width) / this.pics.ink.height;
    this.rodW = this.bandH * 0.05;
    this.rollW = this.bandH * 0.14;
    this.pan.view = iw;
    this.syncContent();
    if (this.card) this.openCard(this.card.section);
  }

  /** The width that can be dragged through: a margin of desk at either end. */
  private syncContent(): void {
    this.pan.content = MARGIN * this.h * 2 + this.rodW + this.unrolled * this.w + this.rollW * 0.65;
    this.pan.clamp();
  }

  /** The paper's left edge on the screen. */
  private get paperX(): number {
    return this.pan.x + MARGIN * this.h + this.rodW;
  }

  /** Runs the fling and the replay on by `dt` ms. */
  tick(dt: number): void {
    if (!this.open) return;
    this.time += dt;
    if (this.pan.step(dt)) this.dirty = true;
    const a = this.anim;
    if (a) {
      a.t += dt;
      const r = replay(a.from, a.to, a.t);
      this.coloured = r.coloured;
      this.unrolled = r.unrolled;
      if (r.stamp && this.stamped < a.to.cleared) {
        for (let i = this.stamped; i < a.to.cleared; i++) this.stampedAt[i] = this.time;
        this.stamped = a.to.cleared;
      }
      this.syncContent();
      if (r.rolling) this.pan.centre(MARGIN * this.h + this.rodW + this.unrolled * this.w - this.pan.view * 0.25);
      if (r.done) this.anim = null;
      this.dirty = true;
    }
    // a seal still landing
    if (this.stampedAt.some((at) => at !== undefined && this.time - at < 400)) this.dirty = true;
  }

  press(x: number, y: number, t: number): void {
    if (this.inCard(x, y)) return;
    this.pan.press(x, t);
  }

  move(x: number, _y: number, t: number): void {
    const before = this.pan.x;
    this.pan.move(x, t);
    if (this.pan.x !== before) {
      this.dirty = true;
      if (this.card) this.placeCard();
    }
  }

  release(x: number, y: number, t: number): void {
    const card = this.card;
    if (card && this.inCard(x, y)) {
      const g = card.go;
      if (g && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) {
        this.onClick();
        this.onStart(card.section);
      }
      return;
    }
    if (this.pan.release(t)) this.tap(x);
  }

  /** The wheel or a trackpad. */
  nudge(d: number): void {
    this.pan.nudge(d);
    if (this.card) this.placeCard();
    this.dirty = true;
  }

  private inCard(x: number, y: number): boolean {
    const c = this.card;
    return !!c && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
  }

  /** A tap on the painting: the section under it opens its slip, anywhere else closes one. */
  private tap(px: number): void {
    const x = (px - this.paperX) / this.w;
    const sec = x >= 0 && x <= this.unrolled ? sectionAt(x) : null;
    this.dirty = true;
    if (!sec || sec === this.card?.section) {
      this.card = null;
      return;
    }
    this.onClick();
    this.openCard(sec);
  }

  private get em(): number {
    return Math.max(12, this.bandH * 0.045);
  }

  private openCard(sec: Section): void {
    const em = this.em;
    const i = CHAPTER1.indexOf(sec);
    const open = this.unrollAll || !this.progress || i < openCount(this.progress);
    const w = em * 14;
    // as drawCard lays it out: number, name, rooms, then the shut note or best, hero row, 入画
    const lines = em * 0.9 + em * 0.7 * 1.3 + em * 0.15 + em * 1.6 * 1.3 + em * 0.3 + em * 0.8 * 1.3;
    let h: number;
    let go: Card['go'] = null;
    if (!open) h = lines + em * 0.8 + em * 1.3 + em * 0.9;
    else {
      const y = lines + em * 0.4 + em * 0.8 * 1.3 + em * 0.8 + (em * 0.8 * 1.2 + em * 0.4) + em * 0.9;
      go = { x: em * 1.1, y, w: w - em * 2.2, h: em * 2.1 };
      h = y + go.h + em * 0.9;
    }
    this.card = { section: sec, x: 0, y: 0, w, h, go };
    this.placeCard();
  }

  /** The slip over the middle of its section, kept inside the view. */
  private placeCard(): void {
    const c = this.card;
    if (!c) return;
    const sec = c.section;
    const x = Math.max(8, Math.min(this.vw - c.w - 8, this.paperX + ((sec.from + Math.min(sec.to, this.unrolled)) / 2) * this.w - c.w * 0.5));
    const y = Math.max(8, Math.min(this.vh - c.h - 8, this.bandTop + this.bandH * 0.5 - c.h * 0.4));
    if (c.go) {
      c.go.x += x - c.x;
      c.go.y += y - c.y;
    }
    c.x = x;
    c.y = y;
  }

  draw(g: CanvasRenderingContext2D): void {
    this.dirty = false;
    const { vw, vh } = this;
    const bg = g.createRadialGradient(vw * 0.5, vh * 0.4, 0, vw * 0.5, vh * 0.4, Math.hypot(vw, vh) * 0.5 * 0.7);
    bg.addColorStop(0, '#3a342e');
    bg.addColorStop(1, DESK);
    g.fillStyle = bg;
    g.fillRect(0, 0, vw, vh);

    // the title above the scroll
    let fs = Math.max(14, Math.min(this.bandH * 0.075, vw / 28));
    g.font = font(fs, true);
    // a long title (the English one) is set smaller until it fits across the screen
    const title = t('scroll.title');
    const wide = [...title].reduce((w, c) => w + g.measureText(c).width + fs * 0.3, -fs * 0.3);
    if (wide > vw * 0.94) {
      fs = Math.max(10, (fs * vw * 0.94) / wide);
      g.font = font(fs, true);
    }
    g.fillStyle = 'rgba(243,238,226,.85)';
    g.textBaseline = 'top';
    spaced(g, title, vw / 2, Math.max(4, this.bandTop - this.bandH * 0.16), fs * 0.3);

    const top = this.bandTop;
    const bh = this.bandH;
    const trackX = this.pan.x + MARGIN * this.h;
    const paperW = this.unrolled * this.w;
    // the left roller (天杆)
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 10;
    g.shadowOffsetX = 4;
    g.fillStyle = rod(g, trackX, this.rodW);
    roundRect(g, trackX, top - bh * 0.04, this.rodW, bh * 1.08, 6);
    g.fill();
    g.restore();
    this.drawPaper(g, this.paperX, top, paperW);
    this.drawRoll(g, this.paperX + paperW - this.rollW * 0.35, top);
    if (this.card) this.drawCard(g, this.card);
  }

  private drawPaper(g: CanvasRenderingContext2D, x: number, top: number, paperW: number): void {
    const bh = this.bandH;
    const { ink, colour, silk } = this.pics;
    g.save();
    g.beginPath();
    g.rect(x, top, paperW, bh);
    g.clip();
    g.fillStyle = PAPER;
    g.fillRect(x, top, paperW, bh);
    const y = top + bh * 0.07;
    const iw = ink.width;
    // the ink painting, then its colour as far as the sections cleared, the edge a soft bloom
    g.drawImage(ink, 0, 0, iw * this.unrolled, ink.height, x, y, paperW, this.h);
    const c = this.coloured * this.w;
    const soft = this.h * 0.25;
    const hard = Math.max(0, c - soft);
    const cw = colour.width / this.w;
    if (hard > 0) g.drawImage(colour, 0, 0, hard * cw, colour.height, x, y, hard, this.h);
    if (c > 0) {
      const sw = c - hard;
      const d = this.dpr;
      const e = (this.edge ??= spareCanvas(soft * d, this.h * d));
      if (e.width !== Math.ceil(soft * d) || e.height !== Math.ceil(this.h * d)) {
        e.width = Math.ceil(soft * d);
        e.height = Math.ceil(this.h * d);
      }
      const eg = e.getContext('2d')!;
      eg.globalCompositeOperation = 'source-over';
      eg.clearRect(0, 0, e.width, e.height);
      eg.drawImage(colour, hard * cw, 0, sw * cw, colour.height, 0, 0, sw * d, e.height);
      eg.globalCompositeOperation = 'destination-in';
      const fade = eg.createLinearGradient(0, 0, sw * d, 0);
      fade.addColorStop(0, '#000');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      eg.fillStyle = fade;
      eg.fillRect(0, 0, sw * d, e.height);
      g.drawImage(e, 0, 0, sw * d, e.height, x + hard, y, sw, this.h);
    }
    // the peek of the next section, shut
    if (this.unrolled < 1) {
      const sx = x + (this.unrolled - PEEK) * this.w;
      const sw = PEEK * this.w;
      const shade = g.createLinearGradient(sx, 0, sx + sw, 0);
      shade.addColorStop(0, 'rgba(43,39,35,0)');
      shade.addColorStop(0.4, 'rgba(43,39,35,.45)');
      shade.addColorStop(1, 'rgba(43,39,35,.45)');
      g.fillStyle = shade;
      g.fillRect(sx, y, sw, this.h);
    }
    // the silk of the mounting along the top and the bottom
    const sh = bh * 0.07;
    for (const [sy, flip] of [
      [top, false],
      [top + bh - sh, true],
    ] as const) {
      g.save();
      g.translate(0, flip ? sy + sh : sy);
      if (flip) g.scale(1, -1);
      if (!flip) {
        g.shadowColor = 'rgba(0,0,0,.25)';
        g.shadowBlur = 4;
        g.shadowOffsetY = 2;
      }
      g.fillStyle = SILK;
      g.fillRect(x, 0, paperW, sh);
      g.shadowColor = 'transparent';
      if (silk) {
        const tw = (silk.width * sh) / silk.height;
        for (let tx = x; tx < x + paperW; tx += tw) g.drawImage(silk, tx, 0, tw, sh);
      }
      g.restore();
    }
    // the title slips (题签), and the seal of the best grade beside each one cleared
    for (let i = 0; i < CHAPTER1.length; i++) {
      const sec = CHAPTER1[i];
      if (sec.at >= this.unrolled) continue;
      this.drawSlip(g, sec, i, x + sec.at * this.w, top + this.h * 0.2);
    }
    g.restore();
  }

  private drawSlip(g: CanvasRenderingContext2D, sec: Section, i: number, x: number, y: number): void {
    const fs = this.h * 0.05;
    const small = fs * 0.62;
    g.font = font(fs, true);
    const name = t(sec.name);
    const hName = columnHeight(g, name, fs);
    const hId = columnHeight(g, sec.id, small);
    const w = fs * 0.6 + fs * 1.1 + fs * 0.15 + small * 1.1;
    const h = fs + Math.max(hName, hId);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.25)';
    g.shadowBlur = 6;
    g.shadowOffsetX = 2;
    g.shadowOffsetY = 3;
    g.fillStyle = 'rgba(243,238,226,.92)';
    g.fillRect(x, y, w, h);
    g.restore();
    g.strokeStyle = 'rgba(20,19,23,.4)';
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    g.fillStyle = INK;
    // vertical-rl: the number in the right-hand column, the name to its left
    g.globalAlpha = 0.7;
    g.font = font(small, true);
    column(g, sec.id, x + w - fs * 0.3 - small * 0.55, y + fs * 0.5, small);
    g.globalAlpha = 1;
    g.font = font(fs, true);
    column(g, name, x + fs * 0.3 + fs * 0.55, y + fs * 0.5, fs);
    const best = this.progress?.get(sec.dungeon);
    if (!best || i >= this.stamped) return;
    const size = fs * 1.5;
    const at = this.stampedAt[i];
    seal(g, t(SEAL[best.grade]), x - fs * 1.75 + size / 2, y + h + fs * 0.6 - size / 2, size, (-4 * Math.PI) / 180, at === undefined ? 1 : pressedAt(this.time - at));
  }

  private drawRoll(g: CanvasRenderingContext2D, x: number, top: number): void {
    const rh = this.bandH * 1.04;
    const ry = top - this.bandH * 0.02;
    const w = this.rollW;
    // the rod's ends showing above and below the paper
    g.fillStyle = rod(g, x + w * 0.22, w * 0.56);
    roundRect(g, x + w * 0.22, ry - rh * 0.05, w * 0.56, rh * 1.1, 6);
    g.fill();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 14;
    g.shadowOffsetX = -6;
    const body = g.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, '#c9bfa8');
    body.addColorStop(0.3, PAPER);
    body.addColorStop(0.45, '#fffaf0');
    body.addColorStop(0.75, '#d8ceb6');
    body.addColorStop(1, '#8f866f');
    g.fillStyle = body;
    roundRect(g, x, ry, w, rh, 14);
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.15)';
    g.lineWidth = 1;
    roundRect(g, x + 0.5, ry + 0.5, w - 1, rh - 1, 14);
    g.stroke();
    // what is still rolled up, written down it
    const fs = Math.max(11, this.bandH * 0.035);
    const note = t('section.rolled');
    g.fillStyle = 'rgba(20,19,23,.55)';
    g.font = font(fs, true);
    const nh = columnHeight(g, note, fs, 1);
    column(g, note, x + w / 2, ry + (rh - nh) / 2, fs, 1);
  }

  /** The section's slip: number and name, rooms, best clear, the hero, the start; a shut one only
   * says what opens it. */
  private drawCard(g: CanvasRenderingContext2D, c: Card): void {
    const em = this.em;
    const sec = c.section;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.5)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 10;
    g.fillStyle = PAPER;
    roundRect(g, c.x, c.y, c.w, c.h, 10);
    g.fill();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 3;
    roundRect(g, c.x + 1.5, c.y + 1.5, c.w - 3, c.h - 3, 9);
    g.stroke();

    const left = c.x + em * 1.1;
    let y = c.y + em * 0.9;
    const line = (text: string, size: number, alpha = 1, colour = INK) => {
      g.globalAlpha = alpha;
      g.fillStyle = colour;
      g.font = font(size, true);
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(text, left, y + size * 0.15, c.w - em * 2.2);
      g.globalAlpha = 1;
      y += size * 1.3;
    };
    const [ch, num] = sec.id.split('-');
    line(t('section.num', { c: ch, s: num }), em * 0.7, 0.65);
    y += em * 0.15;
    line(t(sec.name), em * 1.6);
    y += em * 0.3;
    line(t('section.rooms', { n: sec.rooms }), em * 0.8, 0.8);
    if (!c.go) {
      y += em * 0.8;
      line(t('section.shut', { id: CHAPTER1[CHAPTER1.indexOf(sec) - 1].id }), em, 1, RED);
      return;
    }
    y += em * 0.4;
    const best = this.progress?.get(sec.dungeon);
    line(best ? t('section.best', { grade: gradeName(best.grade), time: clock(best.ticks), n: best.clears }) : t('section.new'), em * 0.8);
    y += em * 0.8;
    // the hero: the swordsman alone in chapter one's first sections (the lion joins at 1-5)
    const fs = em * 0.8;
    const chipH = fs * 1.2 + em * 0.4;
    g.font = font(fs, true);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    let x = left;
    const mid = y + chipH / 2;
    g.globalAlpha = 0.7;
    g.fillStyle = INK;
    g.fillText(t('section.hero'), x, mid);
    g.globalAlpha = 1;
    x += g.measureText(t('section.hero')).width + em * 0.4;
    const chip = (text: string, on: boolean) => {
      const w = g.measureText(text).width + em * 0.8;
      roundRect(g, x, y, w, chipH, em * 0.3);
      if (on) {
        g.fillStyle = INK;
        g.fill();
        g.fillStyle = PAPER;
      } else {
        g.globalAlpha = 0.45;
        g.strokeStyle = 'rgba(20,19,23,.3)';
        g.lineWidth = 2;
        roundRect(g, x + 1, y + 1, w - 2, chipH - 2, em * 0.3);
        g.stroke();
        g.fillStyle = INK;
      }
      g.textAlign = 'center';
      g.fillText(text, x + w / 2, mid);
      g.textAlign = 'left';
      g.globalAlpha = 1;
      x += w + em * 0.3;
    };
    chip(t('section.sword'), true);
    for (let k = 0; k < 2; k++) chip(t('section.soon'), false);
    // 入画
    const b = c.go;
    g.fillStyle = RED;
    roundRect(g, b.x, b.y, b.w, b.h, em * 0.35);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 3;
    roundRect(g, b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, em * 0.35);
    g.stroke();
    g.fillStyle = PAPER;
    g.font = font(em * 1.1, true);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t('section.start'), b.x + b.w / 2, b.y + b.h / 2);
    g.textAlign = 'left';
  }
}

function rod(g: CanvasRenderingContext2D, x: number, w: number): CanvasGradient {
  const r = g.createLinearGradient(x, 0, x + w, 0);
  for (const [at, c] of ROD) r.addColorStop(at, c);
  return r;
}

/** The grade as the seal names it, and the letter in English beside the word. */
function gradeName(g: Grade): string {
  return getLang() === 'zh' ? t(SEAL[g]) : `${g} (${t(SEAL[g])})`;
}
