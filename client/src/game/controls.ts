import { BTN, DODGE, SKILLS, TICK_RATE, type SimState, type SkillId } from '@dnf/engine';
import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent, type TextStyleOptions } from 'pixi.js';
import { VIEW_H, VIEW_W } from './layout';

// The on-screen controls, for touch (and the mouse): a floating stick on the left, the seven
// buttons on the right, attack the largest with jump and the dodge beside it and the three skills
// and the ultimate in an arc above. Each button shows its key and, while cooling down, a sweep
// and the seconds left. Like the keyboard it hands out engine buttons, held or tapped since the
// last read.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill: number): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold', align: 'center' });

const NAMES: Record<SkillId, string> = {
  triple: '三段斩',
  dragon: '猛龙',
  upper: '上挑',
  crush: '破军',
  iai: '拔刀',
  phantom: '剑舞',
};

interface Pad {
  btn: number;
  x: number;
  y: number;
  r: number;
  key: string;
  /** The cooldown it shows: a skill slot, the dodge's, or none. */
  cd: number | null;
  name: string;
  label: Text;
  timer: Text;
}

const STICK_HOME = { x: 270, y: 850 };
/** How far the knob travels, the dead zone at its middle, and how far out it runs. */
const STICK_R = 110;
const DEAD = 26;
const RUN_AT = 0.85;
/** sin 22.5 degrees: a direction counts when the stick leans at least this far toward it. */
const LEAN = 0.38;
/** The horizontal buttons withheld, given, withheld, given over the next four reads: a double
 * tap, which is how the engine starts a run. */
const RUN_TAPS = [false, true, false, true];

export class Controls {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly pads: Pad[];
  private held = 0;
  private tapped = 0;
  /** Which pointer holds what: the stick, or a button's bit. */
  private readonly pointers = new Map<number, 'stick' | number>();
  private base = { ...STICK_HOME };
  private knob = { x: 0, y: 0 };
  private stickBits = 0;
  private runTaps: boolean[] = [];
  private skills: readonly SkillId[] = [];

  constructor() {
    const pad = (btn: number, x: number, y: number, r: number, key: string, cd: number | null, name: string): Pad => {
      const label = new Text({ text: '', style: style(r > 80 ? 34 : 26, 0xf3eee2) });
      const timer = new Text({ text: '', style: style(30, 0xf3eee2) });
      label.anchor.set(0.5);
      timer.anchor.set(0.5);
      label.position.set(x, y);
      timer.position.set(x, y + r * 0.42);
      return { btn, x, y, r, key, cd, name, label, timer };
    };
    this.pads = [
      pad(BTN.ATTACK, 1730, 915, 105, 'X', null, '攻击'),
      pad(BTN.JUMP, 1520, 990, 60, 'C', null, '跳'),
      pad(BTN.DODGE, 1385, 990, 56, 'Z', DODGE.slot, '闪避'),
      pad(BTN.SKILL1, 1505, 830, 66, 'A', 0, ''),
      pad(BTN.SKILL2, 1570, 680, 66, 'S', 1, ''),
      pad(BTN.SKILL3, 1705, 610, 66, 'D', 2, ''),
      pad(BTN.ULT, 1845, 690, 72, 'F', 3, ''),
    ];
    this.layer.addChild(this.g, ...this.pads.flatMap((p) => [p.label, p.timer]));
    this.layer.eventMode = 'static';
    this.layer.hitArea = new Rectangle(0, 0, VIEW_W, VIEW_H);
    this.layer.on('pointerdown', (ev) => this.down(ev));
    this.layer.on('globalpointermove', (ev) => this.move(ev));
    for (const name of ['pointerup', 'pointerupoutside', 'pointercancel'] as const) this.layer.on(name, (ev) => this.up(ev));
  }

  /** The buttons for the next tick: held now, or tapped since the last read. */
  read(): number {
    let stick = this.stickBits;
    const tap = this.runTaps.shift();
    if (tap === false) stick &= ~(BTN.LEFT | BTN.RIGHT);
    const b = this.held | this.tapped | stick;
    this.tapped = 0;
    return b;
  }

  private local(ev: FederatedPointerEvent): { x: number; y: number } {
    return this.layer.toLocal(ev.global);
  }

