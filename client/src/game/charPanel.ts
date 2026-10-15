import { Container, Graphics, Rectangle, Text, type TextStyleOptions } from 'pixi.js';
import { VIEW_H, VIEW_W } from './layout';
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
const SLOT = 120;
const CELL = 90;
const COLS = 10;
const BAG_LEFT = 700;
const BAG_TOP = 100;
/** Where the picked piece is shown, under the bag. */
const DETAIL_Y = 670;

type Pick = { bag: number } | { slot: Slot } | null;
/** A message after something done, and its colour. */
type Note = { text: string; fill: number } | null;

const FORGE_NOTE: Record<Exclude<EnhanceResult, 'max'>, [Key, number]> = {
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

export class CharPanel {
  readonly layer = new Container();
  private readonly body = new Container();
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

  /** Called once the panel closes. */
  onClose: () => void = () => {};
  /** A tap's sound. */
  onClick: () => void = () => {};

  constructor() {
    // a veil over the whole view takes every tap that misses the card
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
    this.shop = false;
    this.layer.visible = true;
    this.after(null);
  }

  close(): void {
    if (!this.open) return;
    this.layer.visible = false;
    for (const c of this.body.removeChildren()) c.destroy({ children: true });
    this.onClose();
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

    // level and experience
    text(t('char.title', { n: ch.level }), 40, 26, 50);
    const top = ch.level >= MAX_LEVEL;
    const need = xpToNext(ch.level);
    const xg = new Graphics().rect(40, 100, 560, 16).fill({ color: INK, alpha: 0.15 });
    if (!top) xg.rect(40, 100, (560 * Math.min(ch.xp, need)) / need, 16).fill(RED);
    b.addChild(xg.rect(40, 100, 560, 16).stroke({ width: 2, color: INK }));
    text(top ? t('char.xpMax') : t('char.xp', { xp: ch.xp, next: need }), 40, 124, 24, GREY);

    // the slots, two by three, and the stats beside them
    const pickedSlot = this.pick && 'slot' in this.pick ? this.pick.slot : null;
    SLOTS.forEach((slot, i) => {
      const x = 40 + (i % 2) * (SLOT + 30);
      const y = 176 + Math.floor(i / 2) * (SLOT + 38);
      const g = ch.worn[slot];
      this.cell(x, y, SLOT, g ?? null, slot, pickedSlot === slot, false, () => this.select({ slot }));
      const name = text(t(`slot.${slot}` as Key), x + SLOT / 2, y + SLOT + 4, 22, GREY);
      name.anchor.set(0.5, 0);
    });
    const st = ch.stats();
    STATS.forEach((s, i) => {
      text(t(`stat.${s}` as Key), 370, 186 + i * 50, 28, GREY);
      const v = text(fmt(s, st[s]), 640, 186 + i * 50, 28);
      v.anchor.set(1, 0);
    });
    const note = text(t('char.nextRun'), 370, 446, 22, GREY);
    note.style.wordWrap = true;
    note.style.wordWrapWidth = 280;

    // the purse, the shop, salvaging the plain pieces at once
    text(t('char.purse', { gold: ch.gold, stones: ch.stones, tickets: ch.tickets }), W - 110, 46, 26).anchor.set(1, 0);
    b.addChild(
      button(t(this.shop ? 'char.toBag' : 'char.shop'), 270, 64, () => {
        this.onClick();
        this.shop = !this.shop;
        this.after(null);
      }),
    ).position.set(505, 556);
    const plain = plainPieces(ch);
    b.addChild(
      button(
        t(this.sure === 'plain' ? 'char.plainSure' : 'char.plain', { n: plain.length }),
        270,
        64,
        () => {
          this.onClick();
          if (!plain.length) return this.after({ text: t('char.plainNone'), fill: GREY });
          if (this.sure !== 'plain') {
            this.sure = 'plain';
            return this.draw();
          }
          this.after({ text: t('char.salvaged', { n: cashIn(ch, plain, 'salvage') }), fill: GREEN });
        },
        this.sure === 'plain' ? RED : GREY,
        26,
      ),
    ).position.set(505, 634);

    if (this.shop) this.goods();
    else this.bag();
    // close
    b.addChild(button('✕', 64, 64, () => this.close(), GREY)).position.set(W - 50, 50);

    this.detail();
  }

  /** The shop: each of the goods, its price, a button to buy one. */
  private goods(): void {
    const ch = this.ch!;
    const b = this.body;
    const title = new Text({ text: t('shop.title'), style: style(34) });
    title.position.set(BAG_LEFT, 40);
    b.addChild(title);
    GOODS.forEach((good, i) => {
      const y = BAG_TOP + 10 + i * 150;
      b.addChild(new Graphics().roundRect(BAG_LEFT, y, W - 40 - BAG_LEFT, 130, 12).fill({ color: CELL_BG, alpha: 0.7 }));
      const name = new Text({ text: t(`shop.${good.id}`), style: style(34) });
      name.position.set(BAG_LEFT + 24, y + 16);
      const info = new Text({ text: t(good.id === 'ticket' ? 'shop.ticketInfo' : 'shop.stoneInfo'), style: style(22, GREY) });
      info.style.wordWrap = true;
      info.style.wordWrapWidth = 420;
      info.position.set(BAG_LEFT + 24, y + 66);
      const poor = ch.gold < good.price;
      const price = new Text({ text: t('shop.price', { n: good.price }), style: style(30, poor ? RED : INK) });
      price.anchor.set(1, 0.5);
      price.position.set(W - 290, y + 65);
      b.addChild(name, info, price);
      b.addChild(
        button(
          t('shop.buy'),
          200,
          76,
          () => {
            this.onClick();
            this.after(buy(ch, good.id) ? { text: t('shop.bought', { name: t(`shop.${good.id}`) }), fill: GREEN } : { text: t('shop.poor'), fill: RED });
          },
          poor ? GREY : RED,
        ),
      ).position.set(W - 150, y + 65);
    });
  }

  /** The bag's grid. */
  private bag(): void {
    const ch = this.ch!;
    const b = this.body;
    const title = new Text({ text: t('char.bag', { n: ch.bag.length, max: BAG_SIZE }), style: style(34, full(ch) ? RED : INK) });
    title.position.set(BAG_LEFT, 40);
    b.addChild(title);
    for (let i = 0; i < BAG_SIZE; i++) {
      const x = BAG_LEFT + (i % COLS) * CELL;
      const y = BAG_TOP + Math.floor(i / COLS) * CELL;
      const g = ch.bag[i];
      if (!g) {
        b.addChild(new Graphics().rect(x + 3, y + 3, CELL - 6, CELL - 6).fill({ color: CELL_BG, alpha: 0.6 }));
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
    const c = new Container();
    c.position.set(x, y);
    const ink = g ? RARITY_INK[g.rarity] : GREY;
    const gr = new Graphics().rect(0, 0, size, size).fill(CELL_BG);
    if (tooHigh) gr.rect(0, 0, size, size).fill({ color: RED, alpha: 0.18 });
    gr.rect(2, 2, size - 4, size - 4).stroke({ width: g ? 5 : 2, color: ink, alpha: g ? 1 : 0.5 });
    if (picked) gr.rect(-4, -4, size + 8, size + 8).stroke({ width: 4, color: RED });
    c.addChild(gr);
    const glyph = new Text({ text: t(`glyph.${slot}` as Key), style: style(Math.round(size * 0.42), ink) });
    glyph.alpha = g ? 1 : 0.3;
    glyph.anchor.set(0.5);
    glyph.position.set(size / 2, size / 2 - (g ? 4 : 0));
    c.addChild(glyph);
    if (g) {
      const lv = new Text({ text: `${g.lv}`, style: style(Math.round(size * 0.22), tooHigh ? RED : INK) });
      lv.anchor.set(1, 1);
      lv.position.set(size - 6, size - 2);
      c.addChild(lv);
      if (g.plus) {
        const plus = new Text({ text: `+${g.plus}`, style: style(Math.round(size * 0.22), RED) });
        plus.position.set(7, 4);
        c.addChild(plus);
      }
    }
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.hitArea = new Rectangle(0, 0, size, size);
    c.on('pointertap', () => {
      this.onClick();
      act();
    });
    this.body.addChild(c);
  }

  /** The picked piece under the bag: name, level, its stats against the one worn, the buttons. */
  private detail(): void {
    const ch = this.ch!;
    const b = this.body;
    const y0 = DETAIL_Y;
    b.addChild(new Graphics().moveTo(40, y0 - 16).lineTo(W - 40, y0 - 16).stroke({ width: 2, color: INK, alpha: 0.3 }));
    const p = this.pick;
    const g = p === null ? undefined : 'bag' in p ? ch.bag.find((x) => x.id === p.bag) : ch.worn[p.slot];
    if (!g) {
      const n = this.note ?? { text: full(ch) ? t('char.bagFull') : t('char.pick'), fill: GREY };
      const hint = new Text({ text: n.text, style: style(28, n.fill) });
      hint.position.set(40, y0);
      b.addChild(hint);
      return;
    }
    const name = new Text({ text: nameOf(g), style: style(40, RARITY_INK[g.rarity]) });
    name.position.set(40, y0);
    const info = new Text({
      text: t('char.info', { lv: g.lv, slot: t(`slot.${g.slot}` as Key), rarity: t(`rarity.${g.rarity}` as Key) }),
      style: style(24, GREY),
    });
    info.position.set(40, y0 + 54);
    b.addChild(name, info);
    if (!ch.canWear(g)) {
      const need = new Text({ text: t('char.needLv', { n: g.lv }), style: style(24, RED) });
      need.position.set(40 + info.width + 30, y0 + 54);
      b.addChild(need);
    }
    if (this.note) {
      const n = new Text({ text: this.note.text, style: style(30, this.note.fill) });
      n.position.set(40 + name.width + 40, y0 + 6);
      b.addChild(n);
    }
    if (this.forging) return this.forge(g);

    // its stats, and against the worn one (a piece in the bag only)
    const mine = gearStats(g);
    const worn = p && 'bag' in p ? ch.worn[g.slot] : undefined;
    const theirs: Partial<Stats> = worn ? gearStats(worn) : {};
    const shown = STATS.filter((s) => mine[s] !== undefined || (p && 'bag' in p && theirs[s] !== undefined));
    shown.forEach((s, i) => {
      const x = 40 + Math.floor(i / 2) * 360;
      const y = y0 + 100 + (i % 2) * 40;
      const v = mine[s] ?? 0;
      const line = new Text({ text: `${t(`stat.${s}` as Key)}  ${v ? signed(s, v) : '—'}`, style: style(28, i === 0 ? INK : 0x4a4640) });
      line.position.set(x, y);
      b.addChild(line);
      if (p && 'bag' in p) {
        const d = v - (theirs[s] ?? 0);
        if (d !== 0) {
          const delta = new Text({ text: signed(s, d), style: style(26, d > 0 ? GREEN : RED) });
          delta.position.set(x + line.width + 20, y + 2);
          b.addChild(delta);
        }
      }
    });

    // the buttons: enhance, and put on or take off; for a piece in the bag, sell and salvage,
    // asking twice for anything past a plain one
    const by = y0 + 75;
    b.addChild(
      button(t('char.enhance'), 230, 72, () => {
        this.onClick();
        this.forging = true;
        this.note = null;
        this.draw();
      }),
    ).position.set(W - 400, by);
    if (p && 'bag' in p) {
      if (ch.canWear(g)) b.addChild(button(t('char.wear'), 230, 72, () => this.wear(g.id), RED)).position.set(W - 150, by);
      const cash = (how: 'sell' | 'salvage', x: number) => {
        const label = this.sure === how ? t('char.sure') : t(`char.${how}`, { n: how === 'sell' ? sellValue(g) : salvageValue(g) });
        const act = () => {
          this.onClick();
          if (this.sure !== how && (g.rarity > 1 || g.plus > 0)) {
            this.sure = how;
            return this.draw();
          }
          const n = cashIn(ch, [g.id], how);
          this.after({ text: t(how === 'sell' ? 'char.sold' : 'char.salvaged', { n }), fill: GREEN });
        };
        b.addChild(button(label, 230, 72, act, this.sure === how ? RED : GREY, 28)).position.set(x, y0 + 165);
      };
      cash('salvage', W - 400);
      cash('sell', W - 150);
    } else if (p) {
      b.addChild(button(t('char.takeOff'), 230, 72, () => ch.takeOff(p.slot) && this.done(null), INK)).position.set(W - 150, by);
    }
  }

  /** Enhancing the picked piece: the step, its chance, what a failure does, the main stat, the cost. */
  private forge(g: Gear): void {
    const ch = this.ch!;
    const b = this.body;
    const y0 = DETAIL_Y;
    const line = (s: string, x: number, y: number, size: number, fill = INK) => {
      const tx = new Text({ text: s, style: style(size, fill) });
      tx.position.set(x, y);
      b.addChild(tx);
      return tx;
    };
    const back = () => {
      this.onClick();
      this.forging = false;
      this.note = null;
      this.draw();
    };
    b.addChild(button(t('char.back'), 230, 72, back, GREY)).position.set(W - 150, y0 + 165);
    if (g.plus >= MAX_PLUS) {
      line(t('forge.top', { n: g.plus }), 40, y0 + 100, 30);
      return;
    }
    const cost = enhanceCost(g);
    const step = line(t('forge.step', { from: g.plus, to: g.plus + 1, rate: cost.rate }), 40, y0 + 100, 30);
    const f = failure(g.plus);
    // a ticket counts only where a failure would break the piece
    const protect = f === 'break' && ch.tickets > 0 && this.protect;
    if (cost.rate < 100) {
      const what = f !== 'break' ? t('forge.failDrop', { n: f.drop }) : protect ? t('forge.protectNote') : t('forge.failBreak');
      line(what, 40 + step.width + 40, y0 + 102, 28, RED);
    }
    const s = mainStat(g.slot);
    const after = enhancedMain({ ...g, plus: g.plus + 1 });
    line(t('forge.stat', { stat: t(`stat.${s}` as Key), from: fmt(s, enhancedMain(g)), to: fmt(s, after) }), 40, y0 + 146, 28, GREEN);
    const poor = ch.gold < cost.gold || ch.stones < cost.stones;
    line(t('forge.cost', { gold: cost.gold, stones: cost.stones }), 40, y0 + 190, 26, poor ? RED : GREY);

    if (f === 'break') {
      const label = t('forge.protect', { on: t(protect ? 'forge.on' : 'forge.off'), n: ch.tickets });
      const toggle = () => {
        this.onClick();
        this.protect = !this.protect;
        this.draw();
      };
      b.addChild(button(label, 330, 72, toggle, protect ? GREEN : GREY, 26)).position.set(W - 450, y0 + 165);
    }
    const go = () => {
      this.onClick();
      const r = enhance(ch, g, protect, deviceRand);
      if (r === 'max') return this.draw();
      const [key, fill] = FORGE_NOTE[r];
      const note = { text: t(key, { n: g.plus }), fill };
      if (r === 'broke') return this.after(note);
      this.note = note;
      this.draw();
    };
    b.addChild(button(t('char.enhance'), 230, 72, go, RED)).position.set(W - 150, y0 + 75);
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
