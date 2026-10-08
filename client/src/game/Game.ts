import { Engine, LocalInputSource, MOVES, TICK_RATE, fromFp, runConfig, type DungeonId, type RunConfig, type Entity, type SimEvent, type SimState } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { Assets, Container, Graphics, Sprite, type Application } from 'pixi.js';
import { BodyView } from './bodyView';
import { Fx } from './fx';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { loadRig, loadSprites, type SpriteSet } from './sprites';
import type { TaoAsset } from './tao/TaoActor';
import { GROUND_TOP, VIEW_H, VIEW_W, cameraX } from './layout';

// The offline prototype: one engine stepped at a fixed 30 Hz from the keyboard, drawn every
// frame with interpolation between ticks. URL switches: ?dungeon=training, ?seed=N, ?bot (the
// engine's bot plays), ?debug (hit boxes, also F1), ?cheat=dmg (hero damage x10 locally),
// ?blocks (ink blocks instead of the pose paintings), ?poses (the hero's pose paintings instead of
// its skeleton), ?zoom=N (a close-up that follows the hero).

const STEP = 1 / TICK_RATE;
/** At most this many ticks per frame; beyond it the sim slows down rather than spiralling. */
const MAX_STEPS = 5;
/** Colour of the loose ink each kind of body throws. */
const DROP_INK = { hero: 0x111014, bandit: 0x2f3d5c, dummy: 0x6a5c40 } as const;

export class Game {
  private readonly root = new Container();
  private readonly bg = new Container();
  private readonly world = new Container();
  private readonly floor = new Graphics();
  private readonly bodies = new Container();
  private readonly views = new Map<number, BodyView>();
  private readonly fx = new Fx();
  private readonly hud = new Hud();
  private readonly keys = new Keyboard();
  private far?: Sprite;
  private sprites: SpriteSet | null = null;
  private heroRig: TaoAsset | null = null;
  private engine!: Engine;
  private acc = 0;
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
      if (ev.code === 'KeyR') this.start(this.seed + 1);
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
      [this.sprites, this.heroRig] = await Promise.all([loadSprites(), this.params.has('poses') ? null : loadRig('hero')]);
    }
    this.start(this.seed);
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  private config(seed: number): RunConfig {
    return runConfig({
      seed,
      dungeon: (this.params.get('dungeon') as DungeonId | null) ?? 'trial',
      heroDamagePct: this.params.get('cheat') === 'dmg' ? 1000 : 100,
    });
  }

  private start(seed: number): void {
    this.seed = seed;
    this.engine = new Engine(this.config(seed), new LocalInputSource());
    for (const v of this.views.values()) v.root.destroy();
    this.views.clear();
    this.acc = 0;
  }

  /** Scales the 1920x1080 logical view into the window, letterboxed. */
  private fit(): void {
    const k = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    this.root.scale.set(k);
    this.root.position.set((window.innerWidth - VIEW_W * k) / 2, (window.innerHeight - VIEW_H * k) / 2);
  }

  private update(dt: number): void {
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      const e = this.engine;
      const buttons = this.params.has('bot') ? botButtons(e.state, 0) : this.keys.read();
      e.submit({ owner: 0, tick: e.nextTick, buttons });
      const events = e.advance();
      if (events) this.onEvents(events);
      this.tickInk(e.state);
      for (const v of this.views.values()) v.tick();
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.render(this.acc / STEP, dt);
  }

  private onEvents(events: readonly SimEvent[]): void {
    const s = this.engine.state;
    for (const ev of events) {
      if (ev.type === 'hit') {
        const target = this.views.get(ev.target);
        if (target) {
          target.flash = 3;
          target.shake = ev.stop;
        }
        const attacker = s.entities.find((e) => e.id === ev.attacker);
        const victim = s.entities.find((e) => e.id === ev.target);
        const h = victim ? fromFp(victim.z) + 120 : 120;
        const x = fromFp(ev.x);
        const y = GROUND_TOP + fromFp(ev.y) - h;
        this.fx.splash(x, y, attacker?.facing ?? 1, ev.stop >= 5);
        this.fx.damage(x, y - 90, ev.dmg, victim?.team === 0);
        if (attacker?.team === 0) this.hud.heroHit();
        if (ev.stop >= 5 || ev.launch) this.shake = Math.max(this.shake, 0.14);
      } else if (ev.type === 'swing' || ev.type === 'jump' || ev.type === 'land' || ev.type === 'down' || ev.type === 'death') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) this.ink(e, ev.type, ev.type === 'swing' ? ev.move : '');
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
        const heavy = move === 'atk3' || move === 'upper' || move === 'slash';
        const dir = move === 'upper' ? -Math.PI / 2 + f * 0.4 : move === 'dash' ? (f > 0 ? Math.PI : 0) : fwdUp;
        this.fx.burst(x + f * 50, feet - 130, floor, { n: heavy ? 8 : 5, dir, spread: 1, speed: [220, 520], r: [2.4, 7.2], color, jitter: [30, 40] });
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
      } else if (e.state === 'act' && e.move === 'dash' && e.st <= MOVES.dash.active[1]) {
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
      v.frame();
      v.draw(e, alpha, this.frame, dt, this.debug);
    }
    this.fx.update(dt);
    this.hud.update(s, dt);
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
      const v = new BodyView(e.id, this.sprites, e.kind === 'hero' ? this.heroRig : null);
      this.views.set(e.id, v);
      this.bodies.addChild(v.root);
    }
  }

  /** The floor band, its back edge drawn as one ink stroke, and the open door of a cleared room. */
  private drawFloor(s: SimState): void {
    const w = fromFp(s.roomWidth);
    const g = this.floor.clear();
    g.rect(0, GROUND_TOP - 30, w, VIEW_H - GROUND_TOP + 30).fill({ color: 0xe6dfcf, alpha: 0.85 });
    g.rect(0, GROUND_TOP - 32, w, 4).fill({ color: 0x3a3630, alpha: 0.5 });
    g.rect(0, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    g.rect(w - 10, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    if (s.roomCleared && s.outcome === 'playing') {
      const pulse = 0.35 + 0.25 * Math.sin(this.frame / 8);
      g.rect(w - 140, GROUND_TOP - 30, 130, VIEW_H - GROUND_TOP + 30).fill({ color: 0xc8281e, alpha: pulse * 0.5 });
    }
  }
}
