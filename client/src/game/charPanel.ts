import { CELL_BG, DARK, GREEN, GREY, INK, RED, VIEW_H, VIEW_W, button, css, el, label, show, type Overlay } from './dom';
import { t, type Key } from '../i18n';
import { deviceRand } from '../platform/store';
import { BAG_SIZE, xpToNext, type Character } from '../rpg/character';
import { GOODS, buy, cashIn, enhance, enhanceCost, failure, plainPieces, salvageValue, sellValue, type EnhanceResult } from '../rpg/forge';
import {
  MAX_LEVEL,
  MAX_PLUS,
  RARITY_INK,
  SLOTS,
  STATS,
  enhancedMain,
  gearNameKey,
  gearStats,
  mainStat,
  type Gear,
  type Slot,
  type Stat,
  type Stats,
} from '../rpg/gear';

// The character panel (single player): level and experience, the purse, the six slots with what
// is worn, the stats they add up to, and the bag. Tap a piece to see it, compared with the one
// worn in its slot; tap it again (or the button) to put it on, or enhance, sell or salvage it.
// The shop takes the bag's place. Changes are saved at once and apply from the next run: the run
// under way keeps the stats it started with. Rebuilt whole on every change.

const W = 1640;
const H = 900;
const SLOT = 120;
const CELL = 90;
const COLS = 10;
const BAG_LEFT = 700;
const BAG_TOP = 100;
/** Where the picked piece is shown, under the bag. */
const DETAIL_Y = 670;

type Pick = { bag: number } | { slot: Slot } | null;
/** A message after something done, and its colour. */
type Note = { text: string; fill: string } | null;

const FORGE_NOTE: Record<Exclude<EnhanceResult, 'max'>, [Key, string]> = {
  up: ['forge.up', GREEN],
  down: ['forge.down', RED],
  kept: ['forge.kept', RED],
  broke: ['forge.broke', RED],
  poor: ['forge.poor', RED],
};

/** Crit, crit damage and cooldown read in percent. */
const PCT: ReadonlySet<Stat> = new Set(['crit', 'critDmg', 'cdr']);
const fmt = (s: Stat, n: number) => `${n}${PCT.has(s) ? '%' : ''}`;
const signed = (s: Stat, n: number) => `${n >= 0 ? '+' : '−'}${fmt(s, Math.abs(n))}`;

/** A piece's name, with its enhancement. */
const nameOf = (g: Gear) => `${g.plus ? `+${g.plus} ` : ''}${t(gearNameKey(g))}`;

export class CharPanel {
  private readonly veil: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private pick: Pick = null;
  /** The first tap of something that asks twice. */
  private sure: 'sell' | 'salvage' | 'plain' | null = null;
  /** Showing the picked piece's enhancement. */
  private forging = false;
  private protect = true;
  /** The shop in the bag's place. */
  private shop = false;
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
    this.shop = false;
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

  /** Draws it again (a change, or the language). */
  draw(): void {
    const ch = this.ch;
    if (!ch || !this.open) return;
    const b = this.body;
    b.replaceChildren();
    const text = (s: string, x: number, y: number, size: number, fill = INK) => label(b, s, x, y, size, fill);

    // level and experience
    text(t('char.title', { n: ch.level }), 40, 26, 50);
    const top = ch.level >= MAX_LEVEL;
    const need = xpToNext(ch.level);
    const xb = el('div', `position:absolute;left:40px;top:100px;width:560px;height:16px;background:rgba(20,19,23,.15);outline:2px solid ${INK};outline-offset:-1px`, b);
    if (!top) el('div', `position:absolute;left:0;top:0;height:100%;width:${(100 * Math.min(ch.xp, need)) / need}%;background:${RED}`, xb);
    text(top ? t('char.xpMax') : t('char.xp', { xp: ch.xp, next: need }), 40, 124, 24, GREY);

    // the slots, two by three, and the stats beside them
    const pickedSlot = this.pick && 'slot' in this.pick ? this.pick.slot : null;
    SLOTS.forEach((slot, i) => {
      const x = 40 + (i % 2) * (SLOT + 30);
      const y = 176 + Math.floor(i / 2) * (SLOT + 38);
      const g = ch.worn[slot];
      this.cell(x, y, SLOT, g ?? null, slot, pickedSlot === slot, false, () => this.select({ slot }));
      label(b, t(`slot.${slot}` as Key), x + SLOT / 2, y + SLOT + 4, 22, GREY, 0.5, 0);
    });
    const st = ch.stats();
    STATS.forEach((s, i) => {
      text(t(`stat.${s}` as Key), 370, 186 + i * 50, 28, GREY);
      label(b, fmt(s, st[s]), 640, 186 + i * 50, 28, INK, 1, 0);
    });
    label(b, t('char.nextRun'), 370, 446, 22, GREY, 0, 0, 'white-space:normal;width:280px');

    // the purse, the shop, salvaging the plain pieces at once
    label(b, t('char.purse', { gold: ch.gold, stones: ch.stones, tickets: ch.tickets }), W - 110, 46, 26, INK, 1, 0);
    button(b, t(this.shop ? 'char.toBag' : 'char.shop'), 505, 556, 270, 64, 32, INK, () => {
      this.onClick();
      this.shop = !this.shop;
      this.after(null);
    });
    const plain = plainPieces(ch);
    button(
      b,
      t(this.sure === 'plain' ? 'char.plainSure' : 'char.plain', { n: plain.length }),
      505,
      634,
      270,
      64,
      26,
      this.sure === 'plain' ? RED : GREY,
      () => {
        this.onClick();
        if (!plain.length) return this.after({ text: t('char.plainNone'), fill: GREY });
        if (this.sure !== 'plain') {
          this.sure = 'plain';
          return this.draw();
        }
        this.after({ text: t('char.salvaged', { n: cashIn(ch, plain, 'salvage') }), fill: GREEN });
      },
    );

    if (this.shop) this.goods();
    else this.bag();
    // close
    button(b, '✕', W - 50, 50, 64, 64, 32, GREY, () => this.close());

    this.detail();
  }

