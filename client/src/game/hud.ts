import { DUNGEONS, MONSTERS, rateRun, type Dungeon, type Entity, type Rating, type SimState } from '@dnf/engine';
import { PAUSE_SIZE } from './menu';
import type { Best } from './progress';
import { clock } from './chapter';
import { OnlineSession } from '../net/OnlineSession';
import { OfflineSession, type Session } from '../net/Session';
import type { Item } from '@dnf/server/protocol';
import { Controls } from './controls';
import { CELL_BG, DARK, FONT, GREY, INK, PAPER, RED, VIEW_H, VIEW_W, css, el, halo, label, setText, show, type Overlay } from './dom';
import { MAX_LEVEL, RARITY_INK, gearNameKey } from '../rpg/gear';
import { xpToNext } from '../rpg/character';
import { getLang, t, tOr, type Key } from '../i18n';
import { tierName } from '../rpg/tiers';

// The HUD, in the HTML overlay: health, a boss's health in bars across the top, the on-screen
// controls with the cooldowns, the room, the combo counter, the key help, the end-of-run banner
// with the server's verdict, the connection and the inventory. The text is looked up each frame
// (and written only when it changed), so a language switch shows at once.

/** A boss's health in bars of this much each (DNF style: the bar runs out and the next one
 * under it shows, in another colour), and the colours they cycle through, top bar first. */
const BOSS_BAR = 600;
const BAR_INK = [0xc8281e, 0xb8742a, 0x6a7a2e, 0x2e6a6a, 0x4a3a7a] as const;
/** Boss names, for the bar. */
const BOSS_NAME: Partial<Record<Entity['kind'], Key>> = { chief: 'boss.chief', woodcutter: 'boss.woodcutter' };

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
const MAP_RIGHT = VIEW_W - 40 - 3 * PAUSE_SIZE - 2 * 24 - 30;
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
/** The height of the end-of-run banner. */
const MID = VIEW_H * 0.36;

/** A bar: a dark back, a fill scaled along x from the left (over an `under` one, for the boss's
 * next bar), an ink outline. */
interface Bar {
  root: HTMLDivElement;
  under: HTMLDivElement;
  fill: HTMLDivElement;
  frac: number;
}

function bar(parent: HTMLElement, x: number, y: number, w: number, h: number, back: string, fill: string, line: number): Bar {
  const edge = line ? `outline:${line}px solid ${INK};outline-offset:${-line / 2}px` : '';
  const root = el('div', `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${back};${edge}`, parent);
  const under = el('div', 'position:absolute;inset:0;display:none', root);
  const f = el('div', `position:absolute;inset:0;background:${fill};transform-origin:0 0`, root);
  return { root, under, fill: f, frac: 1 };
}

function setBar(b: Bar, frac: number): void {
  const f = Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 1000;
  if (f === b.frac) return;
  b.frac = f;
  b.fill.style.transform = `scaleX(${f})`;
}

export class Hud {
  private readonly hp: Bar;
  private readonly xp: Bar;
  private readonly bossBar: Bar;
  private bossLeft = -1;
  private readonly room: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private mapKey = '';
  private readonly help: HTMLDivElement;
  private cells: { dungeon: string; at: [number, number][] } | null = null;
  private readonly combo: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  /** The clear's rating: the grade, and the time, longest combo and hits taken under it. */
  private readonly grade: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly verdict: HTMLDivElement;
  private readonly net: HTMLDivElement;
  private readonly bag: HTMLDivElement;
  /** Single player: the character's level beside the health bar, and what a run earned under
   * its result (experience, a level gained, each piece in its rarity's colour). */
  private readonly level: HTMLDivElement;
  private readonly reward: HTMLDivElement;
  private rewardKey = '';
  private readonly bossName: HTMLDivElement;
  private readonly bossBars: HTMLDivElement;
  /** The best clear of this dungeon on this device, shown under a clear's rating, and what the
   * clear just shown improved on it. */
  best: { best: Best | null; better: { grade: boolean; time: boolean } } = { best: null, better: { grade: false, time: false } };
  /** Why the game is offline, when it tried to go online. */
  offlineNote: Key | null = null;
  /** A chapter section's end card takes the banner's and the grade's place (sectionEnd.ts). */
  quiet = false;
  /** The clear's rating as shown (the server's online, once it has replayed the run). */
  shown: Rating | null = null;
  /** The run is decided but its end is still being played (1-1's camera on the folding screen):
   * the banner, rating and reward wait. */
  holding = false;
  readonly controls: Controls;

