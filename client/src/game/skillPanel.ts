import { MAX_SKILL_LV, SKILLS, SKILL_DMG_PCT, TICK_RATE, type SkillId } from '@dnf/engine';
import { GREEN, GREY, INK, PAPER, RED, button, el, label, show, type Overlay } from './dom';
import { card } from './charPanel';
import { keyName, t } from '../i18n';
import type { Character } from '../rpg/character';
import { SKILL_ORDER, SLOT_LEVEL, SP_PER_LEVEL, UNLOCK, freePoints, place, raise, resetSkills, skillCap, skillLv, slotOpen, swap } from '../rpg/skills';

// The skill panel (single player): every skill with its level, what the level does and the point
// to raise it, and the bar's six slots under them. Tap a skill and then a slot (or a slot and then
// a skill) to put it there; two slots swap; the same slot twice empties it. Like the character
// panel it saves at once, the changes applying from the next run, and is rebuilt whole on every
// change.

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
type Note = { text: string; fill: string } | null;

export class SkillPanel {
  private readonly veil: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private pick: Pick = null;
  private sure = false;
  private note: Note = null;
  private ch: Character | null = null;
  private shown = false;

  /** Called once the panel closes. */
  onClose: () => void = () => {};
  /** A tap's sound. */
  onClick: () => void = () => {};

  constructor(ui: Overlay) {
    ({ veil: this.veil, frame: this.frame, body: this.body } = card(ui, W, H, () => this.close()));
    window.addEventListener('keydown', (ev) => {
      if (this.open && ev.code === 'Escape') this.close();
    });
  }

  get open(): boolean {
    return this.shown;
  }

  show(ch: Character): void {
    this.ch = ch;
    this.shown = true;
    show(this.veil, true);
    show(this.frame, true);
    this.after(null);
  }

  close(): void {
    if (!this.open) return;
    this.shown = false;
    show(this.veil, false);
    show(this.frame, false);
    this.body.replaceChildren();
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
    const b = this.body;
    b.replaceChildren();

    const free = freePoints(ch);
    label(b, t('skills.title'), 40, 26, 50);
    label(b, t('skills.points', { n: free }), 300, 44, 34, free > 0 ? RED : GREY);
    button(b, t(this.sure ? 'skills.resetSure' : 'skills.reset'), W - 230, 50, 220, 64, 32, INK, () => {
      this.onClick();
      if (!this.sure) {
        this.sure = true;
        return this.draw();
      }
      resetSkills(ch);
      this.after({ text: t('skills.wasReset'), fill: GREEN });
    });
    button(b, '✕', W - 50, 50, 64, 64, 32, GREY, () => this.close());

    // the skills, two columns
    SKILL_ORDER.forEach((id, i) => this.row(id, 40 + (i % 2) * (ROW_W + 40), ROWS_TOP + Math.floor(i / 2) * (ROW_H + 16)));

    // the bar
    label(b, t('skills.bar'), 40, BAR_TOP - 50, 30);
    for (let i = 0; i < SLOT_LEVEL.length; i++) this.box(i, 40 + i * (BOX_W + BOX_GAP), BAR_TOP);

    const note = this.note ?? { text: t('skills.hint'), fill: GREY };
    label(b, note.text, 40, BAR_TOP + BOX_H + 22, 26, note.fill, 0, 0, `white-space:normal;width:${W - 80}px`);
    label(b, t('skills.nextRun'), 40, H - 48, 22, GREY);
  }

  /** One skill: its name and level, what the level does, its perk, and the point to raise it. */
  private row(id: SkillId, x: number, y: number): void {
    const ch = this.ch!;
    const lv = skillLv(ch, id);
    const cap = skillCap(id, ch.level);
    const picked = this.pick && 'skill' in this.pick && this.pick.skill === id;
    const box = el(
      'div',
      `position:absolute;left:${x}px;top:${y}px;width:${ROW_W}px;height:${ROW_H}px;border-radius:12px;background:${lv ? '#e6dfcf' : '#cfc8b8'};` +
        `box-shadow:inset 0 0 0 ${picked ? 6 : 2}px ${picked ? RED : INK};pointer-events:auto;cursor:pointer`,
      this.body,
    );
    box.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.pickSkill(id);
    });
    const head = el('div', 'position:absolute;left:20px;top:12px;display:flex;align-items:baseline;gap:20px;white-space:pre', box);
    el('div', `font-size:36px;color:${lv ? INK : GREY}`, head, t(`skill.${id}`));
    el('div', `font-size:26px;color:${lv ? INK : RED}`, head, lv ? t('skills.lv', { lv, cap }) : t('skills.locked', { n: UNLOCK[id] }));
    const sk = SKILLS[id];
    const cd = (sk.cooldown / TICK_RATE).toFixed(sk.cooldown % TICK_RATE ? 1 : 0);
    label(box, t('skills.dmg', { n: 100 + SKILL_DMG_PCT * (Math.max(1, lv) - 1), cd }), 20, 56, 22, GREY);
    const p = sk.perk;
    const perk = p.cdPct ? t('perk.cd', { lv: p.lv, n: p.cdPct }) : t('perk.armor', { lv: p.lv });
    label(box, perk, 20, 92, 22, lv >= p.lv ? GREEN : GREY);
    if (lv && lv < MAX_SKILL_LV) {
      const can = lv < cap && freePoints(ch) > 0;
      button(box, '+', ROW_W - 48, ROW_H / 2, 64, 64, 40, can ? RED : GREY, () => {
        this.onClick();
        if (raise(ch, id)) return this.after(null);
        this.after({ text: lv >= cap ? t('skills.capped') : t('skills.noPoints', { n: SP_PER_LEVEL }), fill: RED });
      });
    }
  }

  /** One slot of the bar: its key and the skill in it, or the level it opens at. */
  private box(i: number, x: number, y: number): void {
    const ch = this.ch!;
    const open = slotOpen(ch, i);
    const id = ch.bar[i];
    const picked = this.pick && 'slot' in this.pick && this.pick.slot === i;
    const fill = open ? (id === 'phantom' ? 'rgba(90,26,20,.88)' : 'rgba(20,19,23,.88)') : '#cfc8b8';
    const g = el(
      'div',
      `position:absolute;left:${x}px;top:${y}px;width:${BOX_W}px;height:${BOX_H}px;border-radius:12px;background:${fill};` +
        `box-shadow:inset 0 0 0 ${picked ? 7 : 3}px ${picked ? RED : INK};pointer-events:auto;cursor:pointer`,
      this.body,
    );
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.pickSlot(i);
    });
    label(g, keyName(SLOT_KEYS[i]), 12, 8, 24, open ? '#b8b2a4' : GREY);
    const text = open ? (id ? t(`skill.${id}`) : '—') : t('skills.slotLv', { n: SLOT_LEVEL[i] });
    label(g, text, BOX_W / 2, BOX_H / 2 + 8, open ? 36 : 28, open ? PAPER : GREY, 0.5, 0.5);
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
