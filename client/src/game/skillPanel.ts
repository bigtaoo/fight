import { MAX_SKILL_LV, SKILLS, SKILL_DMG_PCT, TICK_RATE, type SkillId } from '@dnf/engine';
import { Container, Graphics, Rectangle, Text, type TextStyleOptions } from 'pixi.js';
import { VIEW_H, VIEW_W } from './layout';
import { keyName, t } from '../i18n';
import type { Character } from '../rpg/character';
import { SKILL_ORDER, SLOT_LEVEL, SP_PER_LEVEL, UNLOCK, freePoints, place, raise, resetSkills, skillCap, skillLv, slotOpen, swap } from '../rpg/skills';

// The skill panel (single player): every skill with its level, what the level does and the point
// to raise it, and the bar's six slots under them. Tap a skill and then a slot (or a slot and then
// a skill) to put it there; two slots swap; the same slot twice empties it. Like the character
// panel it saves at once, the changes applying from the next run, and is rebuilt whole on every
// change.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold' });

const PAPER = 0xf3eee2;
const CELL_BG = 0xe6dfcf;
const INK = 0x141317;
const GREY = 0x6f6a60;
const RED = 0xc8281e;
const GREEN = 0x3a7a3a;

const W = 1640;
const H = 900;
const ROW_W = 760;
const ROW_H = 128;
const ROWS_TOP = 128;
const BAR_TOP = 640;
const BOX_W = 200;
const BOX_H = 120;
const BOX_GAP = 28;
/** The bar's keys, slot by slot. */
const SLOT_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW'];

type Pick = { skill: SkillId } | { slot: number } | null;
type Note = { text: string; fill: number } | null;

/** A tappable rounded button. */
function button(label: string, w: number, h: number, act: () => void, fill = INK, size = 32): Container {
  const root = new Container();
  const g = new Graphics().roundRect(-w / 2, -h / 2, w, h, 12).fill({ color: fill, alpha: 0.9 }).stroke({ width: 3, color: INK });
  const text = new Text({ text: label, style: style(size, PAPER) });
  text.anchor.set(0.5);
  root.addChild(g, text);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
  root.on('pointertap', act);
  return root;
}

export class SkillPanel {
  readonly layer = new Container();
  private readonly body = new Container();
  private pick: Pick = null;
  private sure = false;
  private note: Note = null;
  private ch: Character | null = null;

  /** Called once the panel closes. */
  onClose: () => void = () => {};
  /** A tap's sound. */
  onClick: () => void = () => {};