  constructor(ui: Overlay) {
    // the controls first: their touch layer lies under everything else
    this.controls = new Controls(ui);
    const lt = ui.frame('lt');
    const rt = ui.frame('rt');
    const ct = ui.frame('ct');
    const cm = ui.frame('cm');
    const ring = (w: number) => `text-shadow:${halo(w)}`;

    this.hp = bar(lt, 40, 40, 520, 30, 'rgba(0,0,0,.25)', RED, 3);
    this.xp = bar(lt, 40, 74, 520, 8, 'rgba(0,0,0,.2)', '#b8742a', 0);
    this.level = label(lt, '', 580, 55, 30, INK, 0, 0.5, ring(2.5));
    this.net = label(lt, '', 40, 84, 24, DARK);
    this.help = label(lt, '', 40, 124, 22, DARK);

    this.map = el('canvas', 'position:absolute;display:none', rt);
    this.room = label(rt, '', MAP_RIGHT, MAP_TOP, 34, INK, 1, 0);
    this.combo = label(rt, '', VIEW_W - 40, 190, 84, RED, 1, 0, ring(4));
    this.bag = label(rt, '', VIEW_W - 40, 290, 24, DARK, 1, 0, 'text-align:right');

    this.bossBar = bar(ct, BOSS_LEFT, BOSS_TOP, BOSS_W, 26, 'rgba(0,0,0,.3)', RED, 3);
    this.bossName = label(ct, '', BOSS_LEFT, BOSS_TOP - 40, 30, INK, 0, 0, ring(2.5));
    this.bossBars = label(ct, '', BOSS_LEFT + BOSS_W, BOSS_TOP - 40, 30, RED, 1, 0, ring(2.5));

    this.banner = label(cm, '', VIEW_W / 2, MID, 110, INK, 0.5, 0.5, ring(5));
    this.grade = label(cm, '', VIEW_W / 2 + 170, MID, 180, RED, 0, 0.5, ring(6));
    this.stats = label(cm, '', VIEW_W / 2, MID + 80, 36, INK, 0.5, 0, `text-align:center;${ring(3)}`);
    this.verdict = label(cm, '', VIEW_W / 2, MID + 200, 44, INK, 0.5, 0, `text-align:center;${ring(3)}`);
    this.reward = el('div', `position:absolute;left:0;top:${MID + 200}px;width:${VIEW_W}px;${ring(3)}`, cm);
  }

  /** `keys`: the keyboard's held buttons, lit on the controls too. */
  update(s: SimState, session: Session, keys: number): void {
    const hero = s.entities.find((e) => e.team === 0);
    setText(this.help, t('help'));
    show(this.hp.root, !!hero);
    if (hero) setBar(this.hp, Math.max(0, hero.hp) / hero.maxHp);
    this.boss(s);
    this.controls.update(s, keys);
    this.minimap(s);
    // the simulation counts the combo (it is rated on it)
    const combo = s.players[0]?.combo ?? 0;
    setText(this.combo, combo >= 2 ? t('hud.combo', { n: combo }) : '');
    const outcome = this.holding ? 'playing' : s.outcome;
    setText(this.banner, outcome === 'cleared' ? (this.quiet ? '' : t('hud.cleared')) : outcome === 'failed' ? t('hud.failed') : '');
    // online, the server's rating once it has replayed the run (it is the same unless the client
    // was tampered with, which the checkpoints catch first)
    const res = session instanceof OnlineSession ? reached(session, s) : null;
    const r = res?.ok ? res.rating : null;
    this.rating(outcome === 'cleared' && s.config.dungeon !== 'training' ? (r ?? rateRun(s)) : null);
    setText(this.net, session.status() || (this.offlineNote ? t(this.offlineNote) : ''));
    if (session instanceof OnlineSession) this.online(session, s);
    else if (session instanceof OfflineSession) this.offline(session, s);
    else {
      setText(this.verdict, '');
      setText(this.bag, '');
    }
    if (!(session instanceof OfflineSession)) {
      setText(this.level, '');
      show(this.xp.root, false);
      this.showReward(null);
    }
  }

