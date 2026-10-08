import { BODIES, HERO, MOVES, TICK_RATE, WORLD, fromFp, type Entity } from '@dnf/engine';
import { ColorMatrixFilter, Container, Graphics, Sprite } from 'pixi.js';
import { floorY, lerp } from './layout';
import type { SpriteSet } from './sprites';
import { TaoActor, type TaoAsset } from './tao/TaoActor';

// One body: a floor shadow, the figure, the brush arc of an active move, a health bar over hurt
// monsters. A rigged body (the hero) plays its skeleton: clip time comes from the sim tick for
// moves, so the cut lands on the active frames and freezes with the hitstop, and from the
// distance covered for walking and running, so the feet stay planted. The other bodies show one
// still painting per state (ink blocks when those did not load), and the motion between them is
// faked here: anticipation lean, bob, squash, tumble. Feedback lives here too: a white flash and
// a shake while frozen by a hit.

const INK = {
  hero: { body: 0x17161a, band: 0xc8281e },
  bandit: { body: 0x6f7480, band: 0x34466b },
  dummy: { body: 0x9a8a68, band: 0x6a5c40 },
} as const;

const PREFIX = { hero: 'hero', bandit: 'mob', dummy: 'dummy' } as const;

/** Brush arc of each move in a right-facing frame: angles in radians from forward (negative is
 * up), centre height above the feet, radius as a share of the box reach. */
const ARCS: Record<string, { a0: number; a1: number; cz: number; r: number; w: number }> = {
  atk1: { a0: -0.9, a1: 0.4, cz: 130, r: 0.8, w: 0.22 },
  atk2: { a0: 0.7, a1: -1.4, cz: 130, r: 0.8, w: 0.22 },
  atk3: { a0: -1.7, a1: 0.8, cz: 140, r: 0.85, w: 0.32 },
  jumpAtk: { a0: -0.7, a1: 1.3, cz: 90, r: 0.9, w: 0.26 },
  upper: { a0: 1.1, a1: -1.8, cz: 120, r: 0.85, w: 0.3 },
  slash: { a0: -1.5, a1: 0.7, cz: 150, r: 0.8, w: 0.26 },
};

/** World height of the rigged hero standing at rest. */
const RIG_HEIGHT = 240;
/** World distance one walk / run cycle (two steps) covers, measured from the stride. */
const WALK_CYCLE = 176;
const RUN_CYCLE = 250;
/** Real seconds of cross-fade into a move or a hit reaction, which must snap, and between other clips. */
const FADE_MOVE = 0.04;
const FADE = 0.1;

/** Paints the sprite pure white, for the hit flash. */
const WHITE = new ColorMatrixFilter();
WHITE.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];

interface Look {
  name: string;
  /** Rotation, positive turns the body forward. */
  rot: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** Rotate about the middle of the body (tumbling) instead of the feet. */
  centre: boolean;
}

export class BodyView {
  readonly root = new Container();
  private readonly shadow = new Graphics();
  private readonly body = new Graphics();
  private readonly sprite = new Sprite();
  private readonly fxg = new Graphics();
  private readonly bar = new Graphics();
  private readonly rigRoot = new Container();
  private readonly actor: TaoActor | null;
  /** Distance walked or run so far, which drives the step cycle, and where it was last frame. */
  private dist = 0;
  private last: { x: number; y: number } | null = null;
  private clock = 0;
  /** Render frames left of the white hit flash, and shake ticks left. */
  flash = 0;
  shake = 0;

  constructor(readonly id: number, private readonly sprites: SpriteSet | null, rig: TaoAsset | null = null) {
    this.actor = rig ? new TaoActor(rig) : null;
    if (this.actor) this.rigRoot.addChild(this.actor.view);
    this.root.addChild(this.shadow, this.body, this.sprite, this.rigRoot, this.fxg, this.bar);
  }

