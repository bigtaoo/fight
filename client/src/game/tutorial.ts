import { MONSTERS, TICK_RATE, fromFp, type DungeonId, type SimState } from '@dnf/engine';
import { FONT, INK, PAPER, RED, el, type Overlay } from './dom';
import { keyName, t, type Key } from '../i18n';
import type { View3D } from '../three/view';

// The advice, written on the scroll itself: when something new turns up (in 1-1, one lesson a
// room; in Black Wind Fort, an archer drawing, a shield bearer, the chief), a line of brush
// calligraphy is pinned to the paper a little ahead of the hero, inked in a character at a time,
// and soaks away again. Chinese runs top to bottom, other languages across; a key is a small
// cinnabar seal in the line. Read only from the state the client already draws; nothing here
// touches the simulation.

/** Characters inked a second, how long a line stays once written, and how long it soaks away. */
const PACE = 14;
const HOLD = 4.5;
const FADE = 1.2;
/** How long a newer line waits behind one being shown, at least (seconds). */
const MIN = 2.5;

interface Tip {
  id: Key;
  when: (s: SimState) => boolean;
  /** Pushes the line before it out at once: the warning that is only worth anything now. */
  urgent?: boolean;
}

const hero = (s: SimState) => s.entities.find((e) => e.team === 0);
const foes = (s: SimState) => s.entities.filter((e) => e.team !== 0 && e.hp > 0);
const phase2 = (s: SimState, kind: 'chief' | 'woodcutter') => foes(s).some((e) => e.kind === kind && e.hp <= e.maxHp * (MONSTERS[kind].boss!.phase2Pct / 100));

const TIPS: Partial<Record<DungeonId, readonly Tip[]>> = {
  // 1-1, one thing a room (design/CHAPTER1.md)
  luobi: [
    { id: 'tip.ink.move', when: (s) => s.room === 0 && s.tick > TICK_RATE / 2 },
    { id: 'tip.ink.jump', when: (s) => s.room === 0 && s.tick > 4 * TICK_RATE },
    { id: 'tip.ink.attack', when: (s) => s.room === 1 },
    { id: 'tip.ink.combo', when: (s) => s.room === 1 && (s.players[0]?.combo ?? 0) >= 2 },
    { id: 'tip.ink.onward', when: (s) => s.room === 1 && s.roomCleared },
    { id: 'tip.ink.dodge', when: (s) => foes(s).some((e) => e.kind === 'brute' && e.move === 'smash'), urgent: true },
    { id: 'tip.ink.potion', when: (s) => s.room === 2 && s.items.length > 0 },
    { id: 'tip.ink.skill', when: (s) => s.room === 3 },
    { id: 'tip.ink.roar', when: (s) => phase2(s, 'woodcutter') },
  ],
  // 1-2, the river village: each new foe gets its line as it first shows its trick
  jiangcun: [
    { id: 'tip.jc.lurk', when: (s) => s.room === 0 && s.tick > TICK_RATE },
    { id: 'tip.jc.hook', when: (s) => (hero(s)?.tow ?? 0) > 0, urgent: true },
    { id: 'tip.jc.lob', when: (s) => s.lobs.length > 0 || s.patches.length > 0, urgent: true },
    { id: 'tip.jc.screen', when: (s) => s.room === 4 },
  ],
  // 1-3, inside the screen
  pingfeng: [
    { id: 'tip.pf.branch', when: (s) => s.room === 0 && s.tick > TICK_RATE },
    { id: 'tip.pf.perch', when: (s) => s.room === 1 && foes(s).some((e) => e.lurk < 0) && foes(s).filter((e) => e.lurk === 0).length === 0 },
    { id: 'tip.pf.rock', when: (s) => s.room === 2 && s.items.length > 0 },
    { id: 'tip.pf.tail', when: (s) => foes(s).some((e) => e.kind === 'pheasant' && e.move.startsWith('tail')), urgent: true },
    { id: 'tip.pf.fan', when: (s) => s.shots.some((sh) => sh.kind === 'feather'), urgent: true },
  ],
  heifeng: [
    { id: 'tip.move', when: (s) => s.room === 0 },
    { id: 'tip.jump', when: (s) => s.room === 0 && s.tick > 7 * TICK_RATE },
    { id: 'tip.arrow', when: (s) => foes(s).some((e) => e.kind === 'archer' && e.move === 'shoot'), urgent: true },
    {
      id: 'tip.hurt',
      when: (s) => {
        const h = hero(s);
        return !!h && h.hp < h.maxHp * 0.75;
      },
    },
    { id: 'tip.potion', when: (s) => s.items.length > 0 },
    { id: 'tip.door', when: (s) => s.room === 0 && s.roomCleared },
    { id: 'tip.shield', when: (s) => foes(s).some((e) => e.kind === 'shield') },
    { id: 'tip.side', when: (s) => s.room === 2 && s.roomCleared },
    { id: 'tip.chief', when: (s) => foes(s).some((e) => e.kind === 'chief') },
    { id: 'tip.roar', when: (s) => phase2(s, 'chief') },
  ],
};

