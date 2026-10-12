import { DUNGEONS, MONSTERS, type Dungeon, type Entity, type SimState } from '@dnf/engine';
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

/** The minimap's room cells, the gap between them (where the doors' links are), and its
 * top-right corner. */
const CELL_W = 56;
const CELL_H = 36;
const CELL_GAP = 20;
const MAP_RIGHT = VIEW_W - 40;
const MAP_TOP = 36;
const STEP: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** Grid cells for a dungeon's rooms, walked out from room 0 along the doors (a left door leads
 * one cell left, an up door one cell up), shifted so the top-left one is at 0, 0. */
function layout(d: Dungeon): [number, number][] {
  const at: ([number, number] | undefined)[] = d.rooms.map(() => undefined);
  at[0] = [0, 0];
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    const [x, y] = at[i]!;
    for (const door of d.rooms[i].doors) {
      if (at[door.to]) continue;
      const [dx, dy] = STEP[door.side];
      at[door.to] = [x + dx, y + dy];
      queue.push(door.to);
    }
  }
  const cells = at.map((c) => c ?? [0, 0]);
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

const BOSS_W = 900;
const BOSS_LEFT = (VIEW_W - BOSS_W) / 2;
const BOSS_TOP = 200;

export class Hud {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly room = new Text({ text: '', style: style(34) });
  private readonly map = new Graphics();
  private readonly bossMark = new Text({ text: '王', style: style(24, 0xf3eee2) });
  private cells: { dungeon: string; at: [number, number][] } | null = null;
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
    this.room.anchor.set(1, 0);
    this.bossMark.anchor.set(0.5);
    this.combo.anchor.set(1, 0);
    this.combo.position.set(VIEW_W - 40, 190);
    this.banner.anchor.set(0.5);
    this.banner.position.set(VIEW_W / 2, VIEW_H * 0.36);
    this.verdict.anchor.set(0.5, 0);
    this.verdict.position.set(VIEW_W / 2, VIEW_H * 0.36 + 80);
    this.net.position.set(40, 84);
    this.bag.anchor.set(1, 0);
    this.bag.position.set(VIEW_W - 40, 290);
    this.bossName.position.set(BOSS_LEFT, BOSS_TOP - 40);
    this.bossBars.anchor.set(1, 0);
    this.bossBars.position.set(BOSS_LEFT + BOSS_W, BOSS_TOP - 40);
    this.layer.addChild(this.g, this.controls.layer, this.map, this.bossMark, this.room, this.combo, this.banner, this.verdict, this.net, this.bag, help, this.bossName, this.bossBars);
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
    this.minimap(s);
    this.comboTime -= dt;
    if (this.comboTime <= 0) this.comboCount = 0;
    this.combo.text = this.comboCount >= 2 ? `${this.comboCount} 连击` : '';
    this.banner.text = s.outcome === 'cleared' ? '通关' : s.outcome === 'failed' ? '败北' : '';
    this.net.text = session.status() || this.offlineNote;
    if (session instanceof OnlineSession) this.online(session, s);
    else this.verdict.text = this.bag.text = '';
  }

  /** The rooms been in (the ones cleared and this one), the rooms their doors lead to as
   * outlines, the boss's room marked from the start, and where the heroes are; under it, a
   * pointer onward once this room is clear. */
  private minimap(s: SimState): void {
    const m = this.map.clear();
    this.bossMark.visible = false;
    const dungeon = DUNGEONS[s.config.dungeon];
    if (s.config.dungeon === 'training' || s.room < 0) {
      this.room.text = s.config.dungeon === 'training' ? '训练场' : '';
      this.room.position.set(MAP_RIGHT, MAP_TOP);
      return;
    }
    if (this.cells?.dungeon !== s.config.dungeon) this.cells = { dungeon: s.config.dungeon, at: layout(dungeon) };
    const at = this.cells.at;
    const cols = Math.max(...at.map((c) => c[0])) + 1;
    const rows = Math.max(...at.map((c) => c[1])) + 1;
    const left = MAP_RIGHT - cols * CELL_W - (cols - 1) * CELL_GAP;
    const pos = (i: number) => ({ x: left + at[i][0] * (CELL_W + CELL_GAP), y: MAP_TOP + at[i][1] * (CELL_H + CELL_GAP) });
    const been = new Set([...s.cleared, s.room]);
    const known = new Set(been);
    for (const i of been) for (const d of dungeon.rooms[i].doors) known.add(d.to);
    known.add(dungeon.boss);
    m.roundRect(left - 10, MAP_TOP - 10, MAP_RIGHT - left + 20, rows * CELL_H + (rows - 1) * CELL_GAP + 20, 8).fill({ color: 0xf3eee2, alpha: 0.6 });
    // the links between rooms, once one end has been visited
    for (const i of been) {
      const a = pos(i);
      for (const d of dungeon.rooms[i].doors) {
        const b = pos(d.to);
        m.moveTo(a.x + CELL_W / 2, a.y + CELL_H / 2).lineTo(b.x + CELL_W / 2, b.y + CELL_H / 2).stroke({ width: 5, color: 0x4a4640 });
      }
    }
    for (const i of known) {
      const { x, y } = pos(i);
      const here = i === s.room;
      if (been.has(i)) m.rect(x, y, CELL_W, CELL_H).fill(here ? 0xc8281e : 0x6f6a60);
      else m.rect(x, y, CELL_W, CELL_H).fill(0xe6dfcf);
      m.rect(x, y, CELL_W, CELL_H).stroke({ width: 3, color: 0x141317 });
      if (i === dungeon.boss && !here) {
        this.bossMark.visible = true;
        this.bossMark.style.fill = been.has(i) ? 0xf3eee2 : 0xc8281e;
        this.bossMark.position.set(x + CELL_W / 2, y + CELL_H / 2);
      }
    }
    this.room.text = s.roomCleared && s.room !== dungeon.boss ? '→ 前进' : '';
    this.room.position.set(MAP_RIGHT, MAP_TOP + rows * CELL_H + (rows - 1) * CELL_GAP + 18);
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