  draw(e: Entity, alpha: number, frame: number, dt: number, debug: boolean): void {
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    const z = lerp(e.pz, e.z, alpha);
    const b = BODIES[e.kind];
    const hw = fromFp(b.halfWidth);
    const h = fromFp(b.height);
    const jitter = this.shake > 0 ? (frame % 2 === 0 ? 5 : -5) : 0;
    this.root.position.set(x + jitter, floorY(y));
    this.root.zIndex = y;
    this.root.alpha = e.state === 'dead' ? Math.max(0, 1 - e.st / WORLD.fadeTicks) : 1;

    const s = this.shadow.clear();
    const shrink = Math.max(0.4, 1 - z / 400);
    s.ellipse(0, 0, hw * 1.6 * shrink, 14 * shrink).fill({ color: 0x2a2620, alpha: 0.22 });

    const g = this.body.clear();
    const fx = this.fxg.clear();
    if (this.actor) {
      this.drawRig(this.actor, e, x, y, z, alpha, dt);
    } else if (this.sprites) {
      this.drawSprite(e, z, frame, alpha);
    } else {
      this.drawBlocks(g, e, z, hw, h);
    }
    if (e.state === 'act') this.strike(fx, e, z, alpha, debug);
    if (debug) fx.rect(-hw, -z - h, hw * 2, h).stroke({ width: 1, color: 0x2a7a3a });

    const bar = this.bar.clear();
    if (e.team === 1 && e.kind !== 'dummy' && e.hp < e.maxHp && e.hp > 0) {
      const w = 90;
      bar.rect(-w / 2, -z - h - 30, w, 8).fill({ color: 0x000000, alpha: 0.35 });
      bar.rect(-w / 2, -z - h - 30, (w * e.hp) / e.maxHp, 8).fill(0x34466b);
    }
  }

  private drawRig(actor: TaoActor, e: Entity, x: number, y: number, z: number, alpha: number, dt: number): void {
    this.clock += dt;
    // a jump of more than a stride between frames is a room change, not a step
    const moved = this.last ? Math.hypot(x - this.last.x, y - this.last.y) : 0;
    this.last = { x, y };
    if (moved < 100) this.dist += moved;
    const sec = (e.st + (e.held ? 0 : alpha)) / TICK_RATE;
    const vz = fromFp(e.vz);
    let clip = 'idle';
    let time = this.clock;
    let fade = FADE;
    let tumble = 0;
    switch (e.state) {
      case 'walk':
        clip = 'walk';
        time = this.dist / WALK_CYCLE;
        break;
      case 'run':
        clip = 'run';
        time = this.dist / RUN_CYCLE;
        break;
      case 'jump':
        clip = 'jump';
        time = Math.min(1, Math.max(0, 0.5 - vz / (2 * fromFp(HERO.jumpVz))));
        break;
      case 'act':
        clip = e.move;
        time = sec;
        fade = FADE_MOVE;
        break;
      case 'hurt':
      case 'getup':
        clip = e.state;
        time = sec;
        if (e.state === 'hurt') fade = FADE_MOVE;
        break;
      case 'air':
        if (z < 30 && vz <= 0) {
          clip = 'down';
          time = 0;
        } else {
          // tumbling backward: leaning back while rising, nearly flat while falling
          clip = 'hurt';
          time = 1;
          tumble = -Math.min(1.4, Math.max(0.25, 0.7 - vz / 40));
        }
        break;
      case 'down':
      case 'dead':
        clip = 'down';
        time = 0;
        break;
    }
    actor.seek(clip, time, dt, fade);
    this.sprite.visible = false;
    const k = RIG_HEIGHT / actor.height;
    const r = this.rigRoot;
    // a tumble turns about the middle of the body, everything else about the feet
    const mid = tumble ? actor.height / 2 : 0;
    r.pivot.set(0, -mid);
    r.position.set(0, -z - mid * k);
    r.scale.set(e.facing * k, k);
    r.rotation = tumble * e.facing;
    r.filters = this.flash > 0 ? [WHITE] : [];
  }

