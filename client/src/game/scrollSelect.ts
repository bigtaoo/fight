import type { Grade } from '@dnf/engine';
import { CHAPTER1, PEEK, Pan, SEAL, STRIP, clock, colouredTo, openCount, opening, replay, sectionAt, unrolledTo, type Cleared, type Section, type Seen } from './chapter';
import { FONT, INK, PAPER, RED, el, show, type Overlay } from './dom';
import { getLang, t } from '../i18n';
import type { BagStore } from '../platform/store';

// The section select (design/CHAPTER1.md, 选节界面): the chapter's painting as a handscroll laid
// across the window, dragged sideways. The sections cleared are in colour, each with its grade's
// seal by its title slip; the open one is still ink; the roller on the right holds the rest, with
// a strip of the next section showing before it, shut. Clearing a section is paid back here the
// next time the scroll opens: its colour blooms in, then the roller rolls on to the next. A tap on
// a section opens its slip (name, rooms, best clear, hero, start). Everything is laid out in the
// window's own pixels from the height of the painting (the scroll fills the width, not the logical
// 1920x1080 screen), over every other part of the overlay.

/** The desk the scroll lies on, and the silk of its mounting. */
const DESK = '#2b2723';
const SILK = '#9fb4ab';
/** The desk left at either end of the scroll, a fraction of the painting's height. */
const MARGIN = 0.04;
const ROD = 'linear-gradient(90deg,#3b2a1e,#7a5a3e 35%,#a07850 50%,#6a4a30 70%,#2e2016)';

/** A red seal with `text` cut white into it (白文), `size` px square. */
export function seal(parent: HTMLElement, text: string, size: number, style = ''): HTMLDivElement {
  const zh = /[一-鿿]/.test(text);
  const s = el(
    'div',
    `position:absolute;width:${size}px;height:${size}px;background:${RED};color:${PAPER};border-radius:${size * 0.08}px;` +
      `box-shadow:inset 0 0 0 ${size * 0.05}px rgba(243,238,226,.35),0 0 ${size * 0.04}px rgba(120,20,10,.6);` +
      `display:flex;align-items:center;justify-content:center;text-align:center;line-height:1;font-family:${FONT};font-weight:bold;` +
      (zh ? `writing-mode:vertical-rl;letter-spacing:${size * 0.02}px;font-size:${size * 0.4}px;` : `font-size:${size * 0.22}px;`) +
      style,
    parent,
    text,
  );
  return s;
}

interface Slip {
  section: Section;
  root: HTMLDivElement;
  seal: HTMLDivElement | null;
}

export class ScrollSelect {
  private readonly root: HTMLDivElement;
  private readonly band: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly paper: HTMLDivElement;
  private readonly ink: HTMLImageElement;
  private readonly colour: HTMLImageElement;
  private readonly roll: HTMLDivElement;
  /** A shade over the peek of the next section, still shut. */
  private readonly shut: HTMLDivElement;
  private readonly rollNote: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private slips: Slip[] = [];
  private readonly pan = new Pan(1, 1);
  /** The painting's height and width in window pixels, the left roller's and the right roll's widths. */
  private h = 1;
  private w = 1;
  private rodW = 1;
  private rollW = 1;
  /** How far the roll is open and the colour reaches now (fractions of the strip), and where each
   * is going. */
  private unrolled = 0;
  private coloured = 0;
  private anim: { from: Seen; to: Seen; t: number } | null = null;
  private progress: Cleared | null = null;
  private frame = 0;
  private lastT = 0;
  private cardFor: Section | null = null;
  /** How many sections' seals are on the scroll (the rest still to be stamped). */
  private stamped = 0;
  open = false;
  /** All sections unrolled whatever the progress (?unroll, for development). */
  unrollAll = false;

  onStart: (s: Section) => void = () => {};
  onClick: () => void = () => {};

