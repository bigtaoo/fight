import { DUNGEONS, MONSTERS, TICK_RATE, rateRun, type Dungeon, type Entity, type Rating, type SimState } from '@dnf/engine';
import { PAUSE_SIZE } from './menu';
import type { Best } from './progress';
import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { OnlineSession } from '../net/OnlineSession';
import { OfflineSession, type Session } from '../net/Session';
import type { Item } from '@dnf/server/protocol';
import { Controls } from './controls';
import { Tutorial } from './tutorial';
import { VIEW_H, VIEW_W } from './layout';
import { MAX_LEVEL, RARITY_INK, gearNameKey } from '../rpg/gear';
import { xpToNext } from '../rpg/character';
import { getLang, t, tOr, type Key } from '../i18n';
import { tierName } from '../rpg/tiers';

// Screen-space overlay: health, a boss's health in bars across the top, the on-screen controls with the cooldowns, the room, the combo
// counter, the key help, the end-of-run banner with the server's verdict, the connection and
// the inventory. The text is looked up each frame, so a language switch shows at once.

const FONT = 'Georgia, "Songti SC", "SimSun", serif';
const style = (size: number, fill = 0x141317): TextStyleOptions => ({ fontFamily: FONT, fontSize: size, fill, fontWeight: 'bold' });

/** A boss's health in bars of this much each (DNF style: the bar runs out and the next one
 * under it shows, in another colour), and the colours they cycle through, top bar first. */
const BOSS_BAR = 600;
const BAR_INK = [0xc8281e, 0xb8742a, 0x6a7a2e, 0x2e6a6a, 0x4a3a7a] as const;
/** Boss names, for the bar. */
const BOSS_NAME: Partial<Record<Entity['kind'], Key>> = { chief: 'boss.chief' };

/** The server's reasons, for the player. */
const REASONS: Record<string, Key> = {
  'state hash differs from the replay': 'reason.hash',
  'commands stamped ahead of the clock': 'reason.ahead',
  'checkpoints missing': 'reason.checkpoints',
  'the hero fell': 'reason.fell',
  'run too long': 'reason.long',
  practice: 'reason.practice',
};

/** The minimap's room cells, the gap between them (where the doors' links are), and its
 * top-right corner. */
