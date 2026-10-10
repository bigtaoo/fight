import { BODIES, DEFAULT_LOADOUT, DOOR_HALF, DUNGEONS, MOVES, SKILLS, WORLD, fromFp, runConfig, type DungeonId, type Entity, type Kind, type RunConfig, type SimEvent, type SimState, type SkillId } from '@dnf/engine';
import { SERVER_PORT } from '@dnf/server/protocol';
import { botButtons } from '@dnf/engine/bot';
import { Assets, Container, Graphics, Sprite, type Application } from 'pixi.js';
import { BodyView, FLASH_SEC } from './bodyView';
import { ShotView } from './shotView';
import { Fx } from './fx';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { loadRig, loadSprites, type SpriteSet } from './sprites';
import type { TaoAsset } from './tao/TaoActor';
import { GROUND_TOP, VIEW_H, VIEW_W, cameraX, floorY } from './layout';
import { WsLink } from '../net/Link';
import { OnlineSession } from '../net/OnlineSession';
import { OfflineSession, type Session } from '../net/Session';

/** The kinds drawn with a skeleton (client/public/art/<kind>/); ?poses shows paintings instead. */
const RIGGED: readonly Kind[] = ['hero', 'bandit', 'archer', 'shield'];

// The game: a session (the engine stepped at a fixed 30 Hz from the keyboard, online against
// the server's metronome unless that is not reachable) drawn every frame with interpolation
// between ticks. URL switches: ?offline (no server), ?server=ws://host:port, ?lag=N (ms added
// each way), ?dungeon=training (or heifeng, or hall: the chief alone), ?seed=N (offline), ?bot (the engine's bot plays), ?debug (hit
// boxes, also F1), ?cheat=dmg (hero damage x10 locally, which the server must catch), ?blocks
// (ink blocks instead of the pose paintings), ?poses (the hero's pose paintings instead of its
// skeleton), ?zoom=N (a close-up that follows the hero), ?loadout=dragon,crush (skills swapped
// into their slots over the default ones).
/** Colour of the loose ink each kind of body throws. */
const DROP_INK = { hero: 0x111014, bandit: 0x2f3d5c, archer: 0x4a4636, shield: 0x3d4148, chief: 0x3b2420, dummy: 0x6a5c40 } as const;
/** Moves that throw a heavy splash of ink as they start, and those that cut upward. */
const HEAVY = new Set(['atk3', 'upper', 'slash', 'bash', 'tri3', 'dragon4', 'crush2', 'iai', 'phantom', 'chop', 'chopF', 'roar']);
const RISING = new Set(['upper', 'crush2', 'dragon4']);
/** Moves that rush forward, ink streaming behind them while they cut. */
const RUSHES = new Set(['tri1', 'tri2', 'tri3', 'dragon1', 'dragon2', 'dragon3', 'dragon4', 'crush1']);
/** Rushes that stand still through a windup first: ink only once they are off. */
const CHARGES = new Set(['charge', 'chargeF']);

export class Game {
  private readonly root = new Container();
  private readonly bg = new Container();
  private readonly world = new Container();
  private readonly floor = new Graphics();
  private readonly bodies = new Container();
  private readonly views = new Map<number, BodyView>();
  private readonly shotViews = new Map<number, ShotView>();
  private readonly fx = new Fx();
  private readonly hud = new Hud();
  private readonly keys = new Keyboard();
  private far?: Sprite;
  private sprites: SpriteSet | null = null;
  /** Skeletons of the rigged kinds; the others show pose paintings. */
  private rigs: Partial<Record<Kind, TaoAsset>> = {};
  private session: Session | null = null;
  private link: WsLink | null = null;
  private frame = 0;
  private shake = 0;
  private debug: boolean;
  private seed: number;

