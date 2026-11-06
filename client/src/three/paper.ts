import { MOVES, fromFp, type Entity } from '@dnf/engine';
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from 'three';

// Trial (?hero2d): the hero drawn as painted frames on a card instead of the 3D body. The frames
// are AI paintings cut out of their paper (art/heroes/sprite2d, tools/sprite2d_cut.py), all on one
// canvas so they line up: the feet stand on the same row in each.

const url = (n: string) => new URL(`../../../art/heroes/sprite2d/${n}_cut.png`, import.meta.url).href;

/** A painted sequence: `<name>_1` .. `<name>_<n>`, frames of an image-to-video clip
 * (tools/sprite2d_clips.py, cut with tools/sprite2d_video.py). */
type Seq = { readonly name: string; readonly n: number };
const seq = (name: string, n: number): Seq => ({ name, n });
const at = (s: Seq, i: number) => `${s.name}_${Math.max(1, Math.min(s.n, i + 1))}`;

/**
 * A move on a sequence: which paintings show at the move's first active tick and just after its
 * last (`hit`: [i0, i1]); the ticks between are spread evenly over the paintings between, so the
 * painted strike lands on the engine's.
 */
type Take = {
  readonly seq: Seq;
  readonly from?: number;
  readonly to?: number;
  readonly hit: readonly [number, number];
  /** Through the active ticks, cycle these paintings instead (a flurry), `every` ticks each. */
  readonly loop?: readonly [number, number];
};
/** Ticks on each painting of a looped flurry. */
const FLURRY = 2;

const SEQS = {
  // one cycle (two steps) of the painted walk: the legs pass each other
  walk: seq('stride', 16),
  // one cycle of the painted run (low long strides)
  run: seq('sprint', 12),
  // the three-hit chain: cut, backhand, overhead chop, back to the stance
  combo: seq('combo', 24),
  // a lunging thrust
  thrust: seq('thrust', 20),
  // a rising slash from the ground to over the head
  rising: seq('rising', 20),
  // a windup then whirling cuts (the clip paints the blade's arcs)
  spin: seq('spin', 17),
  // both hands overhead, down into the ground
  smash: seq('smash', 16),
  // crouched at the scabbard, the draw, the blade held out
  iai: seq('iaido', 18),
} as const;
const S = SEQS;
const TAKES: Record<string, Take> = {
  atk1: { seq: S.combo, from: 0, to: 4, hit: [3, 4] },
  atk2: { seq: S.combo, from: 5, to: 13, hit: [10, 12] },
  atk3: { seq: S.combo, from: 13, to: 23, hit: [16, 18] },
  dashAtk: { seq: S.thrust, from: 2, to: 17, hit: [7, 11] },
  jumpAtk: { seq: S.combo, from: 1, to: 4, hit: [3, 4] },
  jumpSlam: { seq: S.smash, from: 10, to: 13, hit: [12, 12] },
  tri1: { seq: S.thrust, from: 2, to: 17, hit: [7, 11] },
  tri2: { seq: S.combo, from: 8, to: 14, hit: [10, 12] },
  tri3: { seq: S.rising, from: 3, to: 19, hit: [5, 9] },
  dragon1: { seq: S.spin, from: 4, to: 12, hit: [6, 11] },
  dragon2: { seq: S.spin, from: 9, to: 14, hit: [10, 13] },
  dragon3: { seq: S.spin, from: 9, to: 14, hit: [10, 13] },
  dragon4: { seq: S.rising, from: 4, to: 19, hit: [5, 9] },
  upper: { seq: S.rising, from: 2, to: 19, hit: [5, 8] },
  crush1: { seq: S.smash, from: 2, to: 15, hit: [12, 14] },
  crush2: { seq: S.rising, from: 3, to: 19, hit: [5, 8] },
  iai: { seq: S.iai, from: 0, to: 17, hit: [8, 10] },
  phantom: { seq: S.spin, from: 4, to: 16, hit: [9, 15], loop: [9, 14] },
  phantomEnd: { seq: S.rising, from: 6, to: 19, hit: [6, 19] },
};
/** Moves and states that have no clip yet keep their one painting. */
const STILLS = ['jump_1', 'hurt_1', 'down_1', 'backstep_1'];
const MOVE_STILL: Record<string, string> = { backstep: 'backstep_1' };
/** How far the body goes on each walk and run painting (figure heights), so the feet keep to the floor. */
const WALK_STEP = 0.06;
const RUN_STEP = 0.1;

/** The painting index (0-based, into the take's span) for tick `st` of a move. */
function tickToIndex(t: Take, st: number, total: number, a0: number, a1: number): number {
  const lo = t.from ?? 0;
  const hi = t.to ?? t.seq.n - 1;
  const [i0, i1] = t.hit;
  // knots: tick 0 -> lo, a0 -> i0, a1 + 1 -> i1, total -> hi
  const knots: [number, number][] = a1 < a0 ? [[0, lo], [total, hi]] : [[0, lo], [a0, i0], [a1 + 1, i1], [total, hi]];
  for (let k = 1; k < knots.length; k++) {
    const [t0, f0] = knots[k - 1];
    const [t1, f1] = knots[k];
    if (st < t1 || k === knots.length - 1) {
      const u = t1 > t0 ? Math.min(1, Math.max(0, (st - t0) / (t1 - t0))) : 1;
      return Math.round(f0 + (f1 - f0) * u);
    }
  }
  return hi;
}

