import type { Grade } from '@dnf/engine';
import { SEAL, STRIP, type Section } from './chapter';
import { FONT, INK, PAPER, VIEW_W, el, show, type Overlay } from './dom';
import { seal, stamp } from './scrollSelect';
import { t } from '../i18n';

// A chapter section cleared (design/CHAPTER1.md, 三节共用): in place of the plain banner, the
// section's stretch of the chapter's painting, first in ink, its colour blooming out from the
// middle (化开), then the seal of the clear's grade pressed beside it. The rating's numbers, the
// reward and the buttons stay where the HUD and the menu put them, under it.

/** The card's top and the painting's height on the logical screen, above the HUD's stats. */
const TOP = 24;
const H = 320;
const BLOOM_MS = 1600;
const STAMP_MS = 1800;

export class SectionEnd {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly ink: HTMLImageElement;
  private readonly colour: HTMLImageElement;
  private readonly name: HTMLDivElement;
  private mark: HTMLDivElement | null = null;
  private frame = 0;
  /** The section shown, while it is. */
  on: Section | null = null;

  constructor(ui: Overlay, base: string) {
    this.root = ui.frame('cm');
    show(this.root, false);
    this.card = el('div', `position:absolute;top:${TOP}px;height:${H}px;overflow:hidden;background:${PAPER};box-shadow:0 0 0 6px ${PAPER},0 0 0 9px ${INK},0 8px 24px rgba(0,0,0,.35)`, this.root);
    const img = (src: string) => {
      const i = el('img', `position:absolute;top:0;height:${H}px;width:${(H * STRIP.w) / STRIP.h}px`, this.card);
      i.src = src;
      return i;
    };
    this.ink = img(`${base}art/scroll/ch1_ink.jpg`);
    this.colour = img(`${base}art/scroll/ch1.jpg`);
    this.name = el('div', `position:absolute;top:${TOP + H + 22}px;left:0;width:${VIEW_W}px;text-align:center;white-space:pre;font-family:${FONT};color:${INK};font-size:40px;text-shadow:0 0 6px ${PAPER},0 0 12px ${PAPER}`, this.root);
  }

  /** The section's painting coloured in, and the `grade`'s seal stamped on it. */
  show(sec: Section, grade: Grade): void {
    this.on = sec;
    show(this.root, true);
    const full = (H * STRIP.w) / STRIP.h;
    const w = (sec.to - sec.from) * full;
    const left = (VIEW_W - w) / 2;
    this.card.style.left = `${left}px`;
    this.card.style.width = `${w}px`;
    for (const i of [this.ink, this.colour]) i.style.left = `${-sec.from * full}px`;
    const [c, s] = sec.id.split('-');
    this.name.textContent = `${t('section.num', { c, s })}    ${t(sec.name)}    ${t('hud.cleared')}`;
    this.mark?.remove();
    // the seal at the painting's lower right, half over its edge, as a collector's would be
    this.mark = seal(this.root, t(SEAL[grade]), 120, `left:${left + w - 80}px;top:${TOP + H - 96}px;transform:rotate(-6deg);opacity:0`);
    const mark = this.mark;
    const t0 = performance.now();
    const diag = Math.hypot(w, H) / 2;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / BLOOM_MS);
      // wash spreading from the middle: fast at first, slowing as it soaks out
      const r = diag * 1.15 * (1 - Math.pow(1 - k, 2.2));
      const mask = `radial-gradient(circle at 50% 55%,#000 ${Math.max(0, r - 90)}px,transparent ${r}px)`;
      this.colour.style.setProperty('mask-image', mask);
      this.colour.style.setProperty('-webkit-mask-image', mask);
      if (now - t0 >= STAMP_MS && mark.style.opacity === '0') stamp(mark);
      if (this.on === sec && mark.style.opacity === '0') this.frame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(step);
  }

  hide(): void {
    this.on = null;
    cancelAnimationFrame(this.frame);
    show(this.root, false);
  }
}
