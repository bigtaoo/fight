import type { Grade } from '@dnf/engine';
import { SEAL, type Section } from './chapter';
import { INK, PAPER, RED } from './dom';
import { font, pressedAt, roundRect, seal, spareCanvas, type Picture } from './paint';
import type { ScrollPictures } from './scrollCanvas';
import { t } from '../i18n';

// A chapter section cleared, drawn on a canvas for a renderer without a DOM (sectionEnd.ts is the
// HTML one): the section's stretch of the painting in ink, its colour blooming out from the middle,
// then the grade's seal pressed at its corner, the section's name under it. Without the web
// build's HUD and menu, a button under it goes back to the scroll. Laid out on the same logical
// 1920×1080 screen, fitted into the view.

const VIEW_W = 1920;
const VIEW_H = 1080;
const TOP = 24;
const H = 320;
const BLOOM_MS = 1600;
const STAMP_MS = 1800;
/** The way back to the scroll, on the logical screen. */
const BACK = { w: 360, h: 96, top: TOP + H + 110 };

export class SectionEndCanvas {
  private vw = 1;
  private vh = 1;
  private dpr = 1;
  private sec: Section | null = null;
  private grade: Grade = 'C';
  private time = 0;
  /** The colour as far as the bloom has spread, made on a spare canvas. */
  private wash: HTMLCanvasElement | null = null;
  dirty = false;

  onBack: () => void = () => {};
  onClick: () => void = () => {};

  constructor(private readonly pics: ScrollPictures) {}

  get open(): boolean {
    return this.sec !== null;
  }

  resize(w: number, h: number, dpr: number): void {
    this.vw = w;
    this.vh = h;
    this.dpr = dpr;
    this.dirty = true;
  }

  show(sec: Section, grade: Grade): void {
    this.sec = sec;
    this.grade = grade;
    this.time = 0;
    this.dirty = true;
  }

  hide(): void {
    this.sec = null;
    this.dirty = true;
  }

  tick(dt: number): void {
    if (!this.sec) return;
    this.time += dt;
    // still blooming, or the seal still landing
    if (this.time < STAMP_MS + 400 + dt) this.dirty = true;
  }

  /** The logical screen's scale and offset in the view (contain). */
  private get fit(): { s: number; ox: number; oy: number } {
    const s = Math.min(this.vw / VIEW_W, this.vh / VIEW_H);
    return { s, ox: (this.vw - VIEW_W * s) / 2, oy: (this.vh - VIEW_H * s) / 2 };
  }

  press(): void {}

  move(): void {}

  release(x: number, y: number): void {
    if (!this.sec) return;
    const { s, ox, oy } = this.fit;
    const lx = (x - ox) / s;
    const ly = (y - oy) / s;
    const bx = (VIEW_W - BACK.w) / 2;
    if (lx >= bx && lx <= bx + BACK.w && ly >= BACK.top && ly <= BACK.top + BACK.h) {
      this.onClick();
      this.onBack();
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    this.dirty = false;
    g.clearRect(0, 0, this.vw, this.vh);
    const sec = this.sec;
    if (!sec) return;
    const { s, ox, oy } = this.fit;
    g.save();
    g.translate(ox, oy);
    g.scale(s, s);
    const { ink, colour } = this.pics;
    const full = (H * ink.width) / ink.height;
    const w = (sec.to - sec.from) * full;
    const left = (VIEW_W - w) / 2;
    // the mount: a paper margin and an ink line round it
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    g.fillStyle = INK;
    g.fillRect(left - 9, TOP - 9, w + 18, H + 18);
    g.restore();
    g.fillStyle = PAPER;
    g.fillRect(left - 6, TOP - 6, w + 12, H + 12);
    g.drawImage(ink, sec.from * ink.width, 0, (sec.to - sec.from) * ink.width, ink.height, left, TOP, w, H);
    // the wash spreading from the middle: fast at first, slowing as it soaks out
    const k = Math.min(1, this.time / BLOOM_MS);
    const r = (Math.hypot(w, H) / 2) * 1.15 * (1 - Math.pow(1 - k, 2.2));
    if (r > 0) this.drawWash(g, colour, sec, left, w, r, s);
    // the seal at the painting's lower right, half over its edge, as a collector's would be
    if (this.time >= STAMP_MS) seal(g, t(SEAL[this.grade]), left + w - 80 + 60, TOP + H - 96 + 60, 120, (-6 * Math.PI) / 180, pressedAt(this.time - STAMP_MS));
    // the section's name, haloed in paper over the scene
    const [c, n] = sec.id.split('-');
    const text = `${t('section.num', { c, s: n })}    ${t(sec.name)}    ${t('hud.cleared')}`;
    g.font = font(40);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.save();
    g.shadowColor = PAPER;
    g.shadowBlur = 12 * s;
    g.strokeStyle = 'rgba(243,238,226,.85)';
    g.lineWidth = 10;
    g.lineJoin = 'round';
    g.strokeText(text, VIEW_W / 2, TOP + H + 22);
    g.restore();
    g.fillStyle = INK;
    g.fillText(text, VIEW_W / 2, TOP + H + 22);
    // 回到画卷
    const bx = (VIEW_W - BACK.w) / 2;
    g.fillStyle = PAPER;
    roundRect(g, bx, BACK.top, BACK.w, BACK.h, 14);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 4;
    roundRect(g, bx + 2, BACK.top + 2, BACK.w - 4, BACK.h - 4, 12);
    g.stroke();
    g.fillStyle = RED;
    g.font = font(44, true);
    g.textBaseline = 'middle';
    g.fillText(t('result.scroll'), VIEW_W / 2, BACK.top + BACK.h / 2);
    g.restore();
    g.textAlign = 'left';
  }

  /** The colour inside a circle of radius `r` round the painting's 50%/55%, its last 90 px fading. */
  private drawWash(g: CanvasRenderingContext2D, colour: Picture, sec: Section, left: number, w: number, r: number, s: number): void {
    const d = s * this.dpr;
    const cw = Math.ceil(w * d);
    const ch = Math.ceil(H * d);
    const e = (this.wash ??= spareCanvas(cw, ch));
    if (e.width !== cw || e.height !== ch) {
      e.width = cw;
      e.height = ch;
    }
    const eg = e.getContext('2d')!;
    eg.globalCompositeOperation = 'source-over';
    eg.clearRect(0, 0, cw, ch);
    eg.drawImage(colour, sec.from * colour.width, 0, (sec.to - sec.from) * colour.width, colour.height, 0, 0, cw, ch);
    eg.globalCompositeOperation = 'destination-in';
    const cx = cw * 0.5;
    const cy = ch * 0.55;
    const mask = eg.createRadialGradient(cx, cy, 0, cx, cy, r * d);
    mask.addColorStop(0, '#000');
    mask.addColorStop(Math.max(0, r - 90) / r, '#000');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    eg.fillStyle = mask;
    eg.fillRect(0, 0, cw, ch);
    g.drawImage(e, 0, 0, cw, ch, left, TOP, w, H);
  }
}