  constructor(private readonly app: Application, private readonly params: URLSearchParams) {
    this.debug = params.has('debug');
    this.seed = Number(params.get('seed') ?? 1);
    this.bodies.sortableChildren = true;
    this.world.addChild(this.floor, this.bodies, this.fx.layer);
    this.root.addChild(this.bg, this.world, this.hud.layer);
    app.stage.addChild(this.root);
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'F1') {
        ev.preventDefault();
        this.debug = !this.debug;
      }
      if (ev.code === 'KeyR' && this.session) void this.start(this.seed + 1);
    });
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  async load(): Promise<void> {
    const paper = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0xf1ece0);
    this.bg.addChild(paper);
    try {
      this.far = new Sprite(await Assets.load('art/bg_far.jpg'));
      this.far.y = GROUND_TOP - this.far.height * 0.72;
      this.bg.addChild(this.far);
    } catch {
      // plain paper without the far layer
    }
    if (!this.params.has('blocks')) {
      const rigged = this.params.has('poses') ? [] : RIGGED;
      const [sprites, ...rigs] = await Promise.all([loadSprites(), ...rigged.map((k) => loadRig(k))]);
      this.sprites = sprites;
      rigged.forEach((k, i) => {
        const rig = rigs[i];
        if (rig) this.rigs[k] = rig;
      });
    }
    this.link = await this.connect();
    await this.start(this.seed);
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  /** The link to the server, or null to play offline. */
  private async connect(): Promise<WsLink | null> {
    if (this.params.has('offline')) return null;
    const url = this.params.get('server') ?? `ws://${location.hostname}:${SERVER_PORT}`;
    try {
      return await WsLink.connect(url, Number(this.params.get('lag') ?? 0));
    } catch {
      this.hud.offlineNote = '离线（没连上服务器）';
      return null;
    }
  }

  private config(seed: number): RunConfig {
    return runConfig({
      seed,
      dungeon: (this.params.get('dungeon') as DungeonId | null) ?? 'trial',
      heroDamagePct: this.params.get('cheat') === 'dmg' ? 1000 : 100,
      loadout: this.loadout(),
    });
  }

  /** The default skills, with those ?loadout= names swapped into their slots. */
  private loadout(): SkillId[] {
    const l = [...DEFAULT_LOADOUT];
    for (const id of (this.params.get('loadout') ?? '').split(',')) {
      if (Object.prototype.hasOwnProperty.call(SKILLS, id)) l[SKILLS[id as SkillId].slot] = id as SkillId;
    }
    return l;
  }

  private async start(seed: number): Promise<void> {
    this.seed = seed;
    this.session?.close();
    this.session = null;
    for (const v of this.views.values()) v.root.destroy();
    this.views.clear();
    if (this.link?.open) {
      try {
        const { dungeon, loadout } = this.config(seed);
        this.session = await OnlineSession.join(this.link, { dungeon, loadout: [...loadout], device: deviceId(), cheatDmg: this.params.get('cheat') === 'dmg' });
        return;
      } catch {
        this.hud.offlineNote = '离线（服务器没有开局）';
      }
    }
    this.session = new OfflineSession(this.config(seed));
  }

  private get engine() {
    return this.session!.engine;
  }

  /** Scales the 1920x1080 logical view into the window, letterboxed. */
  private fit(): void {
    const k = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    this.root.scale.set(k);
    this.root.position.set((window.innerWidth - VIEW_W * k) / 2, (window.innerHeight - VIEW_H * k) / 2);
  }

  private update(dt: number): void {
    const session = this.session;
    if (!session) return;
    const n = session.ticksFor(dt * 1000);
    for (let i = 0; i < n; i++) {
      const s = session.engine.state;
      const buttons = this.params.has('bot') ? botButtons(s, 0) : this.keys.read() | this.hud.controls.read();
      this.onEvents(session.step(buttons));
      this.tickInk(session.engine.state);
      for (const v of this.views.values()) v.tick();
    }
    this.render(session.alpha, dt);
  }

  private onEvents(events: readonly SimEvent[]): void {
    const s = this.engine.state;
    for (const ev of events) {
      if (ev.type === 'hit') {
        const target = this.views.get(ev.target);
        if (target) {
          // a blocked blow does not flash the body white: it rocks it behind its shield; one
          // taken under super armour barely shakes it
          target.flash = ev.blocked || ev.armor ? 0 : FLASH_SEC;
          target.shake = ev.blocked || ev.armor ? Math.min(2, ev.stop) : ev.stop;
        }
        const attacker = s.entities.find((e) => e.id === ev.attacker);
        const victim = s.entities.find((e) => e.id === ev.target);
        const h = victim ? fromFp(victim.z) + 120 : 120;
        const x = fromFp(ev.x);
        const y = GROUND_TOP + fromFp(ev.y) - h;
        if (ev.blocked && victim) {
          const front = x + ev.dir * -fromFp(BODIES[victim.kind].halfWidth);
          this.fx.clang(front, y, GROUND_TOP + fromFp(ev.y), ev.dir);
        } else {
          this.fx.splash(x, y, ev.dir, ev.stop >= 5);
        }
        this.fx.damage(x, y - 90, ev.dmg, victim?.team === 0, ev.blocked);
        if (attacker?.team === 0) this.hud.heroHit();
        if (ev.stop >= 5 || ev.launch) this.shake = Math.max(this.shake, 0.14);
      } else if (ev.type === 'swing' || ev.type === 'jump' || ev.type === 'land' || ev.type === 'down' || ev.type === 'death' || ev.type === 'rise') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) this.ink(e, ev.type === 'rise' ? 'land' : ev.type, ev.type === 'swing' ? ev.move : '');
      } else if (ev.type === 'fire') {
        const p = s.shots.find((q) => q.id === ev.id);
        const owner = s.entities.find((b) => b.id === ev.owner);
        if (p && owner) {
          const floor = floorY(fromFp(p.y));
          const dir = p.vx > 0 ? 0 : Math.PI;
          this.fx.burst(fromFp(p.x), floor - fromFp(p.z), floor, { n: 4, dir, spread: 0.5, speed: [120, 300], r: [2, 4.5], color: DROP_INK[owner.kind] });
          // the slam's landing shakes the room
          if (p.kind === 'quake') this.shake = Math.max(this.shake, 0.22);
        }
      } else if (ev.type === 'phase') {
        // a boss's second phase: its roar shakes the room and throws ink all round it
        const e = s.entities.find((b) => b.id === ev.id);
        this.shake = Math.max(this.shake, 0.5);
        if (e) {
          const floor = GROUND_TOP + fromFp(e.y);
          this.fx.burst(fromFp(e.x), floor - 200, floor, { n: 26, dir: -Math.PI / 2, spread: 3.2, speed: [200, 600], r: [3, 9], color: DROP_INK[e.kind], jitter: [40, 80] });
        }
      } else if (ev.type === 'roomEnter') {
        for (const v of this.views.values()) v.root.destroy();
        this.views.clear();
      }
    }
  }

  /** Ink thrown by one moment of movement. */
  private ink(e: Entity, what: 'swing' | 'jump' | 'land' | 'down' | 'death', move: string): void {
    const x = fromFp(e.x);
    const floor = GROUND_TOP + fromFp(e.y);
    const feet = floor - fromFp(e.z);
    const f = e.facing;
    const color = DROP_INK[e.kind];
    const fwdUp = f > 0 ? -0.45 : -Math.PI + 0.45;
    switch (what) {
      case 'swing': {
        if (MOVES[move].turn) break;
        if (move === 'backstep') {
          this.ink(e, 'jump', '');
          break;
        }
        const dir = RISING.has(move) ? -Math.PI / 2 + f * 0.4 : RUSHES.has(move) ? (f > 0 ? Math.PI : 0) : fwdUp;
        this.fx.burst(x + f * 50, feet - 130, floor, { n: HEAVY.has(move) ? 8 : 5, dir, spread: 1, speed: [220, 520], r: [2.4, 7.2], color, jitter: [30, 40] });
        break;
      }
      case 'jump':
        for (const dir of [-0.35, -Math.PI + 0.35]) this.fx.burst(x, floor - 4, floor, { n: 4, dir, spread: 0.5, speed: [120, 260], r: [2.4, 5.6], g: 1100, color });
        break;
      case 'land':
      case 'down':
        for (const dir of [-0.25, -Math.PI + 0.25]) {
          this.fx.burst(x, floor - 4, floor, { n: what === 'down' ? 7 : 4, dir, spread: 0.4, speed: [140, 360], r: [3.2, what === 'down' ? 9.5 : 6.5], g: 1300, color, jitter: [40, 0] });
        }
        break;
      case 'death':
        // the body dissolves back into the paper: drops drift up and fade
        this.fx.burst(x, feet - 110, floor, { n: 22, dir: -Math.PI / 2, spread: 1.4, speed: [20, 110], r: [4, 11.2], g: -40, life: 1.3, color, jitter: [90, 190] });
        break;
    }
  }

  /** Ink thrown continuously: kicked up behind a runner's feet, streaming behind a dash. */
  private tickInk(s: SimState): void {
    for (const e of s.entities) {
      if (e.held) continue;
      const x = fromFp(e.x);
      const floor = GROUND_TOP + fromFp(e.y);
      const back = e.facing > 0 ? Math.PI : 0;
      if (e.state === 'run' && s.tick % 2 === 0) {
        this.fx.burst(x - e.facing * 20, floor - 6, floor, { n: 2, dir: e.facing > 0 ? -Math.PI + 0.5 : -0.5, spread: 0.6, speed: [120, 280], r: [2.4, 5.6], g: 1300, color: DROP_INK[e.kind] });
      } else if (e.state === 'act' && (RUSHES.has(e.move) || (CHARGES.has(e.move) && e.st >= MOVES[e.move].active[0])) && e.st <= MOVES[e.move].active[1]) {
        this.fx.burst(x - e.facing * 30, floor - 100, floor, { n: 3, dir: back, spread: 0.35, speed: [60, 200], r: [2.4, 6.4], g: 500, color: DROP_INK[e.kind], jitter: [20, 120] });
      }
    }
  }

  private render(alpha: number, dt: number): void {
    const s = this.engine.state;
    this.frame++;
    this.syncViews(s);
    const hero = s.entities.find((e) => e.team === 0);
    const camX = hero ? cameraX(fromFp(hero.px + (hero.x - hero.px) * alpha), s.roomWidth) : 0;
    this.shake = Math.max(0, this.shake - dt);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 16 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 10 : 0;
    const zoom = Number(this.params.get('zoom') ?? 1);
    if (zoom > 1 && hero) {
      // a close-up on the hero, for checking animation
      const hx = fromFp(hero.px + (hero.x - hero.px) * alpha);
      const hy = GROUND_TOP + fromFp(hero.py + (hero.y - hero.py) * alpha) - 120;
      this.world.scale.set(zoom);
      this.world.position.set(VIEW_W / 2 - hx * zoom, VIEW_H / 2 - hy * zoom);
    } else {
      this.world.position.set(-camX + sx, sy);
    }
    if (this.far) this.far.x = -camX * 0.25;
    this.drawFloor(s);
    for (const e of s.entities) {
      const v = this.views.get(e.id)!;
      v.draw(e, alpha, this.frame, dt, this.debug);
      v.frame(dt);
    }
    for (const p of s.shots) this.shotViews.get(p.id)!.draw(p, alpha, this.debug);
    this.fx.update(dt);
    this.hud.update(s, dt, this.session!, this.keys.down);
  }

  private syncViews(s: SimState): void {
    const live = new Set(s.entities.map((e) => e.id));
    for (const [id, v] of this.views) {
      if (!live.has(id)) {
        v.root.destroy();
        this.views.delete(id);
      }
    }
    for (const e of s.entities) {
      if (this.views.has(e.id)) continue;
      const v = new BodyView(e.id, this.sprites, this.rigs[e.kind] ?? null);
      this.views.set(e.id, v);
      this.bodies.addChild(v.root);
    }
    // projectiles sort into the bodies by depth, the same way
    const flying = new Set(s.shots.map((p) => p.id));
    for (const [id, v] of this.shotViews) {
      if (!flying.has(id)) {
        v.root.destroy();
        this.shotViews.delete(id);
      }
    }
    for (const p of s.shots) {
      if (this.shotViews.has(p.id)) continue;
      const v = new ShotView();
      this.shotViews.set(p.id, v);
      this.bodies.addChild(v.root);
    }
  }

  /** The floor band, its back edge drawn as one ink stroke, and the open doors of a cleared room. */
  private drawFloor(s: SimState): void {
    const w = fromFp(s.roomWidth);
    const g = this.floor.clear();
    g.rect(0, GROUND_TOP - 30, w, VIEW_H - GROUND_TOP + 30).fill({ color: 0xe6dfcf, alpha: 0.85 });
    g.rect(0, GROUND_TOP - 32, w, 4).fill({ color: 0x3a3630, alpha: 0.5 });
    g.rect(0, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    g.rect(w - 10, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    if (s.roomCleared && s.outcome === 'playing') {
      const fill = { color: 0xc8281e, alpha: (0.35 + 0.25 * Math.sin(this.frame / 8)) * 0.5 };
      const half = fromFp(DOOR_HALF);
      const front = floorY(fromFp(WORLD.depth));
      for (const d of DUNGEONS[s.config.dungeon].rooms[s.room].doors) {
        const x = fromFp(d.x ?? 0);
        if (d.side === 'right') g.rect(w - 140, GROUND_TOP - 30, 130, VIEW_H - GROUND_TOP + 30).fill(fill);
        else if (d.side === 'left') g.rect(10, GROUND_TOP - 30, 130, VIEW_H - GROUND_TOP + 30).fill(fill);
        else if (d.side === 'up') g.rect(x - half, GROUND_TOP - 30, half * 2, 54).fill(fill);
        else g.rect(x - half, front - 24, half * 2, VIEW_H - front + 24).fill(fill);
      }
    }
  }
}

/** This browser's id for the server's inventory (no accounts in M1). */
function deviceId(): string {
  const make = () => crypto.randomUUID();
  try {
    let id = localStorage.getItem('dnf.device');
    if (!id) localStorage.setItem('dnf.device', (id = make()));
    return id;
  } catch {
    return make();
  }
}