  /** The shop: each of the goods, its price, a button to buy one. */
  private goods(): void {
    const ch = this.ch!;
    const b = this.body;
    label(b, t('shop.title'), BAG_LEFT, 40, 34);
    GOODS.forEach((good, i) => {
      const y = BAG_TOP + 10 + i * 150;
      el('div', `position:absolute;left:${BAG_LEFT}px;top:${y}px;width:${W - 40 - BAG_LEFT}px;height:130px;border-radius:12px;background:rgba(230,223,207,.7)`, b);
      label(b, t(`shop.${good.id}`), BAG_LEFT + 24, y + 16, 34);
      label(b, t(good.id === 'ticket' ? 'shop.ticketInfo' : 'shop.stoneInfo'), BAG_LEFT + 24, y + 66, 22, GREY, 0, 0, 'white-space:normal;width:420px');
      const poor = ch.gold < good.price;
      label(b, t('shop.price', { n: good.price }), W - 290, y + 65, 30, poor ? RED : INK, 1, 0.5);
      button(b, t('shop.buy'), W - 150, y + 65, 200, 76, 32, poor ? GREY : RED, () => {
        this.onClick();
        this.after(buy(ch, good.id) ? { text: t('shop.bought', { name: t(`shop.${good.id}`) }), fill: GREEN } : { text: t('shop.poor'), fill: RED });
      });
    });
  }

  /** The bag's grid. */
  private bag(): void {
    const ch = this.ch!;
    const b = this.body;
    label(b, t('char.bag', { n: ch.bag.length, max: BAG_SIZE }), BAG_LEFT, 40, 34, full(ch) ? RED : INK);
    for (let i = 0; i < BAG_SIZE; i++) {
      const x = BAG_LEFT + (i % COLS) * CELL;
      const y = BAG_TOP + Math.floor(i / COLS) * CELL;
      const g = ch.bag[i];
      if (!g) {
        el('div', `position:absolute;left:${x + 3}px;top:${y + 3}px;width:${CELL - 6}px;height:${CELL - 6}px;background:rgba(230,223,207,.6)`, b);
        continue;
      }
      const picked = this.pick !== null && 'bag' in this.pick && this.pick.bag === g.id;
      this.cell(x + 3, y + 3, CELL - 6, g, g.slot, picked, !ch.canWear(g), () => {
        if (picked) this.wear(g.id);
        else this.select({ bag: g.id });
      });
    }
  }

