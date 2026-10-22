import { INK, PAPER, RED, VIEW_H, VIEW_W, button, el, label, show, type Overlay } from './dom';
import { t } from '../i18n';

// The menus over the game: the pause button in the top-right corner (and, single player, the
// character and skill buttons beside it, which open charPanel.ts and skillPanel.ts), the pause panel it opens
// (go on, start again, sound, language), and the buttons under a finished run's result. They sit
// above the on-screen controls, so a tap on them never reaches the stick or a button underneath;
// while the pause panel is open a veil over the whole view takes every tap. The credits are not
// in the game: they ship beside it as credits.html (client/public).

/** The pause button's square, its right edge and top on the view. */
export const PAUSE_SIZE = 76;
const PAUSE_RIGHT = VIEW_W - 40;
const PAUSE_TOP = 36;

/** A button for the result row. */
export interface Choice {
  label: string;
  /** Drawn in red: the one to press. */
  main?: boolean;
  act: () => void;
}

/** A button of the difficulty row under the result: the tier played, one open, or one shut. */
export interface TierChoice {
  label: string;
  state: 'on' | 'open' | 'shut';
  act: () => void;
}

const S = PAUSE_SIZE;
/** The corner buttons' pictures, on a 76 square. */
const ICONS = {
  // two ink bars
  pause: `<rect x="${S * 0.3}" y="${S * 0.25}" width="${S * 0.13}" height="${S * 0.5}"/><rect x="${S * 0.57}" y="${S * 0.25}" width="${S * 0.13}" height="${S * 0.5}"/>`,
  // a robe's outline: a collar and two sleeves
  char:
    `<polygon points="${[0.5, 0.22, 0.78, 0.3, 0.86, 0.52, 0.72, 0.52, 0.7, 0.8, 0.3, 0.8, 0.28, 0.52, 0.14, 0.52, 0.22, 0.3].map((v) => v * S).join(' ')}"/>` +
    `<polyline points="${[0.4, 0.25, 0.5, 0.42, 0.6, 0.25].map((v) => v * S).join(' ')}" fill="none" stroke="${PAPER}" stroke-width="4"/>`,
  // a brush stroke slanting up, its tip a blade's
  skills:
    `<polygon points="${[0.18, 0.8, 0.26, 0.66, 0.74, 0.18, 0.84, 0.16, 0.8, 0.28, 0.34, 0.76].map((v) => v * S).join(' ')}"/>` +
    `<line x1="${S * 0.2}" y1="${S * 0.44}" x2="${S * 0.48}" y2="${S * 0.72}" stroke="${INK}" stroke-width="5"/>`,
};

/** A paper square with a picture in the top-right corner, `slot` squares left of the edge. */
function corner(parent: HTMLElement, icon: string, slot: number, act: () => void): HTMLDivElement {
  const x = PAUSE_RIGHT - (slot + 1) * S - slot * 24;
  // a little more than it shows, for a thumb
  const hit = el('div', `position:absolute;left:${x - 12}px;top:${PAUSE_TOP - 16}px;width:${S + 24}px;height:${S + 32}px;pointer-events:auto;cursor:pointer`, parent);
  const sq = el(
    'div',
    `position:absolute;left:12px;top:16px;width:${S}px;height:${S}px;border-radius:12px;background:rgba(243,238,226,.75);box-shadow:inset 0 0 0 3px ${INK}`,
    hit,
  );
  sq.innerHTML = `<svg width="${S}" height="${S}" fill="${INK}" style="position:absolute;inset:0">${icon}</svg>`;
  hit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    act();
  });
  return hit;
}

export class Menu {
  private readonly pauseButton: HTMLDivElement;
  /** The character button, left of the pause button (single player only). */
  private readonly charButton: HTMLDivElement;
  /** The skill button, left of the character button, with a red dot while points are free. */
  private readonly skillButton: HTMLDivElement;
  private readonly skillDot: HTMLDivElement;
  private charShown = false;
  private paused = false;
  private readonly veil: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly result: HTMLDivElement;
  private readonly tiers: HTMLDivElement;
  private tiersKey = '';
  private readonly labels: { title: HTMLDivElement; resume: HTMLDivElement; restart: HTMLDivElement; sound: HTMLDivElement; lang: HTMLDivElement };
  private resultKey = '';

  onResume: () => void = () => {};
  onPause: () => void = () => {};
  onRestart: () => void = () => {};
  onSound: () => void = () => {};
  onLang: () => void = () => {};
  onChar: () => void = () => {};
  onSkills: () => void = () => {};

