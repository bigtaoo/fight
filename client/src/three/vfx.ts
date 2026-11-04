import { BODIES, INK as INK_DEF, MOVES, fromFp, type Entity, type SimEvent, type SimState } from '@dnf/engine';
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { telegraphed } from '../game/telegraph';
import { DEPTH_K, type Actor, type Model } from './actor';
import { Ghosts } from './ghosts';
import { CINNABAR, INK, RAMP, bakeTone } from './ink';
import { Marks } from './marks';
import { Particles } from './particles';
import { GLOW_MAP } from './props';
import type { Post } from './post';
import type { SceneId } from './stage';

// Everything the effects add to a fight, driven by the engine's events and state (they only draw:
// nothing here goes back into the game). Hits leave a brush cut over the target, sparks and a blot
// of ink on the floor; skills throw ink rings and speed lines; the dead break up into ink and
// smoke; arrows, sword waves and quakes get bodies of their own; and each scene has its own air:
// incense smoke, motes and shafts of light in the hall, embers over the fort, leaves on the road.

export type Air = SceneId;

/** The moves a dash leaves afterimages on. */
const DASH = new Set(['tri1', 'tri2', 'tri3', 'dragon1', 'dragon2', 'dragon3', 'dragon4', 'iai', 'phantom', 'backstep', 'upper', 'crush2']);

const _v = new Vector3();
const _w = new Vector3();
const _c = new Color();
const _up = new Vector3(0, 1, 0);
const HOT = new Color(2.4, 1.5, 0.7);
const BLOCK = new Color(2.2, 1.1, 0.35);
const RED_HOT = new Color(2.2, 0.28, 0.12);

/** An arrow: shaft, head and fletching, along +x. */
function arrowMesh(): Group {
  const g = new Group();
  const ink = new MeshBasicMaterial({ color: INK });
  const shaft = new Mesh(new CylinderGeometry(1.4, 1.4, 90, 5).rotateZ(Math.PI / 2), ink);
  const head = new Mesh(new ConeGeometry(4, 14, 6).rotateZ(-Math.PI / 2).translate(52, 0, 0), ink);
  const fl = new Mesh(new PlaneGeometry(18, 7).translate(-38, 0, 0), new MeshBasicMaterial({ color: 0xd8d2c4, side: 2 }));
  g.add(shaft, head, fl);
  return g;
}

/** The pheasant's thrown tail feather, along +x from its quill: a long cinnabar vane barred with ink
 * towards the tip, its rachis drawn down the middle, like the tail it came from. */
const FEATHER = (() => {
  const vane = new Shape();
  vane.moveTo(0, 0);
  vane.bezierCurveTo(30, 13, 110, 12, 150, 0);
  vane.bezierCurveTo(110, -12, 30, -13, 0, 0);
  const bars = [84, 102, 120].map((x) => {
    const w = 10 - (x - 84) / 9;
    return new Shape([new Vector2(x, -w), new Vector2(x + 7, -w), new Vector2(x + 9, w), new Vector2(x + 2, w)]);
  });
  return {
    vane: new ShapeGeometry(vane, 10),
    bars: new ShapeGeometry(bars).translate(0, 0, 0.5),
    rachis: new PlaneGeometry(150, 2).translate(75, 0, 1),
    red: new MeshBasicMaterial({ color: 0xd8301c, side: DoubleSide }),
    ink: new MeshBasicMaterial({ color: 0x2a1a14, side: DoubleSide }),
  };
})();
function featherMesh(): Group {
  const g = new Group();
  g.add(new Mesh(FEATHER.vane, FEATHER.red), new Mesh(FEATHER.bars, FEATHER.ink), new Mesh(FEATHER.rachis, FEATHER.ink));
  return g;
}

/** A line from the fisher's hand: a unit-long thread along +y, stretched and turned between two points. */
const ROPE_GEO = new CylinderGeometry(1.2, 1.2, 1, 4).translate(0, 0.5, 0);
const ROPE_MAT = new MeshBasicMaterial({ color: INK });
/** A ball of ink in flight, and where it will land: a ring closing in on the floor. */
const BLOB_GEO = new SphereGeometry(18, 10, 8);
const BLOB_MAT = new MeshBasicMaterial({ color: INK });
const AIM_GEO = new RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
/** Ink left on the ground: a flat blot, its size the patch's reach. */
const BLOT_GEO = new CircleGeometry(1, 28).rotateX(-Math.PI / 2);

