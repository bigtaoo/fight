import { MONSTERS, TICK_RATE, type SimState } from '@dnf/engine';
import { FONT, INK, el, halo, setText } from './dom';
import { t, type Key } from '../i18n';

// Black Wind Fort doubles as the tutorial: a line of advice at the top of the screen when
// something new turns up (the first room, an archer drawing, a shield bearer, a potion on the
// floor, the side room's door, the chief), each once a run. Read only from the state the client
// already draws; nothing here touches the simulation.

/** How long a tip stays up, and how long a newer one waits behind it at least. */
const SHOW = 6 * TICK_RATE;
const MIN = 3 * TICK_RATE;

interface Tip {
  id: Key;
  when: (s: SimState) => boolean;
}

const hero = (s: SimState) => s.entities.find((e) => e.team === 0);
const foes = (s: SimState) => s.entities.filter((e) => e.team !== 0 && e.hp > 0);

const TIPS: readonly Tip[] = [
  { id: 'tip.move', when: (s) => s.room === 0 },
  { id: 'tip.jump', when: (s) => s.room === 0 && s.tick > 7 * TICK_RATE },
  { id: 'tip.arrow', when: (s) => foes(s).some((e) => e.kind === 'archer' && e.move === 'shoot') },
  {
    id: 'tip.hurt',
    when: (s) => {
      const h = hero(s);
      return !!h && h.hp < h.maxHp * 0.75;
    },
  },
  { id: 'tip.potion', when: (s) => s.items.length > 0 },
  { id: 'tip.door', when: (s) => s.room === 0 && s.roomCleared },
  {
    id: 'tip.shield',
    when: (s) => foes(s).some((e) => e.kind === 'shield'),
  },
  { id: 'tip.side', when: (s) => s.room === 2 && s.roomCleared },
  {
    id: 'tip.chief',
    when: (s) => foes(s).some((e) => e.kind === 'chief'),
  },
  { id: 'tip.roar', when: (s) => foes(s).some((e) => e.kind === 'chief' && e.hp <= e.maxHp * (MONSTERS.chief.boss!.phase2Pct / 100)) },
];

export class Tutorial {
  private readonly text: HTMLDivElement;
  private alpha = '';
  private seen = new Set<string>();
  private queue: Key[] = [];
  private showing: Key | null = null;
  private shownAt = -1;
  private lastTick = 0;

  /** `parent`: the frame pinned at the top's middle. */
  constructor(
    private readonly on: boolean,
    parent: HTMLElement,
  ) {
    this.text = el(
      'div',
      `position:absolute;left:960px;top:200px;width:1152px;margin-left:-576px;text-align:center;font:bold 40px ${FONT};color:${INK};text-shadow:${halo(4)}`,
      parent,
    );
  }

  update(s: SimState): void {
    // a restart (R) starts the tips over
    if (s.tick + TICK_RATE < this.lastTick) this.reset();
    this.lastTick = s.tick;
    if (!this.on || s.config.dungeon !== 'heifeng' || s.outcome !== 'playing') {
      setText(this.text, '');
      return;
    }
    for (const tip of TIPS) {
      if (!this.seen.has(tip.id) && tip.when(s)) {
        this.seen.add(tip.id);
        this.queue.push(tip.id);
      }
    }
    const age = s.tick - this.shownAt;
    const showing = this.showing !== null && age < SHOW;
    if (this.queue.length > 0 && (!showing || age >= MIN)) {
      this.showing = this.queue.shift()!;
      this.shownAt = s.tick;
    } else if (!showing) this.showing = null;
    // looked up each frame: the language can change in the pause menu
    setText(this.text, this.showing ? t(this.showing) : '');
    // fade out over the last second
    const alpha = Math.max(0, Math.min(1, (SHOW - (s.tick - this.shownAt)) / TICK_RATE)).toFixed(2);
    if (alpha !== this.alpha) this.text.style.opacity = this.alpha = alpha;
  }

  private reset(): void {
    this.seen.clear();
    this.queue = [];
    this.shownAt = -1;
    this.showing = null;
    setText(this.text, '');
  }
}