  constructor(ui: Overlay) {
    // the result's buttons, under the HUD's result text
    const mid = ui.frame('cm');
    this.result = el('div', `position:absolute;left:0;top:${VIEW_H * 0.75}px;width:${VIEW_W}px`, mid);
    this.tiers = el('div', `position:absolute;left:0;top:${VIEW_H * 0.75 + 118}px;width:${VIEW_W}px`, mid);

    const top = ui.frame('rt');
    this.pauseButton = corner(top, ICONS.pause, 0, () => this.onPause());
    this.charButton = corner(top, ICONS.char, 1, () => this.onChar());
    this.skillButton = corner(top, ICONS.skills, 2, () => this.onSkills());
    this.skillDot = el('div', `position:absolute;left:${12 + S - 18}px;top:${16 - 12}px;width:24px;height:24px;border-radius:50%;background:${RED};box-shadow:0 0 0 3px ${PAPER}`, this.skillButton);

    this.veil = ui.layer(`background:rgba(20,19,23,.55);pointer-events:auto`);
    this.veil.addEventListener('click', (ev) => ev.stopPropagation());

    // the pause panel
    const pw = 560;
    const ph = 600;
    this.panel = el('div', `position:absolute;left:${(VIEW_W - pw) / 2}px;top:${(VIEW_H - ph) / 2}px;width:${pw}px;height:${ph}px;border-radius:20px;background:rgba(243,238,226,.96);box-shadow:inset 0 0 0 4px ${INK};pointer-events:auto`, ui.frame('cm'));
    const title = label(this.panel, '', pw / 2, 70, 64, INK, 0.5, 0.5);
    const items = [() => this.onResume(), () => this.onRestart(), () => this.onSound(), () => this.onLang()].map((act, i) => button(this.panel, '', pw / 2, 180 + i * 104, 380, 84, 40, i === 0 ? RED : INK, act, 14));
    this.labels = { title, resume: items[0], restart: items[1], sound: items[2], lang: items[3] };
    this.showPaused(false);
  }

  /** Writes the panel's text again (the sound switched, or the language). */
  relabel(muted: boolean): void {
    const l = this.labels;
    l.title.textContent = t('menu.paused');
    l.resume.textContent = t('menu.resume');
    l.restart.textContent = t('menu.restart');
    l.sound.textContent = t(muted ? 'menu.soundOff' : 'menu.soundOn');
    l.lang.textContent = t('menu.otherLang');
  }

  showPaused(paused: boolean): void {
    this.paused = paused;
    show(this.veil, paused);
    show(this.panel, paused);
    show(this.pauseButton, !paused);
    show(this.charButton, !paused && this.charShown);
    show(this.skillButton, !paused && this.charShown);
  }

  /** Shows the character button (single player) or hides it. */
  showChar(shown: boolean): void {
    this.charShown = shown;
    show(this.charButton, shown && !this.paused);
    show(this.skillButton, shown && !this.paused);
  }

  /** Marks the skill button while skill points wait to be spent. */
  markSkills(on: boolean): void {
    show(this.skillDot, on);
  }

  /** The buttons under a finished run's result, or none (null) while it goes on. */
  showResult(choices: readonly Choice[] | null): void {
    const key = choices?.map((c) => c.label).join('|') ?? '';
    if (key === this.resultKey) return;
    this.resultKey = key;
    this.result.replaceChildren();
    if (!choices) return;
    const w = 400;
    const gap = 40;
    choices.forEach((c, i) => button(this.result, c.label, VIEW_W / 2 + (i - (choices.length - 1) / 2) * (w + gap), 0, w, 92, 42, c.main ? RED : INK, c.act, 14));
  }

  /** The difficulty row under the result's buttons and a line under it (what the tier picked
   * does, or why the one tapped is shut), or none. */
  showTiers(row: readonly TierChoice[] | null, title: string, note: string): void {
    const key = row ? `${title}|${row.map((c) => c.label + c.state).join('|')}|${note}` : '';
    if (key === this.tiersKey) return;
    this.tiersKey = key;
    this.tiers.replaceChildren();
    if (!row) return;
    const w = 200;
    const gap = 20;
    const cx = VIEW_W / 2;
    label(this.tiers, title, cx - (row.length / 2) * (w + gap) - 10, 0, 30, INK, 1, 0.5);
    row.forEach((c, i) => {
      const b = button(this.tiers, c.label, cx + (i - (row.length - 1) / 2) * (w + gap), 0, w, 64, 30, c.state === 'on' ? RED : INK, c.act, 14);
      if (c.state === 'shut') b.style.opacity = '0.4';
    });
    label(this.tiers, note, cx, 44, 26, INK, 0.5, 0);
  }
}