/** Chinese is written in a brush hand; a Latin line in the UI's own face (the Kai faces' Latin
 * letters are fixed-width and read as a typewriter's). */
const BRUSH = '"STXingkai", "华文行楷", "Xingkai SC", "KaiTi", "STKaiti", "Kaiti SC", serif';
/** Where a line is written: this far ahead of the hero, this high on the paper, at the back. */
const AHEAD = 420;
const HEIGHT = 470;
/** Marks a key's name in the filled-in text, so it can be cut out as a seal. */
const SEAL = /\u0001([^\u0002]*)\u0002/g;

/** The touch button each key stands for, by the button's own name. */
const PADS: Record<string, Key> = { KeyX: 'pad.attack', KeyC: 'pad.jump', KeyZ: 'pad.dodge', Arrows: 'pad.stick' };

/** A line's touch-screen wording, for the lines that name keys a touch screen has no button for. */
const TOUCH_TEXT: Partial<Record<Key, Key>> = {
  'tip.move': 'tip.move.touch',
  'tip.hurt': 'tip.hurt.touch',
  'tip.arrow': 'tip.arrow.touch',
  'tip.shield': 'tip.shield.touch',
  'tip.ink.skill': 'tip.ink.skill.touch',
};

/** The key placeholders' values, wrapped in seal marks: the keyboard's keys, or on a touch screen
 * the names of the buttons (and the stick) under the player's thumbs. */
function sealVars(touch: boolean): Record<string, string> {
  const vars: Record<string, string> = { Arrows: '\u0001←→↑↓\u0002' };
  for (let c = 65; c <= 90; c++) {
    const code = `Key${String.fromCharCode(c)}`;
    vars[code] = `\u0001${keyName(code)}\u0002`;
  }
  if (touch) for (const [code, name] of Object.entries(PADS)) vars[code] = `\u0001${t(name)}\u0002`;
  return vars;
}

interface Line {
  id: Key;
  div: HTMLDivElement;
  /** The characters (and seals) in the order they are inked. */
  marks: HTMLSpanElement[];
  inked: number;
  /** Where it is pinned (engine units: along, height, depth). */
  x: number;
  height: number;
  depth: number;
  /** Seconds since it was started, and since it was written in full; its look last set. */
  age: number;
  done: number;
  look: string;
}

export class Tutorial {
  /** Off with ?notutorial. */
  on = true;
  /** Whether the touch controls show: the lines then name the buttons, not the keys. */
  touch = false;
  private readonly layer: HTMLDivElement;
  private seen = new Set<string>();
  private queue: Tip[] = [];
  private line: Line | null = null;
  private lastTick = 0;

  constructor(private readonly ui: Overlay) {
    this.layer = ui.layer();
  }

