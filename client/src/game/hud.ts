import { DUNGEONS, MONSTERS, type Entity, type SimState } from '@dnf/engine';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { OnlineSession } from '../net/OnlineSession';
import type { Session } from '../net/Session';
import { Controls } from './controls';
import { VIEW_H, VIEW_W } from './layout';

// Screen-space overlay: health, a boss's health in bars across the top, the on-screen controls with the cooldowns, the room, the combo
// counter, the key help, the end-of-run banner with the server's verdict, the connection and
// the inventory. Prototype text, not yet through i18n.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold' });

/** A boss's health in bars of this much each (DNF style: the bar runs out and the next one
 * under it shows, in another colour), and the colours they cycle through, top bar first. */
const BOSS_BAR = 600;
const BAR_INK = [0xc8281e, 0xb8742a, 0x6a7a2e, 0x2e6a6a, 0x4a3a7a] as const;
/** Boss names, for the bar. */
const BOSS_NAME: Partial<Record<Entity['kind'], string>> = { chief: '黑风寨主' };

/** The server's reasons, for the player. */
const REASONS: Record<string, string> = {
  'state hash differs from the replay': '本地状态与服务器复算不一致',
  'commands stamped ahead of the clock': '指令时间超前于服务器时钟',
  'checkpoints missing': '缺少状态校验',
  'the hero fell': '主角倒下',
  'run too long': '超时',
  practice: '练习关卡',
};

const BOSS_W = 900;
const BOSS_LEFT = (VIEW_W - BOSS_W) / 2;
const BOSS_TOP = 200;

export class Hud {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly room = new Text({ text: '', style: style(34) });
  private readonly combo = new Text({ text: '', style: { ...style(84, 0xc8281e), stroke: { color: 0xf3eee2, width: 8 } } });
  private readonly banner = new Text({ text: '', style: { ...style(110), stroke: { color: 0xf3eee2, width: 10 } } });
  private readonly verdict = new Text({ text: '', style: { ...style(44), stroke: { color: 0xf3eee2, width: 6 }, align: 'center' } });
  private readonly net = new Text({ text: '', style: style(24, 0x4a4640) });
  private readonly bag = new Text({ text: '', style: { ...style(24, 0x4a4640), align: 'right' } });
  private readonly bossName = new Text({ text: '', style: { ...style(30), stroke: { color: 0xf3eee2, width: 5 } } });
  private readonly bossBars = new Text({ text: '', style: { ...style(30, 0xc8281e), stroke: { color: 0xf3eee2, width: 5 } } });
  /** Why the game is offline, when it tried to go online. */
  offlineNote = '';
  readonly controls = new Controls();
  private comboCount = 0;
  private comboTime = 0;

  constructor() {
    const help = new Text({ text: '←→↑↓ 移动（双击奔跑）  X 攻击（按住连打）  C 跳  Z 闪避  A S D 技能  F 大招  R 重开  F1 判定框', style: style(22, 0x4a4640) });
    help.position.set(40, 124);
    this.room.position.set(VIEW_W - 40, 36);
    this.room.anchor.set(1, 0);
    this.combo.anchor.set(1, 0);
    this.combo.position.set(VIEW_W - 40, 90);
    this.banner.anchor.set(0.5);
    this.banner.position.set(VIEW_W / 2, VIEW_H * 0.36);
    this.verdict.anchor.set(0.5, 0);
    this.verdict.position.set(VIEW_W / 2, VIEW_H * 0.36 + 80);
    this.net.position.set(40, 84);
    this.bag.anchor.set(1, 0);
    this.bag.position.set(VIEW_W - 40, 200);
    this.bossName.position.set(BOSS_LEFT, BOSS_TOP - 40);
    this.bossBars.anchor.set(1, 0);
    this.bossBars.position.set(BOSS_LEFT + BOSS_W, BOSS_TOP - 40);
    this.layer.addChild(this.g, this.controls.layer, this.room, this.combo, this.banner, this.verdict, this.net, this.bag, help, this.bossName, this.bossBars);
  }

  /** A hit by the hero: grows the combo, which lapses after 1.2 s without a hit. */
  heroHit(): void {
    this.comboCount++;
    this.comboTime = 1.2;
  }

  /** `keys`: the keyboard's held buttons, lit on the controls too. */
  update(s: SimState, dt: number, session: Session, keys: number): void {
    const hero = s.entities.find((e) => e.team === 0);
    const g = this.g.clear();
    if (hero) {
      g.rect(40, 40, 520, 30).fill({ color: 0x000000, alpha: 0.25 });
      g.rect(40, 40, (520 * Math.max(0, hero.hp)) / hero.maxHp, 30).fill(0xc8281e);
      g.rect(40, 40, 520, 30).stroke({ width: 3, color: 0x141317 });
    }
    this.boss(g, s);
    this.controls.update(s, keys);
    const dungeon = DUNGEONS[s.config.dungeon];
    const open = s.roomCleared && s.room !== dungeon.boss ? '   → 前进' : '';
    this.room.text = s.config.dungeon === 'training' ? '训练场' : `房间 ${s.room + 1} / ${dungeon.rooms.length}${open}`;
    this.comboTime -= dt;
    if (this.comboTime <= 0) this.comboCount = 0;
    this.combo.text = this.comboCount >= 2 ? `${this.comboCount} 连击` : '';
    this.banner.text = s.outcome === 'cleared' ? '通关' : s.outcome === 'failed' ? '败北' : '';
    this.net.text = session.status() || this.offlineNote;
    if (session instanceof OnlineSession) this.online(session, s);
    else this.verdict.text = this.bag.text = '';
  }

  /** The boss's bars, while one is in the room: the top bar over the one under it, the count of
   * bars left, its name. */
  private boss(g: Graphics, s: SimState): void {
    const b = s.entities.find((e) => e.kind !== 'hero' && MONSTERS[e.kind].boss);
    this.bossName.text = this.bossBars.text = '';
    if (!b) return;
    const hp = Math.max(0, b.hp);
    const bars = Math.ceil(b.maxHp / BOSS_BAR);
    const left = Math.ceil(hp / BOSS_BAR);
    const inTop = hp - (left - 1) * BOSS_BAR;
    const ink = (i: number) => BAR_INK[(bars - i) % BAR_INK.length];
    g.rect(BOSS_LEFT, BOSS_TOP, BOSS_W, 26).fill({ color: 0x000000, alpha: 0.3 });
    if (left > 1) g.rect(BOSS_LEFT, BOSS_TOP, BOSS_W, 26).fill(ink(left - 1));
    if (left > 0) g.rect(BOSS_LEFT, BOSS_TOP, (BOSS_W * inTop) / BOSS_BAR, 26).fill(ink(left));
    g.rect(BOSS_LEFT, BOSS_TOP, BOSS_W, 26).stroke({ width: 3, color: 0x141317 });
    this.bossName.text = BOSS_NAME[b.kind] ?? '';
    this.bossBars.text = left > 1 ? `×${left}` : '';
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
