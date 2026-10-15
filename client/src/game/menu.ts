import { Container, Graphics, Rectangle, Text, type TextStyleOptions } from 'pixi.js';
import { VIEW_H, VIEW_W } from './layout';
import { t } from '../i18n';

// The menus over the game: the pause button in the top-right corner (and, single player, the
// character and skill buttons beside it, which open charPanel.ts and skillPanel.ts), the pause panel it opens
// (go on, start again, sound, language), and the buttons under a finished run's result. They sit
// above the on-screen controls, so a tap on them never reaches the stick or a button underneath;
// while the pause panel is open a veil over the whole view takes every tap. The credits are not
// in the game: they ship beside it as credits.html (client/public).

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold', align: 'center' });

const PAPER = 0xf3eee2;
const INK = 0x141317;
const RED = 0xc8281e;

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

/** A tappable rounded button. */
function button(label: string, w: number, h: number, size: number, act: () => void, main = false): { root: Container; text: Text } {
  const root = new Container();
  const g = new Graphics().roundRect(-w / 2, -h / 2, w, h, 14).fill({ color: main ? RED : INK, alpha: 0.88 }).stroke({ width: 3, color: INK });
  const text = new Text({ text: label, style: style(size, PAPER) });
  text.anchor.set(0.5);
  root.addChild(g, text);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
  root.on('pointertap', act);
  return { root, text };
}

export class Menu {
  readonly layer = new Container();
  private readonly pauseButton = new Container();
  /** The character button, left of the pause button (single player only). */
  private readonly charButton = new Container();
  /** The skill button, left of the character button, with a red dot while points are free. */
  private readonly skillButton = new Container();
  private readonly skillDot = new Graphics();
  private charShown = false;
  private readonly veil = new Graphics();
  private readonly panel = new Container();
  private readonly result = new Container();
  private readonly tiers = new Container();
  private tiersKey = '';
  private readonly labels: { title: Text; resume: Text; restart: Text; sound: Text; lang: Text };
  private resultKey = '';

  onResume: () => void = () => {};
  onPause: () => void = () => {};
  onRestart: () => void = () => {};
  onSound: () => void = () => {};
  onLang: () => void = () => {};
  onChar: () => void = () => {};
  onSkills: () => void = () => {};

  constructor() {
    // the pause button: two ink bars on a paper square
    const s = PAUSE_SIZE;
    const pg = new Graphics()
      .roundRect(0, 0, s, s, 12)
      .fill({ color: PAPER, alpha: 0.75 })
      .stroke({ width: 3, color: INK })
      .rect(s * 0.3, s * 0.25, s * 0.13, s * 0.5)
      .rect(s * 0.57, s * 0.25, s * 0.13, s * 0.5)
      .fill(INK);
    this.pauseButton.addChild(pg);
    this.pauseButton.position.set(PAUSE_RIGHT - s, PAUSE_TOP);
    this.pauseButton.eventMode = 'static';
    this.pauseButton.cursor = 'pointer';
    // a little more than it shows, for a thumb
    this.pauseButton.hitArea = new Rectangle(-16, -16, s + 32, s + 32);
    this.pauseButton.on('pointertap', () => this.onPause());

    // the character button: a robe's outline (a collar and two sleeves) on a paper square
    const cg = new Graphics()
      .roundRect(0, 0, s, s, 12)
      .fill({ color: PAPER, alpha: 0.75 })
      .stroke({ width: 3, color: INK })
      .poly([s * 0.5, s * 0.22, s * 0.78, s * 0.3, s * 0.86, s * 0.52, s * 0.72, s * 0.52, s * 0.7, s * 0.8, s * 0.3, s * 0.8, s * 0.28, s * 0.52, s * 0.14, s * 0.52, s * 0.22, s * 0.3])
      .fill(INK)
      .moveTo(s * 0.4, s * 0.25)
      .lineTo(s * 0.5, s * 0.42)
      .lineTo(s * 0.6, s * 0.25)
      .stroke({ width: 4, color: PAPER });
    this.charButton.addChild(cg);
    this.charButton.position.set(PAUSE_RIGHT - 2 * s - 24, PAUSE_TOP);
    this.charButton.eventMode = 'static';
    this.charButton.cursor = 'pointer';
    this.charButton.hitArea = new Rectangle(-12, -16, s + 24, s + 32);
    this.charButton.on('pointertap', () => this.onChar());

    // the skill button: a brush stroke slanting up, its tip a blade's
    const kg = new Graphics()
      .roundRect(0, 0, s, s, 12)
      .fill({ color: PAPER, alpha: 0.75 })
      .stroke({ width: 3, color: INK })
      .poly([s * 0.18, s * 0.8, s * 0.26, s * 0.66, s * 0.74, s * 0.18, s * 0.84, s * 0.16, s * 0.8, s * 0.28, s * 0.34, s * 0.76])
      .fill(INK)
      .moveTo(s * 0.2, s * 0.44)
      .lineTo(s * 0.48, s * 0.72)
      .stroke({ width: 5, color: INK });
    this.skillDot.circle(s - 6, 6, 12).fill(RED).stroke({ width: 3, color: PAPER });
    this.skillDot.visible = false;
    this.skillButton.addChild(kg, this.skillDot);
    this.skillButton.position.set(PAUSE_RIGHT - 3 * s - 48, PAUSE_TOP);
    this.skillButton.eventMode = 'static';
    this.skillButton.cursor = 'pointer';
    this.skillButton.hitArea = new Rectangle(-12, -16, s + 24, s + 32);
    this.skillButton.on('pointertap', () => this.onSkills());

    this.veil.rect(0, 0, VIEW_W, VIEW_H).fill({ color: INK, alpha: 0.55 });
    this.veil.eventMode = 'static';

    // the pause panel
    const pw = 560;
    const ph = 600;
    const card = new Graphics().roundRect(-pw / 2, -ph / 2, pw, ph, 20).fill({ color: PAPER, alpha: 0.96 }).stroke({ width: 4, color: INK });
    const title = new Text({ text: '', style: style(64) });
    title.anchor.set(0.5);
    title.y = -ph / 2 + 70;
    const items = [
      button('', 380, 84, 40, () => this.onResume(), true),
      button('', 380, 84, 40, () => this.onRestart()),
      button('', 380, 84, 40, () => this.onSound()),
      button('', 380, 84, 40, () => this.onLang()),
    ];
    items.forEach((b, i) => (b.root.y = -ph / 2 + 180 + i * 104));
    this.labels = { title, resume: items[0].text, restart: items[1].text, sound: items[2].text, lang: items[3].text };
    this.panel.addChild(card, title, ...items.map((b) => b.root));
    this.panel.position.set(VIEW_W / 2, VIEW_H / 2);

    this.result.position.set(VIEW_W / 2, VIEW_H * 0.75);
    this.tiers.position.set(VIEW_W / 2, VIEW_H * 0.75 + 118);
    this.layer.addChild(this.result, this.tiers, this.pauseButton, this.charButton, this.skillButton, this.veil, this.panel);
    this.showPaused(false);
  }