  /** Looks for new advice in `s` and moves the line on `dt` seconds, placed through `view`. */
  update(s: SimState, view: View3D, dt: number): void {
    // a restart (R) starts the advice over
    if (s.tick + TICK_RATE < this.lastTick) this.reset();
    this.lastTick = s.tick;
    const tips = TIPS[s.config.dungeon];
    if (!this.on || !tips || s.outcome !== 'playing') {
      this.drop();
      return;
    }
    for (const tip of tips) {
      if (!this.seen.has(tip.id) && tip.when(s)) {
        this.seen.add(tip.id);
        if (tip.urgent) this.queue.unshift(tip);
        else this.queue.push(tip);
      }
    }
    const line = this.line;
    const next = this.queue[0];
    // nothing new is written while one of 1-1's beats is being shown
    if (next && !view.cutscene && (!line || line.age >= MIN || next.urgent)) {
      this.queue.shift();
      this.write(next, s);
    }
    if (this.line) this.move(this.line, view, dt);
  }

  /** Starts writing `tip`'s line ahead of the hero (or in the middle of the room without one). */
  private write(tip: Tip, s: SimState): void {
    this.drop();
    const h = hero(s);
    const roomW = fromFp(s.roomWidth);
    const x = h ? Math.max(300, Math.min(roomW - 300, fromFp(h.x) + AHEAD * h.facing)) : roomW / 2;
    // looked up now: the language can change in the pause menu, but a line once written stays
    const text = t((this.touch && TOUCH_TEXT[tip.id]) || tip.id, sealVars(this.touch));
    const tall = /[一-鿿]/.test(text);
    const div = el(
      'div',
      `position:absolute;left:0;top:0;font:${tall ? `400 64px/1.25 ${BRUSH}` : `bold 56px/1.25 ${FONT}`};color:${INK};white-space:pre-wrap;` +
        `${tall ? 'writing-mode:vertical-rl;max-height:640px;' : 'width:900px;text-align:center;'}` +
        `text-shadow:0 0 2px ${PAPER},0 0 10px ${PAPER};will-change:transform,opacity`,
      this.layer,
    );
    const marks: HTMLSpanElement[] = [];
    const hidden = 'opacity:0;filter:blur(7px);transition:opacity .35s,filter .6s';
    let at = 0;
    const chars = (part: string) => {
      for (const ch of part) {
        const sp = el('span', /\s/.test(ch) ? '' : hidden, div, ch);
        if (!/\s/.test(ch)) marks.push(sp);
      }
    };
    for (const m of text.matchAll(SEAL)) {
      chars(text.slice(at, m.index));
      // a seal: a red square, the key's name in paper colour, upright in a vertical line
      const seal = el(
        'span',
        `${hidden};display:inline-block;margin:6px 4px;padding:2px 8px;background:${RED};color:${PAPER};border-radius:6px;` +
          `font:bold 40px/1.2 Georgia,serif;text-shadow:none;text-combine-upright:all;writing-mode:horizontal-tb`,
        div,
        m[1],
      );
      marks.push(seal);
      at = m.index! + m[0].length;
    }
    chars(text.slice(at));
    this.line = { id: tip.id, div, marks, inked: 0, x, height: HEIGHT, depth: 0, age: 0, done: -1, look: '' };
  }

  private move(line: Line, view: View3D, dt: number): void {
    line.age += dt;
    const want = Math.min(line.marks.length, Math.floor(line.age * PACE));
    while (line.inked < want) {
      const sp = line.marks[line.inked++];
      sp.style.opacity = '1';
      sp.style.filter = 'none';
    }
    if (line.inked === line.marks.length && line.done < 0) line.done = line.age;
    const fade = line.done < 0 ? 0 : (line.age - line.done - HOLD) / FADE;
    if (fade >= 1) {
      this.drop();
      return;
    }
    const p = view.project(line.x, line.height, line.depth);
    const k = this.ui.k;
    line.div.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,0) scale(${k.toFixed(3)})`;
    line.div.style.transformOrigin = '50% 0';
    // soaking away: paler and blurred, as ink spreading into the paper
    const look = `${fade > 0 ? fade.toFixed(2) : '0'}${p.behind}`;
    if (look !== line.look) {
      line.look = look;
      line.div.style.opacity = String(1 - fade);
      line.div.style.filter = fade > 0 ? `blur(${(fade * 6).toFixed(1)}px)` : '';
      line.div.style.display = p.behind ? 'none' : '';
    }
  }

  private drop(): void {
    this.line?.div.remove();
    this.line = null;
  }

  private reset(): void {
    this.seen.clear();
    this.queue = [];
    this.drop();
  }
}