const CELL_W = 56;
const CELL_H = 36;
const CELL_GAP = 20;
const MAP_RIGHT = VIEW_W - 40 - 2 * PAUSE_SIZE - 24 - 30;
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
  private readonly bossMark = new Text({ text: '', style: style(24, 0xf3eee2) });
  private readonly help = new Text({ text: '', style: style(22, 0x4a4640) });
  private cells: { dungeon: string; at: [number, number][] } | null = null;
  private readonly combo = new Text({ text: '', style: { ...style(84, 0xc8281e), stroke: { color: 0xf3eee2, width: 8 } } });
  private readonly banner = new Text({ text: '', style: { ...style(110), stroke: { color: 0xf3eee2, width: 10 } } });
  /** The clear's rating: the grade, and the time, longest combo and hits taken under it. */
  private readonly grade = new Text({ text: '', style: { ...style(180, 0xc8281e), stroke: { color: 0xf3eee2, width: 12 } } });
  private readonly stats = new Text({ text: '', style: { ...style(36), stroke: { color: 0xf3eee2, width: 6 } } });
  private readonly verdict = new Text({ text: '', style: { ...style(44), stroke: { color: 0xf3eee2, width: 6 }, align: 'center' } });
  private readonly net = new Text({ text: '', style: style(24, 0x4a4640) });
  private readonly bag = new Text({ text: '', style: { ...style(24, 0x4a4640), align: 'right' } });
  /** Single player: the character's level beside the health bar, and what a run earned under
   * its result (experience, a level gained, each piece in its rarity's colour). */
  private readonly level = new Text({ text: '', style: { ...style(30), stroke: { color: 0xf3eee2, width: 5 } } });
  private readonly reward = new Container();
  private rewardKey = '';
  private readonly bossName = new Text({ text: '', style: { ...style(30), stroke: { color: 0xf3eee2, width: 5 } } });
  private readonly bossBars = new Text({ text: '', style: { ...style(30, 0xc8281e), stroke: { color: 0xf3eee2, width: 5 } } });
  /** The best clear of this dungeon on this device, shown under a clear's rating, and what the
   * clear just shown improved on it. */
  best: { best: Best | null; better: { grade: boolean; time: boolean } } = { best: null, better: { grade: false, time: false } };
  /** Why the game is offline, when it tried to go online. */
  offlineNote: Key | null = null;
  readonly controls = new Controls();

  private readonly tutorial: Tutorial;

  /** `tutorial`: the advice lines in Black Wind Fort (off with ?notutorial). */
  constructor(tutorial = true) {
    this.tutorial = new Tutorial(tutorial);
    this.help.position.set(40, 124);
    this.room.anchor.set(1, 0);
    this.bossMark.anchor.set(0.5);
    this.combo.anchor.set(1, 0);
    this.combo.position.set(VIEW_W - 40, 190);
    this.banner.anchor.set(0.5);
    this.banner.position.set(VIEW_W / 2, VIEW_H * 0.36);
    this.grade.anchor.set(0, 0.5);
    this.grade.position.set(VIEW_W / 2 + 170, VIEW_H * 0.36);
    this.stats.anchor.set(0.5, 0);
    this.stats.position.set(VIEW_W / 2, VIEW_H * 0.36 + 80);
    this.verdict.anchor.set(0.5, 0);
    this.verdict.position.set(VIEW_W / 2, VIEW_H * 0.36 + 200);
    this.net.position.set(40, 84);
    this.bag.anchor.set(1, 0);
    this.bag.position.set(VIEW_W - 40, 290);
    this.level.anchor.set(0, 0.5);
    this.level.position.set(580, 55);
    this.reward.position.set(VIEW_W / 2, VIEW_H * 0.36 + 200);
    this.bossName.position.set(BOSS_LEFT, BOSS_TOP - 40);
    this.bossBars.anchor.set(1, 0);
    this.bossBars.position.set(BOSS_LEFT + BOSS_W, BOSS_TOP - 40);
    this.layer.addChild(this.g, this.controls.layer, this.map, this.bossMark, this.room, this.combo, this.banner, this.grade, this.stats, this.verdict, this.net, this.bag, this.help, this.level, this.reward, this.bossName, this.bossBars, this.tutorial.text);
  }

  /** `keys`: the keyboard's held buttons, lit on the controls too. */
  update(s: SimState, session: Session, keys: number): void {
    const hero = s.entities.find((e) => e.team === 0);
    this.help.text = t('help');
    const g = this.g.clear();
    if (hero) {
      g.rect(40, 40, 520, 30).fill({ color: 0x000000, alpha: 0.25 });
      g.rect(40, 40, (520 * Math.max(0, hero.hp)) / hero.maxHp, 30).fill(0xc8281e);
      g.rect(40, 40, 520, 30).stroke({ width: 3, color: 0x141317 });
    }
    this.boss(g, s);
    this.controls.update(s, keys);
    this.minimap(s);
    this.tutorial.update(s);
    // the simulation counts the combo (it is rated on it)
    const combo = s.players[0]?.combo ?? 0;
    this.combo.text = combo >= 2 ? t('hud.combo', { n: combo }) : '';
    this.banner.text = s.outcome === 'cleared' ? t('hud.cleared') : s.outcome === 'failed' ? t('hud.failed') : '';
    // online, the server's rating once it has replayed the run (it is the same unless the client
    // was tampered with, which the checkpoints catch first)
    const res = session instanceof OnlineSession ? reached(session, s) : null;
    const r = res?.ok ? res.rating : null;
    this.rating(s.outcome === 'cleared' && s.config.dungeon !== 'training' ? (r ?? rateRun(s)) : null);
    this.net.text = session.status() || (this.offlineNote ? t(this.offlineNote) : '');
    if (session instanceof OnlineSession) this.online(session, s);
    else if (session instanceof OfflineSession) this.offline(session, s);
    else this.verdict.text = this.bag.text = '';
    if (!(session instanceof OfflineSession)) {
      this.level.text = '';
      this.showReward(null);
    }
  }

  /** Single player: the level and its experience bar under the health bar, and the run's
   * earnings once it is decided. */
  private offline(session: OfflineSession, s: SimState): void {
    const ch = session.character;
    // the tier, when above normal, beside the level
    this.level.text = t('hud.level', { n: ch.level }) + (s.config.tier > 0 ? `    ${tierName(s.config.tier)}` : '');
    if (ch.level < MAX_LEVEL) {
      const need = xpToNext(ch.level);
      this.g.rect(40, 74, 520, 8).fill({ color: 0x000000, alpha: 0.2 });
      this.g.rect(40, 74, (520 * Math.min(ch.xp, need)) / need, 8).fill(0xb8742a);
    }
    this.verdict.text = s.outcome === 'cleared' && DUNGEONS[s.config.dungeon].practice ? t('loot.practice') : '';
    this.bag.text = '';
    this.showReward(session.reward);
  }

  /** The run's experience and gold (and a level gained) on one line, then the pieces, five to a row. */
  private showReward(r: OfflineSession['reward']): void {
    const key = r ? `${getLang()}|${r.xp}|${r.level}|${r.gear.map((g) => g.id).join(',')}` : '';
    if (key === this.rewardKey) return;
    this.rewardKey = key;
    for (const c of this.reward.removeChildren()) c.destroy();
    if (!r) return;
    const stroke = { color: 0xf3eee2, width: 6 };
    const lines: Text[][] = [[new Text({ text: t('reward.xp', { n: r.xp }) + '    ' + t('reward.gold', { n: r.gold }) + (r.levels ? t('reward.levelUp', { n: r.level }) : ''), style: { ...style(40), stroke } })]];
    if (!r.gear.length && !r.lost.length) lines[0][0].text += `    ${t('loot.none')}`;
    for (let i = 0; i < r.gear.length; i += 5) {
      lines.push(r.gear.slice(i, i + 5).map((g) => new Text({ text: t(gearNameKey(g)), style: { ...style(36, RARITY_INK[g.rarity]), stroke } })));
    }
    if (r.lost.length) lines.push([new Text({ text: t('reward.lost', { n: r.lost.length }), style: { ...style(30, 0xc8281e), stroke } })]);
    lines.forEach((row, i) => {
      const gap = 36;
      const width = row.reduce((n, x) => n + x.width, 0) + gap * (row.length - 1);
      let x = -width / 2;
      for (const tx of row) {
        tx.position.set(x, i * 52);
        x += tx.width + gap;
        this.reward.addChild(tx);
      }
    });
  }

  private showBag(items: readonly Item[]): void {
    this.bag.text = items.length ? `${t('hud.bag', { n: items.length })}\n${items.slice(-6).map(itemName).join('\n')}` : '';
  }

  private rating(r: Rating | null): void {
    this.grade.text = r?.grade ?? '';
    if (!r) {
      this.stats.text = '';
      return;
    }
    this.stats.text = t('hud.stats', { time: clock(r.ticks), combo: r.maxCombo, hits: r.hitsTaken });
    const { best, better } = this.best;
    if (best) {
      const mark = better.grade || better.time ? t('hud.record') : '';
      this.stats.text += `\n${t('hud.best', { grade: best.grade, time: clock(best.ticks), n: best.clears })}${mark}`;
    }
  }

  /** The rooms been in (the ones cleared and this one), the rooms their doors lead to as
   * outlines, the boss's room marked from the start, and where the heroes are; under it, a
   * pointer onward once this room is clear. */
  private minimap(s: SimState): void {
    const m = this.map.clear();
    this.bossMark.visible = false;
    const dungeon = DUNGEONS[s.config.dungeon];
    if (s.config.dungeon === 'training' || s.room < 0) {
      this.room.text = s.config.dungeon === 'training' ? t('hud.training') : '';
      this.room.position.set(MAP_RIGHT, MAP_TOP);
      return;
    }
    this.bossMark.text = t('hud.bossMark');
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
    this.room.text = s.roomCleared && s.room !== dungeon.boss ? t('hud.onward') : '';
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
    const name = BOSS_NAME[b.kind];
    this.bossName.text = name ? t(name) : '';
    this.bossBars.text = left > 1 ? `×${left}` : '';
  }

  private online(session: OnlineSession, s: SimState): void {
    const r = reached(session, s);
    const why = (reason: string) => (REASONS[reason] ? t(REASONS[reason]) : reason);
    if (session.flag) this.verdict.text = t('verdict.flag', { why: why(session.flag.reason), tick: session.flag.tick });
    else if (r?.ok) {
      this.verdict.text = `${lootLine(r.loot)}${r.settleMs !== null ? `\n${t('verdict.settled', { ms: Math.round(r.settleMs) })}` : ''}`;
    }
    else if (r) this.verdict.text = t('verdict.noLoot', { why: why(r.reason) });
    else this.verdict.text = s.outcome === 'cleared' ? t('verdict.waiting') : '';
    this.showBag(session.inventory);
  }
}

function clock(ticks: number): string {
  const sec = Math.floor(ticks / TICK_RATE);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function lootLine(loot: readonly Item[]): string {
  return loot.length ? t('loot.got', { items: loot.map(itemName).join(t('loot.sep')) }) : t('loot.none');
}

/** An item's name in the player's language (the server's own, Chinese, for one the tables lack). */
function itemName(i: Item): string {
  return tOr(`item.${i.id}`, i.name);
}

/** The server's result once the client has played up to where the server ended the run (a
 * client that was hidden for a while gets there later, catching up). */
function reached(session: OnlineSession, s: SimState): OnlineSession['result'] {
  const r = session.result;
  return r && s.tick >= r.tick ? r : null;
}
