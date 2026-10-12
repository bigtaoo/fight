import { MONSTERS, TICK_RATE, type SimState } from '@dnf/engine';
import { Text } from 'pixi.js';
import { VIEW_W } from './layout';

// Black Wind Fort doubles as the tutorial: a line of advice at the top of the screen when
// something new turns up (the first room, an archer drawing, a shield bearer, a potion on the
// floor, the side room's door, the chief), each once a run. Read only from the state the client
// already draws; nothing here touches the simulation. Prototype text, not yet through i18n.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
/** How long a tip stays up, and how long a newer one waits behind it at least. */
const SHOW = 6 * TICK_RATE;
const MIN = 3 * TICK_RATE;

interface Tip {
  id: string;
  text: string;
  when: (s: SimState) => boolean;
}

const hero = (s: SimState) => s.entities.find((e) => e.team === 0);
const foes = (s: SimState) => s.entities.filter((e) => e.team !== 0 && e.hp > 0);

const TIPS: readonly Tip[] = [
  { id: 'move', text: '新手引导：←→↑↓ 走动（双击奔跑），X 攻击，按住一直连打', when: (s) => s.room === 0 },
  { id: 'jump', text: 'C 跳起来能躲开低处的攻击；在空中按 X 是跳劈', when: (s) => s.room === 0 && s.tick > 7 * TICK_RATE },
  { id: 'arrow', text: '弓箭手在拉弓：按 ↑ 或 ↓ 换一条线，箭就射不中你', when: (s) => foes(s).some((e) => e.kind === 'archer' && e.move === 'shoot') },
  {
    id: 'hurt',
    text: 'Z 闪避向后跳开，起跳瞬间打不中；A S D 是技能，F 是大招',
    when: (s) => {
      const h = hero(s);
      return !!h && h.hp < h.maxHp * 0.75;
    },
  },
  { id: 'potion', text: '地上的药水：走过去就会喝掉，回一些血', when: (s) => s.items.length > 0 },
  { id: 'door', text: '这间清空了：走进亮着的门，去下一间', when: (s) => s.room === 0 && s.roomCleared },
  {
    id: 'shield',
    text: '盾兵正面挡得住：绕到他背后，或等他慢慢转身的时候打；S 键的技能（上挑、破军）能破防',
    when: (s) => foes(s).some((e) => e.kind === 'shield'),
  },
  { id: 'side', text: '下面的门通往侧室，里面有个精英，打赢必掉大药水；也可以不去', when: (s) => s.room === 2 && s.roomCleared },
  {
    id: 'chief',
    text: '寨主出招时不会被打断：先躲开，等他收招的空隙再打；他跳起来砸地时，你也跳起来躲冲击波',
    when: (s) => foes(s).some((e) => e.kind === 'chief'),
  },
  { id: 'roar', text: '寨主怒了：出招更快，还叫来了帮手', when: (s) => foes(s).some((e) => e.kind === 'chief' && e.hp <= e.maxHp * (MONSTERS.chief.boss!.phase2Pct / 100)) },
];

export class Tutorial {
  readonly text = new Text({
    text: '',
    style: { fontFamily: FONT, fontSize: 40, fill: 0x141317, fontWeight: 'bold', stroke: { color: 0xf3eee2, width: 8 }, align: 'center', wordWrap: true, wordWrapWidth: VIEW_W * 0.6 },
  });
  private seen = new Set<string>();
  private queue: string[] = [];
  private shownAt = -1;
  private lastTick = 0;

  constructor(private readonly on: boolean) {
    this.text.anchor.set(0.5, 0);
    this.text.position.set(VIEW_W / 2, 200);
  }

  update(s: SimState): void {
    // a restart (R) starts the tips over
    if (s.tick + TICK_RATE < this.lastTick) this.reset();
    this.lastTick = s.tick;
    if (!this.on || s.config.dungeon !== 'heifeng' || s.outcome !== 'playing') {
      this.text.text = '';
      return;
    }
    for (const t of TIPS) {
      if (!this.seen.has(t.id) && t.when(s)) {
        this.seen.add(t.id);
        this.queue.push(t.text);
      }
    }
    const age = s.tick - this.shownAt;
    const showing = this.text.text !== '' && age < SHOW;
    if (this.queue.length > 0 && (!showing || age >= MIN)) {
      this.text.text = this.queue.shift()!;
      this.shownAt = s.tick;
    } else if (!showing) this.text.text = '';
    // fade out over the last second
    this.text.alpha = Math.min(1, (SHOW - (s.tick - this.shownAt)) / TICK_RATE);
  }

  private reset(): void {
    this.seen.clear();
    this.queue = [];
    this.shownAt = -1;
    this.text.text = '';
  }
}
