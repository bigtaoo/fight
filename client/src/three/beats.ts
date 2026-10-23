import { fromFp, type SimEvent, type SimState } from '@dnf/engine';
import { Vector3, type Scene, type Texture } from 'three';
import { DEPTH_K, type Actor } from './actor';
import { AIM_Y } from './view';
import type { Decor } from './decor';
import type { Post } from './post';
import { FoldingScreen } from './screen';
import type { Splash } from './splash';

// 1-1's staged moments (design/CHAPTER1.md), drawn only: the engine is held still under them
// (View3D.cutscene, offline) and nothing here touches the simulation.
//  - seep: entering the river village, ink seeps down from the scroll's top edge and the three
//    villagers turn to ink monsters as it reaches them;
//  - stroke: before the woodcutter, the camera closes on the hero and the brush adds a stroke to
//    the sword (补一笔), the hero's 三段斩;
//  - outro: the woodcutter beaten and the colour back, the camera drifts to the folding screen at
//    the back of the threshing floor and rests on it as ink wells out of its panels.

/** How long each holds the engine (seconds); when the villagers start turning, one after another,
 * and how long one takes. */
const SEEP_SEC = 3.0;
const TURN_AT = 0.9;
const TURN_EACH = 0.3;
const TURN_SEC = 1.0;
const STROKE_SEC = 3.2;
/** The outro: the wash first, the camera's drift, when the screen starts to seep, and done. */
const PAN_AT = 1.6;
const PAN_SEC = 1.8;
const SCREEN_AT = 3.0;
const SCREEN_SEC = 2.6;
const OUTRO_SEC = 6.0;
/** Where the screen stands in the threshing floor (its left edge; the back of the floor). */
const SCREEN_X = 1480;
const SCREEN_Z = -20;
/** How near the camera comes (of its distance) on the hero and on the screen. */
const CLOSE_HERO = 0.62;
const CLOSE_SCREEN = 0.72;
/** How high the camera aims on the screen: about its middle, so it stands whole in the frame. */
const AIM_SCREEN = 175;

type Beat = 'seep' | 'stroke' | 'outro';

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

export interface BeatsContext {
  scene: Scene;
  post: Post | null;
  decor: Decor | null;
  ink: Splash;
  cinnabar: Splash;
  /** The colour picture an ink villager's body had (null: none loaded, it is ink from the start). */
  colourOf: (id: number) => Texture | null;
  /** Shakes the camera for `sec` seconds. */
  shake: (sec: number) => void;
}

export class Beats {
  /** The camera's override for this frame: where along it looks and how near (of its distance);
   * how high it aims; `look` 0 leaves the camera to follow the hero. */
  readonly camera = { x: 0, y: AIM_Y, close: 1, look: 0 };
  private beat: Beat | null = null;
  private t = 0;
  private turning: { id: number; at: number }[] = [];
  private readonly screen: FoldingScreen;
  private done = false;
  private lastTick = 0;
  private puffs = 0;
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(
    private readonly cx: BeatsContext,
    screenBase: string,
  ) {
    this.screen = new FoldingScreen(screenBase);
    this.screen.root.position.set(SCREEN_X, 0, SCREEN_Z);
    this.screen.root.visible = false;
    cx.scene.add(this.screen.root);
  }

  /** The engine is to be held still: a beat is playing. */
  get holding(): boolean {
    return this.beat !== null;
  }

  /** The outro has played: the run's result can be shown. True whenever there is no outro. */
  get outroDone(): boolean {
    return this.done;
  }

  /** A run starts over: no beat, the screen dry. */
  reset(): void {
    this.beat = null;
    this.turning = [];
    this.done = false;
    this.camera.look = 0;
    this.screen.seep = 0;
  }

  onEvent(ev: SimEvent, s: SimState): void {
    if (s.config.dungeon !== 'luobi' || ev.type !== 'roomEnter') return;
    if (s.room === 1) this.start('seep');
    else if (s.room === 3) this.start('stroke');
  }

  private start(beat: Beat): void {
    this.beat = beat;
    this.t = 0;
    this.puffs = 0;
    if (beat === 'seep') {
      this.cx.post?.seep(SEEP_SEC - 0.4);
      this.turning = [];
    }
  }

  /** Moves the beat on `dt` seconds; called after the bodies are synced and posed. `cx` is where
   * the camera would look by itself. */
  update(dt: number, s: SimState, actors: Map<number, Actor>, cx: number): void {
    // a restart (R) goes back to the start of the chapter
    if (s.tick < this.lastTick) this.reset();
    this.lastTick = s.tick;
    const luobi = s.config.dungeon === 'luobi';
    this.screen.root.visible = luobi && s.room === 3;
    const outro = luobi && s.room === 3 && s.outcome === 'cleared';
    if (outro && !this.done && this.beat !== 'outro') this.start('outro');
    if (!outro && s.outcome !== 'playing') this.done = true;
    if (!this.beat) return;
    this.t += dt;
    if (this.beat === 'seep') this.seep(s, actors);
    else if (this.beat === 'stroke') this.stroke(s, actors, cx);
    else this.outro(cx);
  }