  private drawSprite(e: Entity, z: number, frame: number, alpha: number): void {
    const look = this.look(e, z, frame, alpha);
    if (look.name.endsWith('_down') && !this.sprites!.has(look.name)) {
      // no lying painting yet: the standing one laid on its back
      look.name = `${PREFIX[e.kind]}_idle`;
      look.centre = true;
      look.rot = -Math.PI / 2;
      look.dy = 40;
    }
    const pose =this.sprites!.get(look.name) ?? this.sprites!.get(`${PREFIX[e.kind]}_idle`) ?? this.sprites!.get('dummy');
    const sp = this.sprite;
    if (!pose) {
      sp.visible = false;
      return;
    }
    sp.visible = true;
    sp.texture = pose.tex;
    const { w, h, ax, ay, scale } = pose.info;
    const k = scale;
    if (look.centre) {
      sp.anchor.set(ax / w, 0.5);
      sp.position.set(look.dx * e.facing, -z - ((ay - h / 2) * k * look.sy) + look.dy);
    } else {
      sp.anchor.set(ax / w, ay / h);
      sp.position.set(look.dx * e.facing, -z + look.dy);
    }
    sp.scale.set(e.facing * k * look.sx, k * look.sy);
    sp.rotation = look.rot * e.facing;
    sp.filters = this.flash > 0 ? [WHITE] : [];
  }

  /** Which painting a body shows, and how it is bent to fake the motion around it. */
  private look(e: Entity, z: number, frame: number, alpha: number): Look {
    const p = PREFIX[e.kind];
    const l: Look = { name: `${p}_idle`, rot: 0, dx: 0, dy: 0, sx: 1, sy: 1, centre: false };
    if (e.kind === 'dummy') {
      l.name = 'dummy';
      if (e.state === 'hurt') l.rot = -0.08 * Math.max(0, 1 - e.st / 8);
      return l;
    }
    const t = e.st + alpha;
    const vz = fromFp(e.vz);
    switch (e.state) {
      case 'idle':
        l.sy = 1 + 0.012 * Math.sin(frame / 14);
        break;
      case 'walk':
        l.dy = -Math.abs(Math.sin(t * 0.45)) * 5;
        l.rot = 0.03;
        break;
      case 'run':
        l.name = `${p}_run`;
        l.dy = -Math.abs(Math.sin(t * 0.6)) * 7;
        break;
      case 'jump':
        l.name = `${p}_jump`;
        l.rot = vz > 0 ? -0.05 : 0.08;
        break;
      case 'act': {
        const m = MOVES[e.move];
        const windup = e.st < m.active[0];
        if (e.kind === 'bandit') {
          l.name = windup ? `${p}_windup` : `${p}_slash`;
          if (windup) l.rot = -0.1 * (t / m.active[0]);
        } else {
          l.name = `${p}_${e.move.toLowerCase()}`;
          // anticipation: lean back before the cut, snap forward on its first active tick
          if (windup) {
            l.rot = -0.07;
            l.dx = -6;
          } else {
            const since = t - m.active[0];
            l.dx = 8 * Math.max(0, 1 - since / 4);
          }
        }
        break;
      }
      case 'hurt':
        l.name = `${p}_hurt`;
        l.dx = -4 * Math.max(0, 1 - t / 6);
        break;
      case 'air':
        if (z < 30 && vz <= 0) {
          l.name = `${p}_down`;
        } else {
          // tumbling backward: leaning back while rising, nearly flat while falling
          l.name = `${p}_hurt`;
          l.centre = true;
          l.rot = -Math.min(1.4, Math.max(0.25, 0.7 - vz / 40));
        }
        break;
      case 'down':
      case 'dead':
        l.name = `${p}_down`;
        break;
      case 'getup':
        l.sy = 0.75 + 0.25 * Math.min(1, t / WORLD.getupTicks);
        break;
    }
    return l;
  }