  /** Writes the panel's text again (the sound switched, or the language). */
  relabel(muted: boolean): void {
    const l = this.labels;
    l.title.text = t('menu.paused');
    l.resume.text = t('menu.resume');
    l.restart.text = t('menu.restart');
    l.sound.text = t(muted ? 'menu.soundOff' : 'menu.soundOn');
    l.lang.text = t('menu.otherLang');
  }

  showPaused(paused: boolean): void {
    this.veil.visible = this.panel.visible = paused;
    this.pauseButton.visible = !paused;
    this.charButton.visible = this.skillButton.visible = !paused && this.charShown;
  }

  /** Shows the character button (single player) or hides it. */
  showChar(shown: boolean): void {
    this.charShown = shown;
    this.charButton.visible = this.skillButton.visible = shown && this.pauseButton.visible;
  }

  /** Marks the skill button while skill points wait to be spent. */
  markSkills(on: boolean): void {
    this.skillDot.visible = on;
  }

  /** The buttons under a finished run's result, or none (null) while it goes on. */
  showResult(choices: readonly Choice[] | null): void {
    const key = choices?.map((c) => c.label).join('|') ?? '';
    if (key === this.resultKey) return;
    this.resultKey = key;
    for (const c of this.result.removeChildren()) c.destroy({ children: true });
    if (!choices) return;
    const w = 400;
    const gap = 40;
    choices.forEach((c, i) => {
      const b = button(c.label, w, 92, 42, c.act, c.main);
      b.root.x = (i - (choices.length - 1) / 2) * (w + gap);
      this.result.addChild(b.root);
    });
  }

  /** The difficulty row under the result's buttons and a line under it (what the tier picked
   * does, or why the one tapped is shut), or none. */
  showTiers(row: readonly TierChoice[] | null, title: string, note: string): void {
    const key = row ? `${title}|${row.map((c) => c.label + c.state).join('|')}|${note}` : '';
    if (key === this.tiersKey) return;
    this.tiersKey = key;
    for (const c of this.tiers.removeChildren()) c.destroy({ children: true });
    if (!row) return;
    const w = 200;
    const gap = 20;
    const head = new Text({ text: title, style: style(30) });
    head.anchor.set(1, 0.5);
    head.x = -(row.length / 2) * (w + gap) - 10;
    this.tiers.addChild(head);
    row.forEach((c, i) => {
      const b = button(c.label, w, 64, 30, c.act, c.state === 'on');
      b.root.x = (i - (row.length - 1) / 2) * (w + gap);
      if (c.state === 'shut') b.root.alpha = 0.4;
      this.tiers.addChild(b.root);
    });
    const line = new Text({ text: note, style: style(26) });
    line.anchor.set(0.5, 0);
    line.y = 44;
    this.tiers.addChild(line);
  }
}
