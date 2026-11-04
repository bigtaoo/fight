import { BTN, DODGE, SKILLS, TICK_RATE, type SimState, type SkillId } from '@dnf/engine';
import { INK, PAPER, RED, el, setText, show, type Overlay } from './dom';
import { getLang, t, type Key } from '../i18n';

// The on-screen controls, for touch: a floating stick on the left, the buttons on the right,
// attack the largest with jump right beside it and the dodge beyond, the bar's first four skills
// in an arc above and its fifth and sixth further left (an empty slot shows no button). Each
// button shows its skill's name and, while cooling down, a sweep and the seconds left. They show
// only on a touch screen (or once the screen is touched); a mouse-only desktop plays on the
// keyboard and sees none of them. ?touch=1 / ?touch=0 force either in a dev build. Like the keyboard
// it hands out engine buttons, held or tapped since the last read. One layer over the whole window
// takes the touches, under the menus' buttons; the stick is drawn in the bottom-left frame and the
// buttons in the bottom-right one, and a touch is looked up in each frame's own coordinates.

interface Pad {
  btn: number;
  x: number;
  y: number;
  r: number;
  /** Its key's code ('KeyX'), named on the player's layout. */
  key: string;
  /** The cooldown it shows: a skill slot, the dodge's, or none. */
  cd: number | null;
  /** What it is called, for the fixed ones (a skill slot's comes from the loadout). */
  name: Key | null;
  disc: HTMLDivElement;
  sweep: HTMLDivElement;
  label: HTMLDivElement;
  timer: HTMLDivElement;
  /** What its look was last set to, so it is written only on a change. */
  look: string;
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
const KNOB_R = 52;

/** Whether this looks like a touch screen at start (the frame cap in Game.ts asks the same). */
function touchAtStart(): boolean {
  const force = import.meta.env.DEV ? new URLSearchParams(location.search).get('touch') : null;
  if (force !== null) return force !== '0';
  return navigator.maxTouchPoints > 0;
}

export class Controls {
  private readonly pads: Pad[];
  private held = 0;
  private tapped = 0;
  /** Which pointer holds what: the stick, or a button's bit. */
  private readonly pointers = new Map<number, 'stick' | number>();
  private base = { ...STICK_HOME };
  private knob = { x: 0, y: 0 };
  private stickBits = 0;
  private runTaps: boolean[] = [];
  private skills: readonly (SkillId | null)[] = [];
  private lang = '';
  private readonly ring: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private stickAt = '';
  /** Whether the touch controls show: a touch screen, or one touched since the start. */
  touch = touchAtStart();
  private readonly stickFrame: HTMLDivElement;
  private readonly padFrame: HTMLDivElement;
  /** Until when (performance.now ms) the jump button flashes, to point it out. */
  private flashUntil = 0;

  constructor(private readonly ui: Overlay) {
    const touch = ui.layer('pointer-events:auto;touch-action:none');
    touch.addEventListener('pointerdown', (ev) => {
      // the first finger on a screen that did not say it takes touch brings the controls out
      if (ev.pointerType === 'touch' && !this.touch) {
        this.touch = true;
        this.lang = '';
      }
      if (this.touch) this.down(ev, touch);
    });
    touch.addEventListener('pointermove', (ev) => this.move(ev));
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) touch.addEventListener(name, (ev) => this.up(ev));
    touch.addEventListener('contextmenu', (ev) => ev.preventDefault());

    const stick = (this.stickFrame = ui.frame('lb'));
    const R = STICK_R + 30;
    this.ring = el('div', `position:absolute;width:${2 * R}px;height:${2 * R}px;margin:${-R}px 0 0 ${-R}px;border-radius:50%;background:rgba(20,19,23,.12);box-shadow:0 0 0 3px rgba(20,19,23,.35)`, stick);
    this.dot = el('div', `position:absolute;width:${2 * KNOB_R}px;height:${2 * KNOB_R}px;margin:${-KNOB_R}px 0 0 ${-KNOB_R}px;border-radius:50%;background:rgba(20,19,23,.45)`, stick);

    const frame = (this.padFrame = ui.frame('rb'));
    const pad = (btn: number, x: number, y: number, r: number, key: string, cd: number | null, name: Key | null): Pad => {
      const disc = el('div', `position:absolute;left:${x - r}px;top:${y - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%`, frame);
      const sweep = el('div', 'position:absolute;inset:0;border-radius:50%', disc);
      const text = `position:absolute;left:${x}px;font-size:${r > 90 ? 34 : r >= 76 ? 30 : 26}px;color:${PAPER};text-align:center;white-space:pre;transform:translate(-50%,-50%)`;
      const label = el('div', `${text};top:${y}px`, frame);
      const timer = el('div', `${text};top:${y + r * 0.42}px;font-size:30px`, frame);
      return { btn, x, y, r, key, cd, name, disc, sweep, label, timer, look: '' };
    };
    // jump and the dodge are about 56 CSS px across on a 375 px tall phone (k ~ 0.35), jump
    // right beside attack; the arc keeps its rightmost button some 20 CSS px off the edge
    this.pads = [
      pad(BTN.ATTACK, 1730, 915, 105, 'KeyX', null, 'pad.attack'),
      pad(BTN.JUMP, 1530, 970, 80, 'KeyC', null, 'pad.jump'),
      pad(BTN.DODGE, 1360, 980, 76, 'KeyZ', DODGE.slot, 'pad.dodge'),
      pad(BTN.SKILL1, 1495, 800, 64, 'KeyA', 0, null),
      pad(BTN.SKILL2, 1555, 655, 64, 'KeyS', 1, null),
      pad(BTN.SKILL3, 1680, 575, 64, 'KeyD', 2, null),
      pad(BTN.SKILL4, 1790, 650, 64, 'KeyF', 3, null),
      pad(BTN.SKILL5, 1335, 840, 60, 'KeyQ', 4, null),
      pad(BTN.SKILL6, 1400, 690, 60, 'KeyW', 5, null),
    ];
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