/** The canvas (592x448): where the feet stand, and how tall the figure stands on it (hat to soles). */
const CANVAS_W = 592;
const CANVAS_H = 448;
const FEET = 420;
const FIGURE = 400;

/**
 * The wind on the painting, in the card's vertex shader (uv: 0..1 across the canvas, y up; the
 * figure faces left, so its loose hem streams off to the right). The hem and the ribbons ripple in
 * waves running out to their ends, the body breathes and leans a little, the feet stay put.
 */
const SWAY_HEAD = `
uniform float uTime;
uniform float uWind;
uniform vec2 uSize;
`;
const SWAY_BODY = `
{
  vec2 q = uv;
  float t = uTime;
  // the hem: right of the body, off the floor, more towards its loose end
  float hem = smoothstep(0.48, 0.85, q.x) * smoothstep(0.12, 0.3, q.y) * (1.0 - smoothstep(0.62, 0.8, q.y));
  float gust = 0.8 + 0.2 * sin(t * 0.9) * sin(t * 0.37 + 1.3);
  float wave = sin(t * 3.4 - q.x * 14.0 + q.y * 3.0) + 0.45 * sin(t * 5.3 - q.x * 23.0);
  transformed.y += uWind * gust * hem * hem * wave * 0.016 * uSize.y;
  transformed.x += uWind * gust * hem * (0.6 + 0.4 * sin(t * 2.1 - q.x * 9.0)) * 0.012 * uSize.x;
  // the body: breathing and a slow lean, nothing at the feet
  float up = smoothstep(0.1, 0.75, q.y);
  transformed.y += uWind * up * sin(t * 1.9) * 0.006 * uSize.y;
  transformed.x += uWind * up * up * sin(t * 0.8) * 0.004 * uSize.x;
}
`;

/** The paintings, each loaded the first time it is shown (a move's sequence is fetched whole
 * then, so it has arrived by its next play). */
const textures = new Map<string, Texture>();
const loader = new TextureLoader();
function tex(name: string): Texture {
  let t = textures.get(name);
  if (!t) {
    t = loader.load(url(name));
    t.colorSpace = SRGBColorSpace;
    textures.set(name, t);
  }
  return t;
}
function preload(s: Seq): void {
  for (let i = 0; i < s.n; i++) tex(at(s, i));
}
// all of them up front for the trial (about 150 paintings); per-move loading or atlases can come later
for (const s of Object.values(SEQS)) preload(s);
for (const n of ['base', ...STILLS]) tex(n);

export const hero2d = typeof location !== 'undefined' && new URLSearchParams(location.search).has('hero2d');

export class Paper {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private t = 0;
  /** How far the body has walked or run (room units), for the stride paintings. */
  private gone = 0;
  private lastX: number | null = null;
  private readonly uTime = { value: 0 };
  /** How hard the wind moves the painting now (1 standing, less while moving or striking). */
  private readonly uWind = { value: 1 };

  /** `height`: the figure's height in the room. */
  constructor(private readonly height: number) {
    const k = height / FIGURE;
    const w = CANVAS_W * k;
    const h = CANVAS_H * k;
    // fine enough for the wind to bend the painting smoothly
    const geo = new PlaneGeometry(w, h, 32, 24);
    // the card's origin at the feet
    geo.translate(0, (FEET - CANVAS_H / 2) * k, 0);
    this.mat = new MeshBasicMaterial({ map: tex('base'), transparent: true, alphaTest: 0.02, side: DoubleSide, depthWrite: false });
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uWind = this.uWind;
      sh.uniforms.uSize = { value: [w, h] };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${SWAY_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
${SWAY_BODY}`);
    };
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.renderOrder = 2;
  }

  update(dt: number, e: Entity, flash: number): void {
    this.t += dt;
    const x = fromFp(e.x);
    const dx = this.lastX === null ? 0 : Math.abs(x - this.lastX);
    this.lastX = x;
    this.mat.map = tex(this.frame(e, dx));
    this.uTime.value = this.t;
    const still = e.state === 'idle' || e.state === 'walk';
    this.uWind.value += ((still ? 1 : 0.35) - this.uWind.value) * Math.min(1, dt * 6);
    this.mat.color.setScalar(flash > 0 ? 1.6 : 1);
    // the paintings face left
    this.mesh.scale.set(e.facing > 0 ? -1 : 1, 1, 1);
  }

  private frame(e: Entity, dx: number): string {
    switch (e.state) {
      case 'act': {
        const m = MOVES[e.move];
        const t = TAKES[e.move];
        if (!m || !t) return MOVE_STILL[e.move] ?? 'base';
        if (t.loop && e.st >= m.active[0] && e.st <= m.active[1]) {
          const [l0, l1] = t.loop;
          return at(t.seq, l0 + (Math.floor((e.st - m.active[0]) / FLURRY) % (l1 - l0 + 1)));
        }
        return at(t.seq, tickToIndex(t, e.st, m.total, m.active[0], m.active[1]));
      }
      case 'walk':
      case 'run': {
        this.gone += dx;
        const run = e.state === 'run';
        const cycle = run ? SEQS.run : SEQS.walk;
        const i = Math.floor(this.gone / ((run ? RUN_STEP : WALK_STEP) * this.height));
        return at(cycle, i % cycle.n);
      }
      case 'jump':
        return 'jump_1';
      case 'down':
      case 'dead':
        return 'down_1';
      case 'hurt':
      case 'air':
      case 'getup':
        return 'hurt_1';
      default:
        // one painting, brought to life by the wind (SWAY_BODY): two paintings swapped read as a jump
        return 'base';
    }
  }
}