  /** Single player: the level and its experience bar under the health bar, and the run's
   * earnings once it is decided. */
  private offline(session: OfflineSession, s: SimState): void {
    const ch = session.character;
    // the tier, when above normal, beside the level
    setText(this.level, t('hud.level', { n: ch.level }) + (s.config.tier > 0 ? `    ${tierName(s.config.tier)}` : ''));
    show(this.xp.root, ch.level < MAX_LEVEL);
    if (ch.level < MAX_LEVEL) {
      const need = xpToNext(ch.level);
      setBar(this.xp, Math.min(ch.xp, need) / need);
    }
    setText(this.verdict, !this.holding && s.outcome === 'cleared' && DUNGEONS[s.config.dungeon].practice ? t('loot.practice') : '');
    setText(this.bag, '');
    this.showReward(this.holding ? null : session.reward);
  }

  /** The run's experience and gold (and a level gained) on one line, then the pieces, five to a row. */
  private showReward(r: OfflineSession['reward']): void {
    const key = r ? `${getLang()}|${r.xp}|${r.level}|${r.gear.map((g) => g.id).join(',')}` : '';
    if (key === this.rewardKey) return;
    this.rewardKey = key;
    this.reward.replaceChildren();
    if (!r) return;
    const line = (items: [string, string, number][]) => {
      const row = el('div', 'display:flex;justify-content:center;gap:36px;height:52px;white-space:pre', this.reward);
      for (const [text, color, size] of items) el('div', `color:${color};font-size:${size}px`, row, text);
    };
    let head = t('reward.xp', { n: r.xp }) + '    ' + t('reward.gold', { n: r.gold }) + (r.levels ? t('reward.levelUp', { n: r.level }) : '');
    if (!r.gear.length && !r.lost.length) head += `    ${t('loot.none')}`;
    line([[head, INK, 40]]);
    for (let i = 0; i < r.gear.length; i += 5) line(r.gear.slice(i, i + 5).map((g) => [t(gearNameKey(g)), css(RARITY_INK[g.rarity]), 36]));
    if (r.lost.length) line([[t('reward.lost', { n: r.lost.length }), RED, 30]]);
  }

  private showBag(items: readonly Item[]): void {
    setText(this.bag, items.length ? `${t('hud.bag', { n: items.length })}\n${items.slice(-6).map(itemName).join('\n')}` : '');
  }

  private rating(r: Rating | null): void {
    this.shown = r;
    setText(this.grade, this.quiet || this.holding ? '' : (r?.grade ?? ''));
    if (!r) {
      setText(this.stats, '');
      return;
    }
    let text = t('hud.stats', { time: clock(r.ticks), combo: r.maxCombo, hits: r.hitsTaken });
    const { best, better } = this.best;
    if (best) {
      const mark = better.grade || better.time ? t('hud.record') : '';
      text += `\n${t('hud.best', { grade: best.grade, time: clock(best.ticks), n: best.clears })}${mark}`;
    }
    setText(this.stats, text);
  }