  private seep(s: SimState, actors: Map<number, Actor>): void {
    const t = this.t;
    // the monsters of the room, left to right, each turning as the ink reaches it
    if (!this.turning.length) {
      const foes = s.entities.filter((e) => e.team !== 0).sort((p, q) => p.x - q.x);
      foes.forEach((e, i) => {
        const was = this.cx.colourOf(e.id);
        const a = actors.get(e.id);
        if (!was || !a) return;
        a.inkFrom(was);
        this.turning.push({ id: e.id, at: TURN_AT + i * TURN_EACH });
      });
      if (!this.turning.length) this.turning.push({ id: -1, at: 99 });
    }
    for (const turn of this.turning) {
      const a = actors.get(turn.id);
      if (!a) continue;
      const k = (t - turn.at) / TURN_SEC;
      if (k > 0 && a.inked === 0) {
        const e = s.entities.find((b) => b.id === turn.id)!;
        this.a.set(fromFp(e.x), 200, fromFp(e.y) * DEPTH_K);
        this.cx.ink.burst(this.a, e.facing, 26, 0.5);
        this.cx.ink.burst(this.a, -e.facing, 14, 0.4);
      }
      a.inked = Math.max(0.0001, Math.min(1, k));
      if (k <= 0) a.inked = 0;
    }
    if (t >= SEEP_SEC) {
      for (const turn of this.turning) {
        const a = actors.get(turn.id);
        if (a) a.inked = 1;
      }
      this.beat = null;
    }
  }

  private stroke(s: SimState, actors: Map<number, Actor>, cx: number): void {
    const t = this.t;
    const heroE = s.entities.find((e) => e.team === 0);
    const hero = heroE && actors.get(heroE.id);
    const hx = heroE ? fromFp(heroE.x) : cx;
    // in on the hero, and back out at the end
    const k = t < STROKE_SEC - 0.8 ? ease(t / 0.6) : ease((STROKE_SEC - t) / 0.8);
    this.camera.look = k;
    this.camera.x = hx;
    this.camera.y = AIM_Y;
    this.camera.close = 1 + (CLOSE_HERO - 1) * k;
    if (t >= 0.6 && this.puffs === 0) {
      this.puffs = 1;
      this.cx.decor?.stroke();
    }
    // the brush down the blade: ink from the guard to the point, cinnabar flicked off the tip
    if (hero && t >= 0.7 && t < 1.7 && hero.bladeEnds(this.a, this.b)) {
      const along = (t - 0.7) / 1.0;
      const dir = heroE!.facing;
      this.a.lerp(this.b, Math.min(1, along));
      this.cx.ink.burst(this.a, dir, 3, 0.18);
      if (Math.floor(along * 8) !== Math.floor((along - 0.02) * 8)) this.cx.cinnabar.burst(this.a, dir, 2, 0.12);
    }
    if (hero && t >= 1.7 && this.puffs === 1) {
      this.puffs = 2;
      hero.flash = 0.18;
      if (hero.bladeEnds(this.a, this.b)) {
        this.cx.cinnabar.burst(this.b, heroE!.facing, 30, 0.7);
        this.cx.ink.burst(this.b, heroE!.facing, 18, 0.9);
      }
      if (this.cx.post) this.cx.post.flash = Math.max(this.cx.post.flash, 0.45);
      this.cx.shake(0.12);
    }
    if (t >= STROKE_SEC) {
      this.camera.look = 0;
      this.beat = null;
    }
  }

  private outro(cx: number): void {
    const t = this.t;
    const k = ease((t - PAN_AT) / PAN_SEC);
    const sx = SCREEN_X + this.screen.width / 2;
    this.camera.look = 1;
    this.camera.x = cx + (sx - cx) * k;
    this.camera.close = 1 + (CLOSE_SCREEN - 1) * k;
    this.camera.y = AIM_Y + (AIM_SCREEN - AIM_Y) * k;
    const seep = Math.min(1, Math.max(0, (t - SCREEN_AT) / SCREEN_SEC));
    this.screen.seep = seep * (2 - seep) * 0.9;
    // ink spat out of the panels now and then while it wells up
    const n = Math.floor(seep * 9);
    while (seep > 0 && this.puffs < n) {
      this.puffs++;
      const i = (this.puffs * 37) % 4;
      this.a.set(SCREEN_X + (i + 0.5) * (this.screen.width / 4), 120 + ((this.puffs * 53) % 160), SCREEN_Z + 30);
      this.cx.ink.burst(this.a, this.puffs % 2 ? 1 : -1, 10, 0.35);
    }
    if (t >= OUTRO_SEC && !this.done) {
      this.done = true;
      this.beat = null;
    }
  }
}