  private down(ev: FederatedPointerEvent): void {
    const p = this.local(ev);
    const pad = this.pads.find((q) => Math.hypot(p.x - q.x, p.y - q.y) <= q.r * 1.2);
    if (pad) {
      this.pointers.set(ev.pointerId, pad.btn);
      this.held |= pad.btn;
    } else if (p.x < VIEW_W * 0.45 && p.y > VIEW_H * 0.3 && ![...this.pointers.values()].includes('stick')) {
      // the stick comes to the thumb
      this.pointers.set(ev.pointerId, 'stick');
      this.base = p;
      this.knob = { x: 0, y: 0 };
    }
  }

  private move(ev: FederatedPointerEvent): void {
    if (this.pointers.get(ev.pointerId) !== 'stick') return;
    const p = this.local(ev);
    let dx = p.x - this.base.x;
    let dy = p.y - this.base.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) {
      dx = (dx * STICK_R) / len;
      dy = (dy * STICK_R) / len;
    }
    const wasFar = Math.abs(this.knob.x) >= STICK_R * RUN_AT;
    this.knob = { x: dx, y: dy };
    let bits = 0;
    if (len > DEAD) {
      const ux = dx / Math.hypot(dx, dy);
      const uy = dy / Math.hypot(dx, dy);
      if (ux > LEAN) bits |= BTN.RIGHT;
      else if (ux < -LEAN) bits |= BTN.LEFT;
      if (uy > LEAN) bits |= BTN.DOWN;
      else if (uy < -LEAN) bits |= BTN.UP;
    }
    // pushed all the way along x: run
    if (!wasFar && Math.abs(dx) >= STICK_R * RUN_AT) this.runTaps = [...RUN_TAPS];
    this.stickBits = bits;
  }

  private up(ev: FederatedPointerEvent): void {
    const what = this.pointers.get(ev.pointerId);
    this.pointers.delete(ev.pointerId);
    if (what === 'stick') {
      this.stickBits = 0;
      this.runTaps = [];
      this.base = { ...STICK_HOME };
      this.knob = { x: 0, y: 0 };
    } else if (what !== undefined) {
      this.tapped |= what & this.held;
      this.held &= ~what;
    }
  }

  /** Draws the stick and the buttons with the hero's cooldowns; `keys`: the keyboard's held buttons. */
  update(s: SimState, keys: number): void {
    const slot = s.players[0];
    const hero = slot && s.entities.find((e) => e.id === slot.hero);
    if (slot && slot.skills !== this.skills) {
      this.skills = slot.skills;
      this.pads.forEach((p) => {
        if (p.cd !== null && p.cd < DODGE.slot) p.name = NAMES[slot.skills[p.cd]];
        p.label.text = `${p.name}\n${p.key}`;
      });
    }
    const g = this.g.clear();
    g.circle(this.base.x, this.base.y, STICK_R + 30).fill({ color: 0x141317, alpha: 0.12 }).stroke({ width: 3, color: 0x141317, alpha: 0.35 });
    g.circle(this.base.x + this.knob.x, this.base.y + this.knob.y, 52).fill({ color: 0x141317, alpha: 0.45 });
    const pressed = this.held | keys | this.stickBits;
    for (const p of this.pads) {
      const left = hero && p.cd !== null ? hero.cd[p.cd] : 0;
      const total = p.cd === null ? 1 : p.cd === DODGE.slot ? DODGE.cooldown : SKILLS[this.skills[p.cd]].cooldown;
      const ult = p.btn === BTN.ULT;
      g.circle(p.x, p.y, p.r).fill({ color: left > 0 ? 0x6a665e : ult ? 0x5a1a14 : 0x141317, alpha: 0.78 });
      if (left > 0) {
        // the part still cooling, swept away clockwise from the top
        const a0 = -Math.PI / 2;
        g.moveTo(p.x, p.y).arc(p.x, p.y, p.r, a0, a0 + 2 * Math.PI * Math.min(1, left / total)).closePath().fill({ color: 0x000000, alpha: 0.45 });
      }
      const down = (pressed & p.btn) !== 0;
      g.circle(p.x, p.y, p.r).stroke({ width: down ? 7 : 3, color: down || ult ? 0xc8281e : 0x141317 });
      p.timer.text = left > 0 ? (left / TICK_RATE).toFixed(left < TICK_RATE ? 1 : 0) : '';
      p.label.position.y = left > 0 ? p.y - p.r * 0.18 : p.y;
    }
  }
}