  constructor(ui: Overlay, private readonly store: BagStore, base: string) {
    this.root = ui.layer(`background:radial-gradient(ellipse at 50% 40%,#3a342e,${DESK} 70%);pointer-events:auto;touch-action:none;cursor:grab;display:none`);
    this.title = el('div', `position:absolute;left:0;right:0;text-align:center;color:${PAPER};font-family:${FONT};letter-spacing:.3em;white-space:nowrap;opacity:.85`, this.root);
    this.band = el('div', 'position:absolute;left:0;right:0', this.root);
    this.track = el('div', 'position:absolute;left:0;top:0;height:100%;will-change:transform', this.band);
    // the left roller, where the scroll starts (its 天杆), and the paper unrolled from it
    this.head = el('div', `position:absolute;top:-4%;height:108%;border-radius:6px;background:${ROD};box-shadow:4px 0 10px rgba(0,0,0,.45)`, this.track);
    this.paper = el('div', `position:absolute;top:0;height:100%;overflow:hidden;background:${PAPER}`, this.track);
    const silk = `position:absolute;left:0;right:0;height:7%;background:${SILK} url(${base}art/bg/silk.jpg) repeat-x;background-size:auto 100%;z-index:2`;
    el('div', `${silk};top:0;box-shadow:0 2px 4px rgba(0,0,0,.25)`, this.paper);
    el('div', `${silk};bottom:0;transform:scaleY(-1)`, this.paper);
    const img = (src: string) => {
      const i = el('img', 'position:absolute;left:0;top:7%;height:86%;pointer-events:none;-webkit-user-drag:none', this.paper);
      i.src = src;
      i.draggable = false;
      return i;
    };
    this.ink = img(`${base}art/scroll/ch1_ink.jpg`);
    this.colour = img(`${base}art/scroll/ch1.jpg`);
    this.shut = el('div', 'position:absolute;top:7%;height:86%;background:linear-gradient(90deg,rgba(43,39,35,0),rgba(43,39,35,.45) 40%);pointer-events:none', this.paper);
    // the roll on the right, the rest of the chapter wound round it
    this.roll = el('div', 'position:absolute;top:-2%;height:104%;z-index:3', this.track);
    el('div', `position:absolute;inset:0;border-radius:14px;background:linear-gradient(90deg,#c9bfa8,${PAPER} 30%,#fffaf0 45%,#d8ceb6 75%,#8f866f);box-shadow:-6px 0 14px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.15)`, this.roll);
    el('div', `position:absolute;left:22%;width:56%;top:-5%;height:110%;border-radius:6px;background:${ROD};z-index:-1`, this.roll);
    this.rollNote = el('div', `position:absolute;writing-mode:vertical-rl;color:rgba(20,19,23,.55);font-family:${FONT};white-space:nowrap;left:50%;top:50%;transform:translate(-50%,-50%)`, this.roll);
    this.card = el('div', `position:absolute;display:none;background:${PAPER};box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 0 0 3px ${INK};border-radius:10px;color:${INK};font-family:${FONT};cursor:default;z-index:5`, this.root);
    this.card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    this.card.addEventListener('pointerup', (ev) => ev.stopPropagation());

    this.root.addEventListener('pointerdown', (ev) => {
      this.root.setPointerCapture?.(ev.pointerId);
      this.root.style.cursor = 'grabbing';
      this.pan.press(ev.clientX, ev.timeStamp);
    });
    this.root.addEventListener('pointermove', (ev) => {
      this.pan.move(ev.clientX, ev.timeStamp);
      this.place();
    });
    const up = (ev: PointerEvent) => {
      this.root.style.cursor = 'grab';
      if (this.pan.release(ev.timeStamp)) this.tap(ev.clientX, ev.clientY);
    };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', (ev) => this.pan.release(ev.timeStamp));
    this.root.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.pan.nudge(Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY);
        this.place();
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.open && this.layout());
  }

  /** Opens the scroll over the game, with what cleared since it last opened played in. */
  show(progress: Cleared): void {
    this.progress = progress;
    this.open = true;
    show(this.root, true);
    const { from: seen, to: now } = opening(this.store, progress, this.unrollAll);
    this.anim = seen.open !== now.open || seen.cleared !== now.cleared ? { from: seen, to: now, t: 0 } : null;
    this.unrolled = unrolledTo(seen.open);
    this.coloured = colouredTo(seen.cleared);
    this.stamped = seen.cleared;
    this.closeCard();
    this.layout();
    // the open section (or the roller, when there is something to unroll) in the middle
    const open = CHAPTER1[Math.min(now.open, CHAPTER1.length) - 1];
    this.pan.centre(MARGIN * this.h + this.rodW + (this.anim ? this.unrolled : open.at) * this.w);
    this.place();
    this.lastT = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  hide(): void {
    this.open = false;
    show(this.root, false);
    cancelAnimationFrame(this.frame);
  }

  /** Sizes everything from the window: the painting as tall as fits, under the title. */
  private layout(): void {
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    const bandH = Math.min(ih * 0.78, iw * 0.62);
    const top = (ih - bandH) / 2 + ih * 0.03;
    this.band.style.top = `${top}px`;
    this.band.style.height = `${bandH}px`;
    this.title.style.top = `${Math.max(4, top - bandH * 0.16)}px`;
    this.title.style.fontSize = `${Math.max(14, Math.min(bandH * 0.075, iw / 28))}px`;
    this.title.textContent = t('scroll.title');
    this.h = bandH * 0.86;
    this.w = (this.h * STRIP.w) / STRIP.h;
    this.rodW = bandH * 0.05;
    this.rollW = bandH * 0.14;
    for (const i of [this.ink, this.colour]) i.style.width = `${this.w}px`;
    this.head.style.width = `${this.rodW}px`;
    this.paper.style.left = `${this.rodW}px`;
    this.rollNote.style.fontSize = `${Math.max(11, bandH * 0.035)}px`;
    this.rollNote.textContent = t('section.rolled');
    this.card.style.fontSize = `${Math.max(12, bandH * 0.045)}px`;
    this.pan.view = iw;
    this.makeSlips();
  }

  /** Puts the paper's end and the roll where `unrolled` says, and the colour where `coloured` does. */
  private unroll(): void {
    const paperW = this.unrolled * this.w;
    this.paper.style.width = `${paperW}px`;
    this.roll.style.left = `${this.rodW + paperW - this.rollW * 0.35}px`;
    this.roll.style.width = `${this.rollW}px`;
    // the colour: up to the last section cleared, its edge a soft bloom of wash into the ink
    const c = this.coloured * this.w;
    const soft = this.h * 0.25;
    const mask = c <= 0 ? 'linear-gradient(90deg,transparent,transparent)' : `linear-gradient(90deg,#000 ${Math.max(0, c - soft)}px,transparent ${c}px)`;
    this.colour.style.setProperty('mask-image', mask);
    this.colour.style.setProperty('-webkit-mask-image', mask);
    show(this.shut, this.unrolled < 1);
    this.shut.style.left = `${(this.unrolled - PEEK) * this.w}px`;
    this.shut.style.width = `${PEEK * this.w}px`;
    // a margin of desk at either end
    this.pan.content = MARGIN * this.h * 2 + this.rodW + paperW + this.rollW * 0.65;
    for (const s of this.slips) {
      const shown = s.section.at < this.unrolled;
      show(s.root, shown);
    }
    this.pan.clamp();
  }

  private place(): void {
    this.track.style.transform = `translateX(${this.pan.x + MARGIN * this.h}px)`;
    if (this.cardFor) this.placeCard();
  }

  /** The title slips hung on the painting (题签): a section's number and name written down a
   * strip of paper, and the seal of its best grade beside it once cleared. */
  private makeSlips(): void {
    for (const s of this.slips) s.root.remove();
    this.slips = CHAPTER1.map((section, i) => {
      const fs = this.h * 0.05;
      const root = el(
        'div',
        `position:absolute;top:${this.h * 0.2}px;left:${section.at * this.w}px;padding:${fs * 0.5}px ${fs * 0.3}px;background:rgba(243,238,226,.92);` +
          `box-shadow:0 0 0 1px rgba(20,19,23,.4),2px 3px 6px rgba(0,0,0,.25);color:${INK};font-family:${FONT};writing-mode:vertical-rl;` +
          `font-size:${fs}px;line-height:1.1;white-space:nowrap;z-index:3;pointer-events:none`,
        this.paper,
      );
      el('span', `font-size:${fs * 0.62}px;opacity:.7;margin-left:${fs * 0.15}px`, root, section.id);
      el('span', '', root, t(section.name));
      const best = this.progress?.get(section.dungeon);
      let s: HTMLDivElement | null = null;
      if (best) {
        s = seal(root, t(SEAL[best.grade]), fs * 1.5, `left:${-fs * 1.75}px;bottom:${-fs * 0.6}px;writing-mode:vertical-rl;transform:rotate(-4deg)`);
        // a seal cleared since the scroll last showed is stamped in the animation
        if (i >= this.stamped) s.style.opacity = '0';
      }
      return { section, root, seal: s };
    });
    this.unroll();
  }

  private tick(t: number): void {
    const dt = Math.min(50, t - this.lastT);
    this.lastT = t;
    if (this.pan.step(dt)) this.place();
    const a = this.anim;
    if (a) {
      a.t += dt;
      const r = replay(a.from, a.to, a.t);
      this.coloured = r.coloured;
      this.unrolled = r.unrolled;
      if (r.stamp && this.stamped < a.to.cleared) {
        for (let i = this.stamped; i < a.to.cleared; i++) {
          const s = this.slips[i]?.seal;
          if (s) stamp(s);
        }
        this.stamped = a.to.cleared;
      }
      this.unroll();
      if (r.rolling) this.pan.centre(MARGIN * this.h + this.rodW + this.unrolled * this.w - this.pan.view * 0.25);
      this.place();
      if (r.done) this.anim = null;
    }
    if (this.open) this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  /** A tap on the painting: the section under it opens its slip, anywhere else closes one. */
  private tap(cx: number, _cy: number): void {
    const r = this.paper.getBoundingClientRect();
    const x = (cx - r.left) / this.w;
    const sec = x >= 0 && x <= this.unrolled ? sectionAt(x) : null;
    if (!sec || sec === this.cardFor) return this.closeCard();
    this.onClick();
    this.openCard(sec);
  }

  private closeCard(): void {
    this.cardFor = null;
    show(this.card, false);
  }

  /** The section's slip: its number and name, rooms, best clear, the hero to go in with, and the
   * start; a shut one only says what opens it. */
  private openCard(sec: Section): void {
    this.cardFor = sec;
    const c = this.card;
    c.replaceChildren();
    const i = CHAPTER1.indexOf(sec);
    const open = this.unrollAll || !this.progress || i < openCount(this.progress);
    const em = parseFloat(c.style.fontSize);
    const [ch, num] = sec.id.split('-');
    c.style.padding = `${em * 0.9}px ${em * 1.1}px`;
    c.style.width = `${em * 14}px`;
    el('div', `font-size:${em * 0.7}px;opacity:.65`, c, t('section.num', { c: ch, s: num }));
    el('div', `font-size:${em * 1.6}px;margin:${em * 0.15}px 0 ${em * 0.3}px`, c, t(sec.name));
    el('div', `font-size:${em * 0.8}px;opacity:.8`, c, t('section.rooms', { n: sec.rooms }));
    if (!open) {
      el('div', `margin-top:${em * 0.8}px;color:${RED}`, c, t('section.shut', { id: CHAPTER1[i - 1].id }));
    } else {
      const best = this.progress?.get(sec.dungeon);
      el(
        'div',
        `font-size:${em * 0.8}px;margin:${em * 0.4}px 0 ${em * 0.8}px`,
        c,
        best ? t('section.best', { grade: gradeName(best.grade), time: clock(best.ticks), n: best.clears }) : t('section.new'),
      );
      // the hero: the swordsman alone in chapter one's first sections (the lion joins at 1-5)
      const row = el('div', `display:flex;align-items:center;gap:${em * 0.4}px;margin-bottom:${em * 0.9}px;font-size:${em * 0.8}px`, c);
      el('div', 'opacity:.7', row, t('section.hero'));
      el('div', `padding:${em * 0.2}px ${em * 0.6}px;border-radius:${em * 0.3}px;background:${INK};color:${PAPER}`, row, t('section.sword'));
      for (let k = 0; k < 2; k++) el('div', `padding:${em * 0.2}px ${em * 0.6}px;border-radius:${em * 0.3}px;box-shadow:inset 0 0 0 2px rgba(20,19,23,.3);opacity:.45`, row, t('section.soon'));
      const go = el(
        'div',
        `text-align:center;padding:${em * 0.4}px 0;border-radius:${em * 0.35}px;background:${RED};color:${PAPER};font-size:${em * 1.1}px;cursor:pointer;box-shadow:inset 0 0 0 3px ${INK}`,
        c,
        t('section.start'),
      );
      go.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onClick();
        this.onStart(sec);
      });
    }
    show(c, true);
    this.placeCard();
  }

  /** The slip over the middle of its section, kept inside the window. */
  private placeCard(): void {
    const sec = this.cardFor;
    if (!sec) return;
    const r = this.paper.getBoundingClientRect();
    const b = this.band.getBoundingClientRect();
    const cw = this.card.offsetWidth;
    const chh = this.card.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - cw - 8, r.left + ((sec.from + Math.min(sec.to, this.unrolled)) / 2) * this.w - cw * 0.5));
    const y = Math.max(8, Math.min(window.innerHeight - chh - 8, b.top + b.height * 0.5 - chh * 0.4));
    this.card.style.left = `${x}px`;
    this.card.style.top = `${y}px`;
  }
}

/** The grade as the seal names it, and the letter in English beside the word. */
function gradeName(g: Grade): string {
  return getLang() === 'zh' ? t(SEAL[g]) : `${g} (${t(SEAL[g])})`;
}

/** A seal pressed down: it comes from above, larger, and lands with a little bounce. */
export function stamp(s: HTMLElement): void {
  const rest = s.style.transform;
  s.style.transition = 'none';
  s.style.opacity = '0';
  s.style.transform = `${rest} scale(2.4)`;
  void s.offsetWidth;
  s.style.transition = 'transform .28s cubic-bezier(.5,1.8,.6,1),opacity .12s';
  s.style.opacity = '1';
  s.style.transform = rest;
}