  /** The rooms been in (the ones cleared and this one), the rooms their doors lead to as
   * outlines, the boss's room marked from the start, and where the heroes are; under it, a
   * pointer onward once this room is clear. Drawn on a small canvas, again only on a change. */
  private minimap(s: SimState): void {
    const dungeon = DUNGEONS[s.config.dungeon];
    if (s.config.dungeon === 'training' || s.room < 0) {
      show(this.map, false);
      this.mapKey = '';
      setText(this.room, s.config.dungeon === 'training' ? t('hud.training') : '');
      this.room.style.top = `${MAP_TOP}px`;
      return;
    }
    if (this.cells?.dungeon !== s.config.dungeon) this.cells = { dungeon: s.config.dungeon, at: layout(dungeon) };
    const at = this.cells.at;
    const cols = Math.max(...at.map((c) => c[0])) + 1;
    const rows = Math.max(...at.map((c) => c[1])) + 1;
    const mapH = rows * CELL_H + (rows - 1) * CELL_GAP;
    setText(this.room, s.roomCleared && s.room !== dungeon.boss ? t('hud.onward') : '');
    this.room.style.top = `${MAP_TOP + mapH + 18}px`;
    const key = `${s.config.dungeon}|${s.room}|${[...s.cleared].join(',')}|${getLang()}`;
    if (key === this.mapKey) return;
    this.mapKey = key;

    const left = MAP_RIGHT - cols * CELL_W - (cols - 1) * CELL_GAP;
    const x0 = left - 10;
    const y0 = MAP_TOP - 10;
    const w = MAP_RIGHT - left + 20;
    const h = mapH + 20;
    // drawn at twice the logical size, sharp on a dense screen
    const c = this.map;
    c.width = w * 2;
    c.height = h * 2;
    c.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${w}px;height:${h}px`;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.translate(-x0, -y0);
    const pos = (i: number) => ({ x: left + at[i][0] * (CELL_W + CELL_GAP), y: MAP_TOP + at[i][1] * (CELL_H + CELL_GAP) });
    const been = new Set([...s.cleared, s.room]);
    const known = new Set(been);
    for (const i of been) for (const d of dungeon.rooms[i].doors) known.add(d.to);
    known.add(dungeon.boss);
    g.fillStyle = 'rgba(243,238,226,.6)';
    g.beginPath();
    g.roundRect(x0, y0, w, h, 8);
    g.fill();
    // the links between rooms, once one end has been visited
    g.strokeStyle = DARK;
    g.lineWidth = 5;
    for (const i of been) {
      const a = pos(i);
      for (const d of dungeon.rooms[i].doors) {
        const b = pos(d.to);
        g.beginPath();
        g.moveTo(a.x + CELL_W / 2, a.y + CELL_H / 2);
        g.lineTo(b.x + CELL_W / 2, b.y + CELL_H / 2);
        g.stroke();
      }
    }
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.font = `bold 24px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const i of known) {
      const { x, y } = pos(i);
      const here = i === s.room;
      g.fillStyle = been.has(i) ? (here ? RED : GREY) : CELL_BG;
      g.fillRect(x, y, CELL_W, CELL_H);
      g.strokeRect(x, y, CELL_W, CELL_H);
      if (i === dungeon.boss && !here) {
        g.fillStyle = been.has(i) ? PAPER : RED;
        g.fillText(t('hud.bossMark'), x + CELL_W / 2, y + CELL_H / 2);
      }
    }
  }

  /** The boss's bars, while one is in the room: the top bar over the one under it, the count of
   * bars left, its name. */
  private boss(s: SimState): void {
    const b = s.entities.find((e) => e.kind !== 'hero' && MONSTERS[e.kind].boss);
    show(this.bossBar.root, !!b);
    if (!b) {
      setText(this.bossName, '');
      setText(this.bossBars, '');
      return;
    }
    const hp = Math.max(0, b.hp);
    const bars = Math.ceil(b.maxHp / BOSS_BAR);
    const left = Math.ceil(hp / BOSS_BAR);
    const inTop = hp - (left - 1) * BOSS_BAR;
    const ink = (i: number) => css(BAR_INK[(bars - i) % BAR_INK.length]);
    if (left !== this.bossLeft) {
      this.bossLeft = left;
      const { under, fill } = this.bossBar;
      show(under, left > 1);
      if (left > 1) under.style.background = ink(left - 1);
      show(fill, left > 0);
      if (left > 0) fill.style.background = ink(left);
    }
    setBar(this.bossBar, inTop / BOSS_BAR);
    const name = BOSS_NAME[b.kind];
    setText(this.bossName, name ? t(name) : '');
    setText(this.bossBars, left > 1 ? `×${left}` : '');
  }

  private online(session: OnlineSession, s: SimState): void {
    const r = reached(session, s);
    const why = (reason: string) => (REASONS[reason] ? t(REASONS[reason]) : reason);
    let text = '';
    if (session.flag) text = t('verdict.flag', { why: why(session.flag.reason), tick: session.flag.tick });
    else if (r?.ok) text = `${lootLine(r.loot)}${r.settleMs !== null ? `\n${t('verdict.settled', { ms: Math.round(r.settleMs) })}` : ''}`;
    else if (r) text = t('verdict.noLoot', { why: why(r.reason) });
    else if (s.outcome === 'cleared') text = t('verdict.waiting');
    setText(this.verdict, text);
    this.showBag(session.inventory);
  }
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