/** A gourd of medicine, lit from within (red for a potion, gold for a big one). */
const GOURD_GEO = new LatheGeometry(
  [[0, 0], [16, 3], [20, 14], [17, 26], [9, 32], [8, 36], [12, 42], [13, 50], [9, 57], [3, 60], [3, 66], [0, 66]].map(([r, h]) => new Vector2(r, h)),
  16,
);
function gourd(color: number, glow: number): Group {
  const g = new Group();
  const m = new MeshToonMaterial({ color, gradientMap: RAMP });
  m.onBeforeCompile = bakeTone;
  const body = new Mesh(GOURD_GEO, m);
  const cord = new Mesh(new CylinderGeometry(9.5, 9.5, 4, 12).translate(0, 34, 0), new MeshBasicMaterial({ color: CINNABAR }));
  const halo = new Sprite(new SpriteMaterial({ map: GLOW_MAP, color: glow, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
  halo.position.y = 30;
  halo.scale.setScalar(150);
  halo.name = 'halo';
  g.add(body, cord, halo);
  return g;
}

/** A shaft of light through the hall's high windows: a soft slanted band, added on. */
function shaft(): Mesh {
  const m = new ShaderMaterial({
    uniforms: { time: { value: 0 }, seed: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float seed;
      varying vec2 vUv;
      void main() {
        float across = sin(3.14159 * vUv.x);
        float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float drift = 0.8 + 0.2 * sin(time * 0.6 + seed + vUv.x * 5.0);
        float a = across * across * along * drift * 0.16;
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const s = new Mesh(new PlaneGeometry(260, 1500), m);
  s.renderOrder = 4.5;
  return s;
}

interface Later {
  at: number;
  run: () => void;
}

export class Vfx {
  readonly root = new Group();
  private readonly smoke = new Particles('wash', 640, INK);
  private readonly dust = new Particles('wash', 384, 0x8a8070);
  private readonly sparks = new Particles('glow', 768, 0xffffff);
  private readonly motes = new Particles('glow', 160, 0xffffff, false);
  private readonly leaves = new Particles('leaf', 120, INK, false);
  private readonly cut = new Marks('slash', 48);
  /** The burning edge of a heavy cut: laid over (not added, which bleaches to white on paper) in a
   * red past white, so the bloom still catches it. */
  private readonly burn = new Marks('slash', 48);
  private readonly stain = new Marks('stain', 96, true);
  private readonly ghosts: Ghosts;
  private readonly shafts: Mesh[] = [];
  private readonly arrows = new Map<number, Group>();
  private readonly arrowPool: Group[] = [];
  private readonly feathers = new Map<number, Group>();
  private readonly featherPool: Group[] = [];
  private readonly items = new Map<number, Group>();
  private readonly ropes: Mesh[] = [];
  private readonly blobs = new Map<number, Mesh>();
  private readonly aims = new Map<number, Mesh>();
  private readonly blots = new Map<number, Mesh>();
  private readonly later: Later[] = [];
  private air: Air = 'road';
  private time = 0;
  private puff = 0;
  private ambient = 0;
  private ghostAt = 0;
  /** A push of the camera towards the action (0..1), decaying; proto shortens its distance by it. */
  punch = 0;

  constructor(
    hero: Model,
    private readonly post: Post | null,
  ) {
    this.ghosts = new Ghosts(hero, 6);
    for (const p of [this.smoke, this.dust, this.sparks, this.motes, this.leaves]) this.root.add(p.points);
    for (const m of [this.cut, this.burn, this.stain]) this.root.add(m.mesh);
    this.root.add(this.ghosts.root);
    for (let i = 0; i < 3; i++) {
      const s = shaft();
      (s.material as ShaderMaterial).uniforms.seed.value = i * 2.1;
      s.visible = false;
      this.shafts.push(s);
      this.root.add(s);
    }
    for (let i = 0; i < 6; i++) this.arrowPool.push(arrowMesh());
  }

  /** Everything shown at once for a frame, so all of its shaders build at the start. */
  warm(on: boolean): Object3D[] {
    this.ghosts.warm(on);
    for (const s of this.shafts) s.visible = on;
    for (const p of [this.smoke, this.dust, this.sparks, this.motes, this.leaves]) p.points.visible = on;
    for (const m of [this.cut, this.burn, this.stain]) m.mesh.visible = on;
    if (!on) return [];
    const extra = [this.arrowPool[0], gourd(0xb3261e, 0xff5030)];
    for (const o of extra) this.root.add(o);
    return extra;
  }

  /** The scene's air, in a room `roomW` wide. */
  setScene(air: Air, roomW: number): void {
    this.air = air;
    this.shafts.forEach((s, i) => {
      s.visible = air === 'hall';
      s.position.set(roomW * (0.2 + i * 0.3), 700, 140 + i * 40);
      s.rotation.z = -0.42;
    });
  }

  /** Drops what belongs to the last room. */
  clear(): void {
    for (const a of this.arrows.values()) {
      a.removeFromParent();
      this.arrowPool.push(a);
    }
    this.arrows.clear();
    for (const f of this.feathers.values()) {
      f.removeFromParent();
      this.featherPool.push(f);
    }
    this.feathers.clear();
    for (const g of this.items.values()) g.removeFromParent();
    this.items.clear();
    for (const m of [this.blobs, this.aims, this.blots]) {
      for (const o of m.values()) o.removeFromParent();
      m.clear();
    }
  }

  private at(x: number, y: number, z: number, up = 0): Vector3 {
    return _v.set(fromFp(x), fromFp(z) + up, fromFp(y) * DEPTH_K);
  }

  onEvent(ev: SimEvent, s: SimState, actors: Map<number, Actor>): void {
    const post = this.post;
    switch (ev.type) {
      case 'hit': {
        const p = this.at(ev.x, ev.y, ev.z, 120);
        const heavy = ev.launch || ev.stop >= 5;
        const sp = this.sparks;
        // the cut: one brush stroke across the target, mirrored for a hit from the other side
        if (!ev.blocked) {
          const ang = (sp.rand() - 0.5) * 1.1 + (heavy ? 0.5 : 0);
          this.cut.add(p, heavy ? 150 : 115, ang, ev.crit ? CINNABAR : INK, 0.34, 0.92, ev.dir);
          if (ev.crit || heavy) this.burn.add(_w.copy(p).setZ(p.z + 4), heavy ? 155 : 120, ang, RED_HOT, 0.28, 0.7, ev.dir);
        }
        // sparks fly on along the blow, and orange off a shield
        const n = ev.blocked ? 30 : heavy ? 40 : 22;
        for (let i = 0; i < n; i++) {
          const a = (sp.rand() - 0.5) * (ev.blocked ? 2.4 : 1.4);
          const v = (ev.blocked ? 500 : 700) * (0.4 + sp.rand());
          sp.add({
            x: p.x, y: p.y + (sp.rand() - 0.5) * 30, z: p.z + 10,
            vx: Math.cos(a) * v * ev.dir, vy: Math.sin(a) * v + 120, vz: (sp.rand() - 0.5) * 300,
            size: 7 + sp.rand() * 7, life: 0.25 + sp.rand() * 0.3, alpha: 1, color: ev.blocked ? BLOCK : HOT, lift: -1400, drag: 3,
          });
        }
        // a burst of ink round the point of impact, in the screen's plane: a ring of wash that
        // spreads and fades, and a few heavy drops thrown back along the blow
        const ring = ev.blocked ? 6 : heavy ? 12 : 8;
        for (let i = 0; i < ring; i++) {
          const a = (i / ring) * Math.PI * 2 + this.smoke.rand() * 0.4;
          const v = (heavy ? 520 : 360) * (0.7 + this.smoke.rand() * 0.5);
          this.smoke.add({ x: p.x, y: p.y, z: p.z + 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: heavy ? 40 : 28, grow: 120, life: 0.32, alpha: ev.blocked ? 0.25 : 0.5, drag: 7, color: ev.crit ? CINNABAR : INK });
        }
        if (!ev.blocked)
          for (let i = 0; i < (heavy ? 10 : 6); i++) {
            const a = (sp.rand() - 0.5) * 1.6;
            const v = 520 * (0.5 + sp.rand());
            this.smoke.add({ x: p.x, y: p.y, z: p.z + 8, vx: Math.cos(a) * v * ev.dir, vy: Math.sin(a) * v + 260, vz: (sp.rand() - 0.5) * 200, size: 10 + sp.rand() * 10, life: 0.5 + sp.rand() * 0.3, alpha: 0.9, lift: -1600, drag: 1.5, color: ev.crit ? CINNABAR : INK });
          }
        if (!ev.blocked) {
          // ink flung to the floor behind the target
          const f = this.at(ev.x, ev.y, 0);
          f.x += ev.dir * (30 + sp.rand() * 60);
          f.y = 0.8 + (this.stain.rand() * 0.2);
          this.stain.add(f, heavy ? 120 : 80, sp.rand() * 6.28, ev.crit ? CINNABAR : INK, 7, heavy ? 0.55 : 0.4);
        }
        if (post) {
          if (heavy) {
            post.ca = Math.max(post.ca, 1);
            post.smear = Math.max(post.smear, 0.35);
            this.punch = Math.max(this.punch, 1);
          } else if (!ev.blocked) post.ca = Math.max(post.ca, 0.35);
          if (ev.crit) {
            post.impact = Math.max(post.impact, 0.05);
            post.flash = Math.max(post.flash, 0.22);
          }
        }
        break;
      }
      case 'swing': {
        const m = MOVES[ev.move];
        const e = s.entities.find((b) => b.id === ev.id);
        if (e && e.team !== 0 && telegraphed(ev.move)) {
          // a monster winding up a heavy blow: a flick of cinnabar over its head, the warning to dodge
          const a = actors.get(ev.id);
          const c = a ? _w.copy(a.root.position) : _w.copy(this.at(e.x, e.y, 0));
          c.y += fromFp(BODIES[e.kind].height) * 0.85;
          c.z += 6;
          this.burn.add(c, 120, 0.5 * e.facing, RED_HOT, 0.6, 1, 1.6);
          this.cut.add(c.setZ(c.z + 2), 90, -0.6 * e.facing, RED_HOT, 0.5, 0.9, 1.3);
          break;
        }
        if (!m?.of || !e) break;
        // a skill: ink kicked up round the feet and speed lines
        const f = this.at(e.x, e.y, 0);
        this.smoke.ring(f, 14, 380, { size: 50, grow: 140, life: 0.7, alpha: 0.35, drag: 3, lift: 60 });
        if (post) post.speed = Math.max(post.speed, 0.7);
        if (ev.move === 'iai') {
          // the draw lands on its active ticks: one long red cut across the screen, and a frame of ink
          const dir = e.facing;
          this.later.push({
            at: this.time + 14 / 30,
            run: () => {
              const a = actors.get(ev.id);
              const c = a ? _w.copy(a.root.position) : _w.copy(f);
              c.y += 120;
              c.x += dir * 150;
              this.cut.add(c, 120, 0.04 * dir, INK, 0.45, 1, 4.2 * dir);
              this.burn.add(c.setZ(c.z + 4), 90, 0.04 * dir, RED_HOT, 0.4, 0.75, 4.2 * dir);
              if (post) {
                post.impact = Math.max(post.impact, 0.08);
                post.flash = Math.max(post.flash, 0.35);
                post.speed = 1;
              }
              this.punch = 1.4;
            },
          });
        }
        break;
      }
      case 'land':
      case 'down': {
        const e = s.entities.find((b) => b.id === ev.id);
        if (!e) break;
        this.dust.ring(this.at(e.x, e.y, 0), ev.type === 'down' ? 16 : 9, ev.type === 'down' ? 320 : 220, { size: 40, grow: 90, life: 0.8, alpha: 0.45, drag: 3.5, lift: 30 });
        break;
      }
      case 'death': {
        const e = s.entities.find((b) => b.id === ev.id);
        if (!e) break;
        const f = this.at(e.x, e.y, 0);
        _w.copy(f);
        _w.y = 1;
        this.stain.add(_w, 190, this.stain.rand() * 6.28, INK, 10, 0.6);
        // the body goes up in a puff of ink: wash rising off it, drops flung wide, dust on the floor
        const sm = this.smoke;
        for (let i = 0; i < 22; i++)
          sm.add({ x: f.x + (sm.rand() - 0.5) * 90, y: 40 + sm.rand() * 180, z: f.z + (sm.rand() - 0.5) * 40, vx: (sm.rand() - 0.5) * 160, vy: 80 + sm.rand() * 160, size: 60 + sm.rand() * 50, grow: 110, life: 0.9 + sm.rand() * 0.5, alpha: 0.4, drag: 2, lift: 40, sway: 12 });
        for (let i = 0; i < 16; i++) {
          const a = sm.rand() * Math.PI;
          const v = 380 + sm.rand() * 420;
          sm.add({ x: f.x, y: 120, z: f.z + 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: (sm.rand() - 0.5) * 300, size: 9 + sm.rand() * 9, life: 0.7, alpha: 0.9, lift: -1500, drag: 1 });
        }
        this.dust.ring(f, 14, 300, { size: 46, grow: 100, life: 0.9, alpha: 0.4, drag: 3.5, lift: 25 });
        break;
      }
      case 'fire': {
        const shot = s.shots.find((p) => p.id === ev.id);
        if (shot?.kind === 'wave' && post) post.speed = Math.max(post.speed, 0.6);
        // the loose: a puff off the bow and a few sparks ahead of the arrow
        if (shot) {
          const p = this.at(shot.x, shot.y, shot.z);
          const d = shot.vx >= 0 ? 1 : -1;
          for (let i = 0; i < 6; i++)
            this.smoke.add({ x: p.x, y: p.y, z: p.z + 6, vx: d * (120 + this.smoke.rand() * 200), vy: (this.smoke.rand() - 0.3) * 120, size: 30, grow: 90, life: 0.45, alpha: 0.3, drag: 4 });
          for (let i = 0; i < 5; i++)
            this.sparks.add({ x: p.x, y: p.y, z: p.z + 8, vx: d * (500 + this.sparks.rand() * 400), vy: (this.sparks.rand() - 0.5) * 160, size: 6, life: 0.18, alpha: 1, color: HOT, drag: 5 });
        }
        break;
      }
      case 'splash': {
        // the ink ball bursts: drops flung low and a stain left under the patch
        const f = this.at(ev.x, ev.y, 0);
        this.stain.add(_w.set(f.x, 0.8, f.z), 170, this.stain.rand() * 6.28, INK, 4, 0.5, 1.6);
        for (let i = 0; i < 14; i++) {
          const a = this.smoke.rand() * Math.PI;
          const v = 240 + this.smoke.rand() * 260;
          this.smoke.add({ x: f.x, y: 20, z: f.z + 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: (this.smoke.rand() - 0.5) * 200, size: 10 + this.smoke.rand() * 8, life: 0.55, alpha: 0.9, lift: -1400, drag: 1 });
        }
        this.dust.ring(f, 10, 220, { size: 40, grow: 90, life: 0.6, alpha: 0.3, drag: 3.5, lift: 20 });
        break;
      }
      case 'pickup': {
        const e = s.entities.find((b) => b.id === ev.id);
        if (!e) break;
        const p = this.at(e.x, e.y, e.z, 60);
        for (let i = 0; i < 18; i++)
          this.motes.add({ x: p.x + (this.motes.rand() - 0.5) * 80, y: p.y + this.motes.rand() * 100, z: p.z + 20, vy: 160 + this.motes.rand() * 160, size: 10, life: 0.9, alpha: 1.6, color: 0x60ff90, drag: 1 });
        break;
      }
      case 'roomEnter':
        this.clear();
        break;
    }
  }

  /** Moves everything on `dt` seconds, with the camera centred on `camX`. */
  update(dt: number, s: SimState, actors: Map<number, Actor>, pxPerUnit: number, camX: number, alpha: number): void {
    this.time += dt;
    const t = this.time;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.later[i].at > t) continue;
      this.later[i].run();
      this.later.splice(i, 1);
    }
    this.punch = Math.max(0, this.punch - dt * 5);

    this.puff -= dt;
    this.ghostAt -= dt;
    const puff = this.puff <= 0;
    if (puff) this.puff = 0.07;
    for (const e of s.entities) {
      const a = actors.get(e.id);
      if (!a) continue;
      this.body(e, a, puff, dt);
    }
    if (this.ghostAt <= 0) this.ghostAt = 0.055;

    this.shots(s, dt, alpha);
    this.ink(s, alpha, actors);
    this.floor(s, t);
    this.weather(dt, camX, t);
    for (const sh of this.shafts) (sh.material as ShaderMaterial).uniforms.time.value = t;

    for (const p of [this.smoke, this.dust, this.sparks, this.motes, this.leaves]) {
      p.update(dt, pxPerUnit, t);
      p.points.visible = p.count > 0;
    }
    for (const m of [this.cut, this.burn, this.stain]) {
      m.update(dt);
      m.mesh.visible = m.count > 0;
    }
    this.ghosts.update(dt);
  }

  /** What a body leaves as it moves: dust when running, afterimages on a dash, ink when dying. */
  private body(e: Entity, a: Actor, puff: boolean, dt: number): void {
    const p = a.root.position;
    if (e.state === 'run' && puff && p.y < 2) {
      this.dust.add({ x: p.x - e.facing * 20, y: 6, z: p.z + 6, vx: -e.facing * 80, vy: 30, size: 34, grow: 70, life: 0.55, alpha: 0.32, drag: 2 });
    }
    // only on a dash: every afterimage is a whole body more to draw (19k triangles on a phone)
    if (e.team === 0 && this.ghostAt <= 0 && e.state === 'act' && DASH.has(e.move)) {
      this.ghosts.leave(a.pose3d, 0.42);
    }
    if (e.state === 'dead') {
      a.dissolve = Math.min(1, Math.max(0, (e.st - 6) / 30));
      if (a.dissolve > 0 && a.dissolve < 1) {
        // ink smoke and burning motes coming off the breaking body, from the head down
        const top = 220 * (1 - a.dissolve);
        const n = dt > 0 ? 2 : 0;
        for (let i = 0; i < n; i++) {
          this.smoke.add({ x: p.x + (this.smoke.rand() - 0.5) * 70, y: p.y + this.smoke.rand() * top, z: p.z + 10, vx: (this.smoke.rand() - 0.5) * 60, vy: 90, size: 40, grow: 110, life: 1.1, alpha: 0.4, drag: 1, sway: 30 });
          this.motes.add({ x: p.x + (this.motes.rand() - 0.5) * 60, y: p.y + top, z: p.z + 14, vx: (this.motes.rand() - 0.5) * 80, vy: 140 + this.motes.rand() * 120, size: 9, life: 0.9, alpha: 1.8, color: RED_HOT, drag: 1, sway: 40 });
        }
      }
    } else a.dissolve = 0;
  }

  /** The projectiles' own bodies and trails. */
  private shots(s: SimState, dt: number, alpha: number): void {
    const live = new Set<number>();
    for (const sh of s.shots) {
      live.add(sh.id);
      const x = fromFp(sh.px + (sh.x - sh.px) * alpha);
      const y = fromFp(sh.pz + (sh.z - sh.pz) * alpha);
      const z = fromFp(sh.py + (sh.y - sh.py) * alpha) * DEPTH_K;
      const dir = sh.vx >= 0 ? 1 : -1;
      if (sh.kind === 'arrow') {
        let g = this.arrows.get(sh.id);
        if (!g) {
          g = this.arrowPool.pop() ?? arrowMesh();
          this.arrows.set(sh.id, g);
          this.root.add(g);
        }
        g.position.set(x, y, z);
        g.scale.x = dir;
        if (this.sparks.rand() < 0.7)
          this.sparks.add({ x: x - dir * 40, y, z, vx: -dir * 60, size: 6, life: 0.18, alpha: 0.5, color: 0xffd8a0 });
      } else if (sh.kind === 'wave') {
        // a crescent of the brush flying on, burning at its edge, smoke behind it
        if (this.sparks.rand() < 0.6) {
          this.cut.add(_v.set(x, y + 20, z), 130, 1.45 * dir, INK, 0.22, 0.6, dir);
          this.burn.add(_v.set(x + dir * 6, y + 20, z + 4), 130, 1.45 * dir, RED_HOT, 0.16, 0.5, dir);
        }
        this.smoke.add({ x: x - dir * 30, y: y + (this.smoke.rand() - 0.2) * 120, z: z - 10, vx: -dir * 50, vy: 40, size: 50, grow: 120, life: 0.6, alpha: 0.25, drag: 2 });
      } else if (sh.kind === 'feather') {
        // the pheasant's tail feather, quill first, its vane rocking as it flies; a gold wake behind
        let g = this.feathers.get(sh.id);
        if (!g) {
          g = this.featherPool.pop() ?? featherMesh();
          this.feathers.set(sh.id, g);
          this.root.add(g);
        }
        g.position.set(x + dir * 70, y, z);
        g.scale.x = -dir;
        g.rotation.x = Math.sin((g.userData.t = (g.userData.t ?? 0) + dt) * 12) * 0.7;
        this.sparks.add({ x: x - dir * 70, y, z, vx: -dir * 40, size: 18, life: 0.12, alpha: 0.7, color: 0xe0a040 });
        if (this.sparks.rand() < 0.6) this.sparks.add({ x: x - dir * 40, y: y + (this.sparks.rand() - 0.5) * 20, z, vx: -dir * 80, size: 10, life: 0.25, alpha: 0.6, color: 0x302820 });
      } else {
        // a quake runs along the floor: dust thrown up and cracks of ink left behind
        this.dust.add({ x: x + (this.dust.rand() - 0.5) * 60, y: 4, z: z + (this.dust.rand() - 0.5) * 60, vx: (this.dust.rand() - 0.5) * 120, vy: 200 + this.dust.rand() * 200, size: 46, grow: 100, life: 0.8, alpha: 0.4, lift: -300, drag: 1.5 });
        if (this.stain.rand() < dt * 14) this.stain.add(_v.set(x, 0.9, z), 70, this.stain.rand() * 6.28, INK, 3, 0.35, 1.8);
      }
    }
    for (const [id, g] of this.arrows) {
      if (live.has(id)) continue;
      g.removeFromParent();
      this.arrowPool.push(g);
      this.arrows.delete(id);
    }
    for (const [id, g] of this.feathers) {
      if (live.has(id)) continue;
      g.removeFromParent();
      this.featherPool.push(g);
      this.feathers.delete(id);
    }
  }

  /** The village's ink: lines from the fisher to his hook or to whoever it has caught, balls of
   * ink in flight with rings closing in where they will land, and blots left on the ground. */
  private ink(s: SimState, alpha: number, actors: Map<number, Actor>): void {
    const lerp = (p: number, c: number) => fromFp(p + (c - p) * alpha);
    // from the tip of the rod in his hand, or about where his hand would be
    const hand = (e: Entity) => actors.get(e.id)?.rodTip(_w) ?? _w.set(lerp(e.px, e.x) + e.facing * 40, lerp(e.pz, e.z) + 140, lerp(e.py, e.y) * DEPTH_K + 4);
    let n = 0;
    const rope = (from: Vector3, x: number, y: number, z: number) => {
      let m = this.ropes[n];
      if (!m) {
        m = new Mesh(ROPE_GEO, ROPE_MAT);
        this.ropes.push(m);
        this.root.add(m);
      }
      n++;
      _v.set(x, y, z).sub(from);
      m.visible = true;
      m.position.copy(from);
      m.scale.set(1, Math.max(1, _v.length()), 1);
      m.quaternion.setFromUnitVectors(_up, _v.normalize());
    };
    for (const sh of s.shots) {
      if (sh.kind !== 'hook') continue;
      const o = s.entities.find((b) => b.id === sh.owner);
      if (o && o.hp > 0) rope(hand(o), lerp(sh.px, sh.x), lerp(sh.pz, sh.z), lerp(sh.py, sh.y) * DEPTH_K);
    }
    for (const e of s.entities) {
      if (e.tow === 0) continue;
      const o = s.entities.find((b) => b.id === e.towBy);
      if (o && o.hp > 0) rope(hand(o), lerp(e.px, e.x), lerp(e.pz, e.z) + 120, lerp(e.py, e.y) * DEPTH_K);
    }
    for (let i = n; i < this.ropes.length; i++) this.ropes[i].visible = false;

    const live = new Set<number>();
    const T = INK_DEF.lob.flight;
    for (const l of s.lobs) {
      live.add(l.id);
      let b = this.blobs.get(l.id);
      let r = this.aims.get(l.id);
      if (!b || !r) {
        b = new Mesh(BLOB_GEO, BLOB_MAT);
        r = new Mesh(AIM_GEO, new MeshBasicMaterial({ color: CINNABAR, transparent: true, depthWrite: false, toneMapped: false }));
        r.renderOrder = 1;
        this.blobs.set(l.id, b);
        this.aims.set(l.id, r);
        this.root.add(b, r);
      }
      b.position.set(lerp(l.px, l.x), lerp(l.pz, l.z), lerp(l.py, l.y) * DEPTH_K);
      // the ring closes in on the landing spot as the ball comes down
      const k = Math.min(1, (l.t + alpha) / T);
      const w = fromFp(INK_DEF.lob.x) * (1.6 - 0.6 * k);
      r.position.set(fromFp(l.tx), 1.2, fromFp(l.ty) * DEPTH_K);
      r.scale.set(w, 1, (w * fromFp(INK_DEF.lob.y)) / fromFp(INK_DEF.lob.x));
      (r.material as MeshBasicMaterial).opacity = 0.35 + 0.5 * k;
    }
    for (const [id, b] of this.blobs) {
      if (live.has(id)) continue;
      b.removeFromParent();
      this.aims.get(id)?.removeFromParent();
      this.blobs.delete(id);
      this.aims.delete(id);
    }

    live.clear();
    const pa = INK_DEF.patch;
    for (const c of s.patches) {
      live.add(c.id);
      let m = this.blots.get(c.id);
      if (!m) {
        m = new Mesh(BLOT_GEO, new MeshBasicMaterial({ color: INK, transparent: true, depthWrite: false, toneMapped: false }));
        m.renderOrder = 1;
        this.blots.set(c.id, m);
        this.root.add(m);
      }
      m.position.set(fromFp(c.x), 1, fromFp(c.y) * DEPTH_K);
      m.scale.set(fromFp(pa.x), 1, fromFp(pa.y) * DEPTH_K * 1.6);
      // fades over its last second
      (m.material as MeshBasicMaterial).opacity = 0.55 * Math.min(1, c.life / 30);
    }
    for (const [id, m] of this.blots) {
      if (live.has(id)) continue;
      m.removeFromParent();
      this.blots.delete(id);
    }
  }

  /** Gourds on the floor, and poison clouds. */
  private floor(s: SimState, t: number): void {
    const live = new Set<number>();
    for (const it of s.items) {
      live.add(it.id);
      let g = this.items.get(it.id);
      if (!g) {
        g = it.kind === 'bigPotion' ? gourd(0xc89a30, 0xffc040) : gourd(0xb3261e, 0xff5030);
        this.items.set(it.id, g);
        this.root.add(g);
      }
      g.position.set(fromFp(it.x), 8 + Math.sin(t * 3 + it.id) * 6, fromFp(it.y) * DEPTH_K);
      g.rotation.y = t * 1.2;
      const halo = g.getObjectByName('halo') as Sprite;
      (halo.material as SpriteMaterial).opacity = 0.6 + Math.sin(t * 5 + it.id) * 0.2;
    }
    for (const [id, g] of this.items) {
      if (live.has(id)) continue;
      g.removeFromParent();
      this.items.delete(id);
    }
    for (const c of s.clouds) {
      if (this.smoke.rand() > 0.5) continue;
      const x = fromFp(c.x) + (this.smoke.rand() - 0.5) * 260;
      const z = fromFp(c.y) * DEPTH_K + (this.smoke.rand() - 0.5) * 260;
      this.smoke.add({ x, y: 10, z, vy: 40, size: 90, grow: 120, life: 1.4, alpha: 0.28, color: 0x3a5a2a, sway: 40 });
    }
  }

  /** The scene's own air, round the camera. */
  private weather(dt: number, camX: number, t: number): void {
    this.ambient += dt;
    const step = 0.05;
    while (this.ambient > step) {
      this.ambient -= step;
      const r = () => this.motes.rand();
      if (this.air === 'hall') {
        // dust motes drifting in the light, and incense from the burners (see burners)
        if (r() < 0.5) this.motes.add({ x: camX + (r() - 0.5) * 2600, y: 100 + r() * 700, z: r() * 700, vx: (r() - 0.5) * 20, vy: 10, size: 5 + r() * 4, life: 4, alpha: 0.6, color: 0xffe0a8, sway: 20 });
      } else if (this.air === 'fort') {
        if (r() < 0.6) this.motes.add({ x: camX + (r() - 0.5) * 2600, y: 0, z: r() * 800, vx: 30 + r() * 40, vy: 120 + r() * 80, size: 6 + r() * 6, life: 3, alpha: 1.6, color: r() < 0.5 ? RED_HOT : HOT, sway: 60 });
      } else if (r() < 0.35) {
        this.leaves.add({ x: camX + (r() - 0.5) * 2400 - 300, y: 900, z: r() * 800, vx: 90 + r() * 60, vy: -60 - r() * 40, size: 18 + r() * 12, life: 9, alpha: 0.85, color: r() < 0.25 ? CINNABAR : r() < 0.5 ? 0x5a5040 : INK, sway: 140, spin: (r() - 0.5) * 6 });
      }
    }
    void t;
  }

  /** Incense rising from the burners at `spots` (their feet). */
  incense(spots: readonly Vector3[], dt: number): void {
    if (this.air !== 'hall') return;
    for (const p of spots) {
      if (this.smoke.rand() > dt * 9) continue;
      this.smoke.add({ x: p.x + (this.smoke.rand() - 0.5) * 20, y: 205, z: p.z, vx: 6, vy: 55, size: 22, grow: 60, life: 3.2, alpha: 0.2, color: _c.set(0x4a4650), sway: 50 });
    }
  }
}