  private down(ev: PointerEvent, touch: HTMLElement): void {
    ev.preventDefault();
    const p = this.ui.toFrame('rb', ev.clientX, ev.clientY);
    const pad = this.pads.find((q) => this.shown(q) && Math.hypot(p.x - q.x, p.y - q.y) <= q.r * 1.15);
    const s = this.ui.toFrame('lb', ev.clientX, ev.clientY);
    if (pad) {
      this.pointers.set(ev.pointerId, pad.btn);
      this.held |= pad.btn;
    } else if (s.x < 1920 * 0.45 && s.y > 1080 * 0.3 && ![...this.pointers.values()].includes('stick')) {
      // the stick comes to the thumb
      this.pointers.set(ev.pointerId, 'stick');
      this.base = s;
      this.knob = { x: 0, y: 0 };
    } else return;
    touch.setPointerCapture(ev.pointerId);
  }

  private move(ev: PointerEvent): void {
    if (this.pointers.get(ev.pointerId) !== 'stick') return;
    const p = this.ui.toFrame('lb', ev.clientX, ev.clientY);
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

  private up(ev: PointerEvent): void {
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

  /** Whether a button is there: a skill slot's only while it holds a skill. */
  private shown(p: Pad): boolean {
    return p.name !== null || (p.cd !== null && this.skills[p.cd] != null);
  }

  /** Makes the jump button pulse for a few seconds (the quick-rise hint). */
  flashJump(ms = 3000): void {
    this.flashUntil = performance.now() + ms;
  }

  /** Lets go of everything, as if every finger lifted (the game pausing). */
  release(): void {
    this.pointers.clear();
    this.held = this.tapped = this.stickBits = 0;
    this.runTaps = [];
    this.base = { ...STICK_HOME };
    this.knob = { x: 0, y: 0 };
  }

  /** Draws the stick and the buttons with the hero's cooldowns; `keys`: the keyboard's held buttons. */
  update(s: SimState, keys: number): void {
    show(this.stickFrame, this.touch);
    show(this.padFrame, this.touch);
    if (!this.touch) return;
    const slot = s.players[0];
    const hero = slot && s.entities.find((e) => e.id === slot.hero);
    if (slot && (slot.skills !== this.skills || getLang() !== this.lang)) {
      this.skills = slot.skills;
      this.lang = getLang();
      for (const p of this.pads) {
        const id = p.name ? null : slot.skills[p.cd!];
        // on a touch screen the keys' letters mean nothing: the name alone
        setText(p.label, p.name || id ? t(p.name ?? (`skill.${id}` as Key)) : '');
      }
    }
    const at = `${this.base.x},${this.base.y},${this.knob.x},${this.knob.y}`;
    if (at !== this.stickAt) {
      this.stickAt = at;
      this.ring.style.left = `${this.base.x}px`;
      this.ring.style.top = `${this.base.y}px`;
      this.dot.style.left = `${this.base.x + this.knob.x}px`;
      this.dot.style.top = `${this.base.y + this.knob.y}px`;
    }
    const pressed = this.held | keys | this.stickBits;
    const now = performance.now();
    // the flash: on and off four times a second
    const flash = now < this.flashUntil && Math.floor(now / 250) % 2 === 0;
    for (const p of this.pads) {
      const on = this.shown(p);
      show(p.disc, on);
      show(p.label, on);
      show(p.timer, on);
      if (!on) continue;
      const left = hero && p.cd !== null ? hero.cd[p.cd] : 0;
      const id = p.name || p.cd === null ? null : this.skills[p.cd];
      const total = p.cd === null ? 1 : p.cd === DODGE.slot ? DODGE.cooldown : SKILLS[id!].cooldown;
      const ult = id === 'phantom';
      const lit = flash && p.btn === BTN.JUMP;
      const down = (pressed & p.btn) !== 0 || lit;
      // the part still cooling, swept away clockwise from the top
      const deg = left > 0 ? Math.round(360 * Math.min(1, left / total)) : 0;
      const secs = left > 0 ? (left / TICK_RATE).toFixed(left < TICK_RATE ? 1 : 0) : '';
      const look = `${secs}|${ult}|${down}|${deg}|${lit}`;
      if (look === p.look) continue;
      p.look = look;
      p.disc.style.background = left > 0 ? 'rgba(106,102,94,.78)' : ult || lit ? 'rgba(90,26,20,.78)' : 'rgba(20,19,23,.78)';
      p.disc.style.boxShadow = `0 0 0 ${down ? 7 : 3}px ${down || ult ? RED : INK}`;
      p.sweep.style.background = deg ? `conic-gradient(rgba(0,0,0,.45) 0 ${deg}deg, transparent ${deg}deg)` : '';
      setText(p.timer, secs);
      p.label.style.top = `${left > 0 ? p.y - p.r * 0.18 : p.y}px`;
    }
  }
}
