import { DUNGEONS, MOVES, SKILLS, type SimState } from '@dnf/engine';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { VIEW_H, VIEW_W } from './layout';

// Screen-space overlay: health, the two skills with their cooldowns, the room, the combo
// counter, the key help and the end-of-run banner. Prototype text, not yet through i18n.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold' });

export class Hud {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly room = new Text({ text: '', style: style(34) });
  private readonly combo = new Text({ text: '', style: { ...style(84, 0xc8281e), stroke: { color: 0xf3eee2, width: 8 } } });
  private readonly banner = new Text({ text: '', style: { ...style(110), stroke: { color: 0xf3eee2, width: 10 } } });
  private readonly skillLabels = SKILLS.map((_, i) => new Text({ text: ['A 上挑', 'S 突进'][i], style: style(26) }));
  private comboCount = 0;
  private comboTime = 0;

  constructor() {
    const help = new Text({ text: '←→↑↓ 移动（双击奔跑）   X 攻击（按住连打）   C 跳跃   A 上挑   S 突进   R 重开   F1 判定框', style: style(24, 0x4a4640) });
    help.position.set(40, VIEW_H - 46);
    this.room.position.set(VIEW_W - 40, 36);
    this.room.anchor.set(1, 0);
    this.combo.anchor.set(1, 0);
    this.combo.position.set(VIEW_W - 40, 90);
    this.banner.anchor.set(0.5);
    this.banner.position.set(VIEW_W / 2, VIEW_H * 0.36);
    this.skillLabels.forEach((t, i) => t.position.set(40 + i * 130, VIEW_H - 196));
    this.layer.addChild(this.g, this.room, this.combo, this.banner, help, ...this.skillLabels);
  }

  /** A hit by the hero: grows the combo, which lapses after 1.2 s without a hit. */
  heroHit(): void {
    this.comboCount++;
    this.comboTime = 1.2;
  }

  update(s: SimState, dt: number): void {
    const hero = s.entities.find((e) => e.team === 0);
    const g = this.g.clear();
    if (hero) {
      g.rect(40, 40, 520, 30).fill({ color: 0x000000, alpha: 0.25 });
      g.rect(40, 40, (520 * Math.max(0, hero.hp)) / hero.maxHp, 30).fill(0xc8281e);
      g.rect(40, 40, 520, 30).stroke({ width: 3, color: 0x141317 });
      SKILLS.forEach((id, i) => {
        const x = 40 + i * 130;
        const y = VIEW_H - 160;
        const cd = hero.cd[i];
        const total = MOVES[id].cooldown ?? 1;
        g.rect(x, y, 100, 100).fill(cd > 0 ? 0x8a857a : 0x141317);
        if (cd > 0) g.rect(x, y, 100, (100 * cd) / total).fill({ color: 0x000000, alpha: 0.45 });
        g.rect(x, y, 100, 100).stroke({ width: 3, color: 0x141317 });
      });
    }
    const rooms = DUNGEONS[s.config.dungeon].length;
    this.room.text = s.config.dungeon === 'training' ? '训练场' : `房间 ${s.room + 1} / ${rooms}${s.roomCleared && s.room < rooms - 1 ? '   → 前进' : ''}`;
    this.comboTime -= dt;
    if (this.comboTime <= 0) this.comboCount = 0;
    this.combo.text = this.comboCount >= 2 ? `${this.comboCount} 连击` : '';
    this.banner.text = s.outcome === 'cleared' ? '通关' : s.outcome === 'failed' ? '败北' : '';
  }
}