  constructor() {
    const veil = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: INK, alpha: 0.55 });
    veil.eventMode = 'static';
    veil.on('pointertap', () => this.close());
    this.body.position.set((VIEW_W - W) / 2, (VIEW_H - H) / 2);
    this.body.eventMode = 'static';
    this.body.hitArea = new Rectangle(0, 0, W, H);
    this.layer.addChild(veil, this.body);
    this.layer.visible = false;
    window.addEventListener('keydown', (ev) => {
      if (this.open && ev.code === 'Escape') this.close();
    });
  }

  get open(): boolean {
    return this.layer.visible;
  }

  show(ch: Character): void {
    this.ch = ch;
    this.layer.visible = true;
    this.after(null);
  }

  close(): void {
    if (!this.open) return;
    this.layer.visible = false;
    for (const c of this.body.removeChildren()) c.destroy({ children: true });
    this.onClose();
  }

  private after(note: Note): void {
    this.pick = null;
    this.sure = false;
    this.note = note;
    this.draw();
  }

  /** Draws it again (a change, or the language). */
  draw(): void {
    const ch = this.ch;
    if (!ch || !this.open) return;
    for (const c of this.body.removeChildren()) c.destroy({ children: true });
    const b = this.body;
    b.addChild(new Graphics().roundRect(0, 0, W, H, 20).fill({ color: PAPER, alpha: 0.97 }).stroke({ width: 4, color: INK }));
    const text = (s: string, x: number, y: number, size: number, fill = INK) => {
      const tx = new Text({ text: s, style: style(size, fill) });
      tx.position.set(x, y);
      b.addChild(tx);
      return tx;
    };

    const free = freePoints(ch);
    text(t('skills.title'), 40, 26, 50);
    text(t('skills.points', { n: free }), 300, 44, 34, free > 0 ? RED : GREY);
    b.addChild(
      button(t(this.sure ? 'skills.resetSure' : 'skills.reset'), 220, 64, () => {
        this.onClick();
        if (!this.sure) {
          this.sure = true;
          return this.draw();
        }
        resetSkills(ch);
        this.after({ text: t('skills.wasReset'), fill: GREEN });
      }),
    ).position.set(W - 230, 50);
    b.addChild(button('✕', 64, 64, () => this.close(), 0x6f6a60)).position.set(W - 50, 50);

    // the skills, two columns
    SKILL_ORDER.forEach((id, i) => this.row(id, 40 + (i % 2) * (ROW_W + 40), ROWS_TOP + Math.floor(i / 2) * (ROW_H + 16)));

    // the bar
    text(t('skills.bar'), 40, BAR_TOP - 50, 30);
    for (let i = 0; i < SLOT_LEVEL.length; i++) this.box(i, 40 + i * (BOX_W + BOX_GAP), BAR_TOP);

    const note = this.note ?? { text: t('skills.hint'), fill: GREY };
    const n = text(note.text, 40, BAR_TOP + BOX_H + 22, 26, note.fill);
    n.style.wordWrap = true;
    n.style.wordWrapWidth = W - 80;
    text(t('skills.nextRun'), 40, H - 48, 22, GREY);
    // the words lie over the rows and slots: a tap on them is the row's or the slot's
    for (const c of b.children) if (c instanceof Text) c.eventMode = 'none';
  }

  /** One skill: its name and level, what the level does, its perk, and the point to raise it. */
  private row(id: SkillId, x: number, y: number): void {
    const ch = this.ch!;
    const b = this.body;
    const lv = skillLv(ch, id);
    const cap = skillCap(id, ch.level);
    const picked = this.pick && 'skill' in this.pick && this.pick.skill === id;
    const box = new Graphics()
      .roundRect(x, y, ROW_W, ROW_H, 12)
      .fill({ color: lv ? CELL_BG : 0xcfc8b8 })
      .stroke({ width: picked ? 6 : 2, color: picked ? RED : INK });
    box.eventMode = 'static';
    box.cursor = 'pointer';
    box.hitArea = new Rectangle(x, y, ROW_W, ROW_H);
    box.on('pointertap', () => this.pickSkill(id));
    b.addChild(box);
    const text = (s: string, tx: number, ty: number, size: number, fill = INK) => {
      const o = new Text({ text: s, style: style(size, fill) });
      o.position.set(tx, ty);
      b.addChild(o);
      return o;
    };
    const name = text(t(`skill.${id}`), x + 20, y + 12, 36, lv ? INK : GREY);
    text(lv ? t('skills.lv', { lv, cap }) : t('skills.locked', { n: UNLOCK[id] }), x + 40 + name.width, y + 22, 26, lv ? INK : RED);
    const sk = SKILLS[id];
    const cd = (sk.cooldown / TICK_RATE).toFixed(sk.cooldown % TICK_RATE ? 1 : 0);
    text(t('skills.dmg', { n: 100 + SKILL_DMG_PCT * (Math.max(1, lv) - 1), cd }), x + 20, y + 56, 22, GREY);
    const p = sk.perk;
    const perk = p.cdPct ? t('perk.cd', { lv: p.lv, n: p.cdPct }) : t('perk.armor', { lv: p.lv });
    text(perk, x + 20, y + 92, 22, lv >= p.lv ? GREEN : GREY);
    if (lv && lv < MAX_SKILL_LV) {
      const can = lv < cap && freePoints(ch) > 0;
      b.addChild(
        button('+', 64, 64, () => {
          this.onClick();
          if (raise(ch, id)) return this.after(null);
          this.after({ text: lv >= cap ? t('skills.capped') : t('skills.noPoints', { n: SP_PER_LEVEL }), fill: RED });
        }, can ? RED : GREY, 40),
      ).position.set(x + ROW_W - 48, y + ROW_H / 2);
    }
  }

  /** One slot of the bar: its key and the skill in it, or the level it opens at. */
  private box(i: number, x: number, y: number): void {
    const ch = this.ch!;
    const b = this.body;
    const open = slotOpen(ch, i);
    const id = ch.bar[i];
    const picked = this.pick && 'slot' in this.pick && this.pick.slot === i;
    const g = new Graphics()
      .roundRect(x, y, BOX_W, BOX_H, 12)
      .fill({ color: open ? (id === 'phantom' ? 0x5a1a14 : INK) : 0xcfc8b8, alpha: open ? 0.88 : 1 })
      .stroke({ width: picked ? 7 : 3, color: picked ? RED : INK });
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.hitArea = new Rectangle(x, y, BOX_W, BOX_H);
    g.on('pointertap', () => this.pickSlot(i));
    b.addChild(g);
    const key = new Text({ text: keyName(SLOT_KEYS[i]), style: style(24, open ? 0xb8b2a4 : GREY) });
    key.position.set(x + 12, y + 8);
    const label = new Text({
      text: open ? (id ? t(`skill.${id}`) : '—') : t('skills.slotLv', { n: SLOT_LEVEL[i] }),
      style: style(open ? 36 : 28, open ? PAPER : GREY),
    });
    label.anchor.set(0.5);
    label.position.set(x + BOX_W / 2, y + BOX_H / 2 + 8);
    b.addChild(key, label);
  }

  private pickSkill(id: SkillId): void {
    const ch = this.ch!;
    this.onClick();
    if (skillLv(ch, id) === 0) return this.after({ text: t('skills.locked', { n: UNLOCK[id] }), fill: RED });
    if (this.pick && 'slot' in this.pick) {
      place(ch, this.pick.slot, id);
      return this.after(null);
    }
    this.pick = this.pick && 'skill' in this.pick && this.pick.skill === id ? null : { skill: id };
    this.note = null;
    this.draw();
  }

  private pickSlot(i: number): void {
    const ch = this.ch!;
    this.onClick();
    if (!slotOpen(ch, i)) return this.after({ text: t('skills.slotClosed', { n: SLOT_LEVEL[i] }), fill: RED });
    const p = this.pick;
    if (!p) {
      this.pick = { slot: i };
      this.note = null;
      return this.draw();
    }
    if ('skill' in p) place(ch, i, p.skill);
    else if (p.slot === i) place(ch, i, null);
    else swap(ch, p.slot, i);
    this.after(null);
  }
}