  private drawBlocks(g: Graphics, e: Entity, z: number, hw: number, h: number): void {
    const ink = INK[e.kind];
    const white = this.flash > 0;
    const color = white ? 0xfaf7ef : ink.body;
    if (e.state === 'down' || e.state === 'dead' || (e.state === 'air' && z < 30 && e.vz <= 0)) {
      // lying flat, head toward the attacker's side
      g.rect(-h / 2, -42 - z, h, 42).fill(color);
      g.rect(e.facing > 0 ? -h / 2 : h / 2 - 34, -42 - z, 34, 42).fill(white ? color : ink.band);
    } else {
      const squat = e.state === 'getup' ? 0.6 : e.state === 'hurt' ? 0.92 : 1;
      const top = -z - h * squat;
      g.rect(-hw, top, hw * 2, h * squat).fill(color);
      g.rect(-hw, top + 26, hw * 2, 18).fill(white ? color : ink.band);
      // facing mark at head height
      const fx = e.facing * hw;
      g.poly([fx, top + 8, fx + e.facing * 16, top + 18, fx, top + 28]).fill(white ? color : ink.band);
    }
  }

  /** The active part of a move: a brush arc sweeping through its hit box (the box in debug). */
  private strike(g: Graphics, e: Entity, z: number, alpha: number, debug: boolean): void {
    const m = MOVES[e.move];
    const box = m.box;
    const x0 = fromFp(box.x0);
    const x1 = fromFp(box.x1);
    const active = e.st >= m.active[0] && e.st <= m.active[1];
    if (debug) {
      const left = e.facing > 0 ? x0 : -x1;
      g.rect(left, -z - fromFp(box.z1), x1 - x0, fromFp(box.z1 - box.z0)).stroke({ width: 2, color: active ? 0xc8281e : 0x888888 });
    }
    const span = m.active[1] - m.active[0] + 1;
    const since = e.st + alpha - m.active[0];
    if (since < 0 || since > span + 3) return;
    const grow = Math.min(1, (since + 1) / span);
    const fade = since > span ? 1 - (since - span) / 3 : 1;
    const color = e.team === 0 ? 0x111014 : 0x34466b;
    const arc = ARCS[e.move];
    if (!arc) {
      // the dash: one long tapering stroke along the thrust
      const f = e.facing;
      const mid = -z - 120;
      g.poly([f * x0, mid - 3, f * x1 * grow, mid - 14, f * x1 * grow * 1.06, mid, f * x1 * grow, mid + 10, f * x0, mid + 3]).fill({ color, alpha: 0.8 * fade });
      return;
    }
    const r = x1 * arc.r;
    const cx = 10 * e.facing;
    const cy = -z - arc.cz;
    const a1 = arc.a0 + (arc.a1 - arc.a0) * grow;
    const n = 18;
    const pts: number[] = [];
    // outer edge from the tail to the leading edge, then the inner edge back
    for (let i = 0; i <= n; i++) {
      const a = arc.a0 + ((a1 - arc.a0) * i) / n;
      pts.push(cx + e.facing * Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    for (let i = n; i >= 0; i--) {
      const u = i / n;
      const a = arc.a0 + (a1 - arc.a0) * u;
      // thick at the leading edge, thinning to a dry tail
      const w = r * arc.w * Math.pow(u, 0.7);
      pts.push(cx + e.facing * Math.cos(a) * (r - w), cy + Math.sin(a) * (r - w));
    }
    g.poly(pts).fill({ color, alpha: 0.82 * fade });
  }

  /** Called once per sim tick. */
  tick(): void {
    if (this.shake > 0) this.shake--;
  }

  /** Called once per render frame. */
  frame(): void {
    if (this.flash > 0) this.flash--;
  }
}
