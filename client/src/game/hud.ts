import { DUNGEONS, MOVES, SKILLS, type SimState } from '@dnf/engine';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { OnlineSession } from '../net/OnlineSession';
import type { Session } from '../net/Session';
import { VIEW_H, VIEW_W } from './layout';

// Screen-space overlay: health, the two skills with their cooldowns, the room, the combo
// counter, the key help, the end-of-run banner with the server's verdict, the connection and
// the inventory. Prototype text, not yet through i18n.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold' });

/** The server's reasons, for the player. */
const REASONS: Record<string, string> = {
  'state hash differs from the replay': '本地状态与服务器复算不一致',
  'commands stamped ahead of the clock': '指令时间超前于服务器时钟',
  'checkpoints missing': '缺少状态校验',
  'the hero fell': '主角倒下',
  'run too long': '超时',
};

export class Hud {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly room = new Text({ text: '', style: style(34) });
  private readonly combo = new Text({ text: '', style: { ...style(84, 0xc8281e), stroke: { color: 0xf3eee2, width: 8 } } });
  private readonly banner = new Text({ text: '', style: { ...style(110), stroke: { color: 0xf3eee2, width: 10 } } });
  private readonly verdict = new Text({ text: '', style: { ...style(44), stroke: { color: 0xf3eee2, width: 6 }, align: 'center' } });
  private readonly net = new Text({ text: '', style: style(24, 0x4a4640) });
  private readonly bag = new Text({ text: '', style: { ...style(24, 0x4a4640), align: 'right' } });
  /** Why the game is offline, when it tried to go online. */
  offlineNote = '';
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
    this.verdict.anchor.set(0.5, 0);
    this.verdict.position.set(VIEW_W / 2, VIEW_H * 0.36 + 80);
    this.net.position.set(40, 84);
    this.bag.anchor.set(1, 1);
    this.bag.position.set(VIEW_W - 40, VIEW_H - 46);
    this.skillLabels.forEach((t, i) => t.position.set(40 + i * 130, VIEW_H - 196));
    this.layer.addChild(this.g, this.room, this.combo, this.banner, this.verdict, this.net, this.bag, help, ...this.skillLabels);
  }

  /** A hit by the hero: grows the combo, which lapses after 1.2 s without a hit. */
  heroHit(): void {
    this.comboCount++;
    this.comboTime = 1.2;
  }

  update(s: SimState, dt: number, session: Session): void {
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
    this.net.text = session.status() || this.offlineNote;
    if (session instanceof OnlineSession) this.online(session, s);
    else this.verdict.text = this.bag.text = '';
  }

  private online(session: OnlineSession, s: SimState): void {
    const r = session.result;
    const why = (reason: string) => REASONS[reason] ?? reason;
    if (session.flag) this.verdict.text = `服务器判定：${why(session.flag.reason)}（第 ${session.flag.tick} 帧）\n本局无掉落`;
    else if (r?.ok) this.verdict.text = `获得  ${r.loot.name}${r.settleMs !== null ? `\n服务器结算 ${Math.round(r.settleMs)}ms` : ''}`;
    else if (r) this.verdict.text = `本局无掉落：${why(r.reason)}`;
    else this.verdict.text = s.outcome === 'cleared' ? '等待服务器复算…' : '';
    const items = session.inventory;
    this.bag.text = items.length ? `背包（${items.length}）\n${items.slice(-6).map((i) => i.name).join('\n')}` : '';
  }
}