  /** One square: the piece's rarity in the border, the slot's sign, its level and enhancement. */
  private cell(x: number, y: number, size: number, g: Gear | null, slot: Slot, picked: boolean, tooHigh: boolean, act: () => void): void {
    const ink = g ? css(RARITY_INK[g.rarity]) : GREY;
    const c = el(
      'div',
      `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${CELL_BG};pointer-events:auto;cursor:pointer;` +
        (picked ? `outline:4px solid ${RED};outline-offset:2px;` : ''),
      this.body,
    );
    if (tooHigh) el('div', 'position:absolute;inset:0;background:rgba(200,40,30,.18)', c);
    el('div', `position:absolute;inset:${g ? -0.5 : 1}px;border:${g ? 5 : 2}px solid ${ink};opacity:${g ? 1 : 0.5}`, c);
    label(c, t(`glyph.${slot}` as Key), size / 2, size / 2 - (g ? 4 : 0), Math.round(size * 0.42), ink, 0.5, 0.5, `opacity:${g ? 1 : 0.3}`);
    if (g) {
      label(c, `${g.lv}`, size - 6, size - 2, Math.round(size * 0.22), tooHigh ? RED : INK, 1, 1);
      if (g.plus) label(c, `+${g.plus}`, 7, 4, Math.round(size * 0.22), RED);
    }
    c.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onClick();
      act();
    });
  }

  /** The picked piece under the bag: name, level, its stats against the one worn, the buttons. */
  private detail(): void {
    const ch = this.ch!;
    const b = this.body;
    const y0 = DETAIL_Y;
    el('div', `position:absolute;left:40px;top:${y0 - 17}px;width:${W - 80}px;height:2px;background:rgba(20,19,23,.3)`, b);
    const p = this.pick;
    const g = p === null ? undefined : 'bag' in p ? ch.bag.find((x) => x.id === p.bag) : ch.worn[p.slot];
    if (!g) {
      const n = this.note ?? { text: full(ch) ? t('char.bagFull') : t('char.pick'), fill: GREY };
      label(b, n.text, 40, y0, 28, n.fill);
      return;
    }
    // the name, its line under it, and a note after each: laid out in rows, so they follow on
    const row = (y: number) => el('div', `position:absolute;left:40px;top:${y}px;display:flex;align-items:baseline;gap:30px;white-space:pre`, b);
    const top = row(y0);
    el('div', `font-size:40px;color:${css(RARITY_INK[g.rarity])}`, top, nameOf(g));
    if (this.note) el('div', `font-size:30px;color:${this.note.fill};margin-left:10px`, top, this.note.text);
    const info = row(y0 + 54);
    el('div', `font-size:24px;color:${GREY}`, info, t('char.info', { lv: g.lv, slot: t(`slot.${g.slot}` as Key), rarity: t(`rarity.${g.rarity}` as Key) }));
    if (!ch.canWear(g)) el('div', `font-size:24px;color:${RED}`, info, t('char.needLv', { n: g.lv }));
    if (this.forging) return this.forge(g);

    // its stats, and against the worn one (a piece in the bag only)
    const mine = gearStats(g);
    const worn = p && 'bag' in p ? ch.worn[g.slot] : undefined;
    const theirs: Partial<Stats> = worn ? gearStats(worn) : {};
    const listed = STATS.filter((s) => mine[s] !== undefined || (p && 'bag' in p && theirs[s] !== undefined));
    listed.forEach((s, i) => {
      const v = mine[s] ?? 0;
      const line = el('div', `position:absolute;left:${40 + Math.floor(i / 2) * 360}px;top:${y0 + 100 + (i % 2) * 40}px;display:flex;align-items:baseline;gap:20px;white-space:pre`, b);
      el('div', `font-size:28px;color:${i === 0 ? INK : DARK}`, line, `${t(`stat.${s}` as Key)}  ${v ? signed(s, v) : '—'}`);
      if (p && 'bag' in p) {
        const d = v - (theirs[s] ?? 0);
        if (d !== 0) el('div', `font-size:26px;color:${d > 0 ? GREEN : RED}`, line, signed(s, d));
      }
    });

    // the buttons: enhance, and put on or take off; for a piece in the bag, sell and salvage,
    // asking twice for anything past a plain one
    const by = y0 + 75;
    button(b, t('char.enhance'), W - 400, by, 230, 72, 32, INK, () => {
      this.onClick();
      this.forging = true;
      this.note = null;
      this.draw();
    });
    if (p && 'bag' in p) {
      if (ch.canWear(g)) button(b, t('char.wear'), W - 150, by, 230, 72, 32, RED, () => this.wear(g.id));
      const cash = (how: 'sell' | 'salvage', x: number) => {
        const text = this.sure === how ? t('char.sure') : t(`char.${how}`, { n: how === 'sell' ? sellValue(g) : salvageValue(g) });
        button(b, text, x, y0 + 165, 230, 72, 28, this.sure === how ? RED : GREY, () => {
          this.onClick();
          if (this.sure !== how && (g.rarity > 1 || g.plus > 0)) {
            this.sure = how;
            return this.draw();
          }
          const n = cashIn(ch, [g.id], how);
          this.after({ text: t(how === 'sell' ? 'char.sold' : 'char.salvaged', { n }), fill: GREEN });
        });
      };
      cash('salvage', W - 400);
      cash('sell', W - 150);
    } else if (p) {
      button(b, t('char.takeOff'), W - 150, by, 230, 72, 32, INK, () => ch.takeOff(p.slot) && this.done(null));
    }
  }

  /** Enhancing the picked piece: the step, its chance, what a failure does, the main stat, the cost. */
  private forge(g: Gear): void {
    const ch = this.ch!;
    const b = this.body;
    const y0 = DETAIL_Y;
    const back = () => {
      this.onClick();
      this.forging = false;
      this.note = null;
      this.draw();
    };
    button(b, t('char.back'), W - 150, y0 + 165, 230, 72, 32, GREY, back);
    if (g.plus >= MAX_PLUS) {
      label(b, t('forge.top', { n: g.plus }), 40, y0 + 100, 30);
      return;
    }
    const cost = enhanceCost(g);
    const step = el('div', `position:absolute;left:40px;top:${y0 + 100}px;display:flex;align-items:baseline;gap:40px;white-space:pre`, b);
    el('div', 'font-size:30px', step, t('forge.step', { from: g.plus, to: g.plus + 1, rate: cost.rate }));
    const f = failure(g.plus);
    // a ticket counts only where a failure would break the piece
    const protect = f === 'break' && ch.tickets > 0 && this.protect;
    if (cost.rate < 100) {
      const what = f !== 'break' ? t('forge.failDrop', { n: f.drop }) : protect ? t('forge.protectNote') : t('forge.failBreak');
      el('div', `font-size:28px;color:${RED}`, step, what);
    }
    const s = mainStat(g.slot);
    const after = enhancedMain({ ...g, plus: g.plus + 1 });
    label(b, t('forge.stat', { stat: t(`stat.${s}` as Key), from: fmt(s, enhancedMain(g)), to: fmt(s, after) }), 40, y0 + 146, 28, GREEN);
    const poor = ch.gold < cost.gold || ch.stones < cost.stones;
    label(b, t('forge.cost', { gold: cost.gold, stones: cost.stones }), 40, y0 + 190, 26, poor ? RED : GREY);

    if (f === 'break') {
      const text = t('forge.protect', { on: t(protect ? 'forge.on' : 'forge.off'), n: ch.tickets });
      button(b, text, W - 450, y0 + 165, 330, 72, 26, protect ? GREEN : GREY, () => {
        this.onClick();
        this.protect = !this.protect;
        this.draw();
      });
    }
    button(b, t('char.enhance'), W - 150, y0 + 75, 230, 72, 32, RED, () => {
      this.onClick();
      const r = enhance(ch, g, protect, deviceRand);
      if (r === 'max') return this.draw();
      const [key, fill] = FORGE_NOTE[r];
      const note = { text: t(key, { n: g.plus }), fill };
      if (r === 'broke') return this.after(note);
      this.note = note;
      this.draw();
    });
  }

  private select(p: Pick): void {
    this.pick = p;
    this.sure = null;
    this.forging = false;
    this.note = null;
    this.draw();
  }

  /** Something done that leaves nothing picked; `note` says what. */
  private after(note: Note): void {
    this.pick = null;
    this.sure = null;
    this.forging = false;
    this.note = note;
    this.draw();
  }

  private wear(id: number): void {
    const ch = this.ch!;
    const g = ch.bag.find((x) => x.id === id);
    if (g && ch.wear(id)) this.done({ slot: g.slot });
  }

  /** A change made: saved, and drawn again. */
  private done(p: Pick): boolean {
    this.ch!.save();
    this.select(p);
    return true;
  }
}

function full(ch: Character): boolean {
  return ch.bag.length >= BAG_SIZE;
}

/** A panel's veil over the whole window (a tap on it closes the panel) and its paper card,
 * `w` by `h` in the middle, both hidden until shown. */
export function card(ui: Overlay, w: number, h: number, close: () => void): { veil: HTMLDivElement; frame: HTMLDivElement; body: HTMLDivElement } {
  const veil = ui.layer('background:rgba(20,19,23,.55);pointer-events:auto;display:none');
  veil.addEventListener('click', close);
  const frame = ui.frame('cm');
  frame.style.display = 'none';
  const body = el(
    'div',
    `position:absolute;left:${(VIEW_W - w) / 2}px;top:${(VIEW_H - h) / 2}px;width:${w}px;height:${h}px;border-radius:20px;` +
      `background:rgba(243,238,226,.97);box-shadow:inset 0 0 0 4px ${INK};pointer-events:auto;color:${INK}`,
    frame,
  );
  return { veil, frame, body };
}
