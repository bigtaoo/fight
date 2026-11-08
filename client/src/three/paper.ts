import { MOVES, WORLD, fromFp, type Entity } from '@dnf/engine';
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from 'three';

// The web game's hero (?hero3d for the 3D body): drawn as painted frames on a card instead of the 3D body. The frames
// are AI paintings cut out of their paper (art/heroes/sprite2d, tools/sprite2d_cut.py), all on one
// canvas so they line up: the feet stand on the same row in each.

const url = (n: string) => new URL(`../../../art/heroes/sprite2d/${n}_cut.png`, import.meta.url).href;

/** A painted sequence: `<name>_1` .. `<name>_<n>`, frames of an image-to-video clip
 * (tools/sprite2d_clips.py, cut with tools/sprite2d_video.py). */
type Seq = { readonly name: string; readonly n: number };
/** Each sequence's canvas width, when wider than the usual one (see WIDE_W). */
const widths = new Map<string, number>();
const seq = (name: string, n: number, w?: number): Seq => {
  if (w) widths.set(name, w);
  return { name, n };
};
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
  /** The ticks the paintings spread over, when not the whole move (the hop lands before it ends). */
  readonly span?: number;
  /** Ticks on each looped painting (default FLURRY). */
  readonly every?: number;
};
/** Ticks on each painting of a looped flurry. */
const FLURRY = 2;

const SEQS = {
  // one cycle (two steps) of the painted walk from the side stance: the legs pass each other
  // (side_walk frames 14-39)
  walk: seq('swalk', 16),
  // one cycle of the painted run (low long strides)
  run: seq('sprint', 12),
  // the three-hit chain from the side stance: overhead cut, backhand sweep, chop, back to the stance
  combo: seq('scombo', 30),
  // a step in, the blade swung up and out into a lunging thrust, held, drawn back (side_thrust2;
  // a wide canvas for the reach)
  thrust: seq('sthrust', 14, 832),
  // a rising slash from low in front to over the head, then a cut back down (the clip turns to the
  // camera after its frame 26, which is left out)
  rising: seq('srising', 19),
  // a windup then whirling cuts (the clip paints the blade's arcs), out into a reaching thrust
  spin: seq('sspin', 24),
  // both hands overhead, down into the ground, held crouched
  smash: seq('ssmash', 20),
  // crouched at the scabbard, the draw, the blade held out
  // (side_iai2: the blade raised over the head, the draw sweeping down and out, held low; wide)
  iai: seq('siai', 20, 832),
  // the dodge's hop back: off the ground, tucked, down into a low stance (feet on the floor in each
  // painting: the engine lifts the body itself)
  hop: seq('shop', 12),
  // a jump, tucked, from just off the ground to the top and down again
  jump: seq('sjump', 6),
  // an overhead windup and a chop down into a low crouch (the clip never leaves the ground; the
  // engine lifts the body)
  aerial: seq('saerial', 12),
  // struck: the blade drops and the body straightens up, held (side_hurt2 frames 4-7; the clip turns
  // to the camera after them)
  hurt: seq('shurt', 4),
  // knocked off the feet: lifted, flipping back, coming down on the shoulders (side_down frames
  // 10-18; feet or lowest point on the floor in each, the engine lifts the body)
  air: seq('sair', 9),
  // landed: flat on the back (1-8, side_down 19-30), then sitting up into a crouch (9-18, 31-46)
  down: seq('sdown', 18),
  // overhead and down again, fast (side_flurry frames 2-15; the clip turns to the camera after)
  flurry: seq('sflurry', 12),
} as const;
const S = SEQS;
const TAKES: Record<string, Take> = {
  atk1: { seq: S.combo, from: 2, to: 11, hit: [9, 11] },
  atk2: { seq: S.combo, from: 11, to: 19, hit: [12, 14] },
  atk3: { seq: S.combo, from: 19, to: 29, hit: [22, 25] },
  dashAtk: { seq: S.thrust, hit: [4, 6] },
  jumpAtk: { seq: S.aerial, from: 2, to: 9, hit: [5, 8] },
  // the chop, then the low crouch with the blade forward for the dive down
  jumpSlam: { seq: S.aerial, from: 5, to: 11, hit: [9, 11] },
  tri1: { seq: S.thrust, hit: [4, 6] },
  tri2: { seq: S.combo, from: 6, to: 14, hit: [9, 12] },
  tri3: { seq: S.rising, from: 2, to: 18, hit: [6, 9] },
  dragon1: { seq: S.spin, from: 3, to: 21, hit: [7, 18] },
  dragon2: { seq: S.spin, from: 7, to: 21, hit: [9, 18] },
  dragon3: { seq: S.spin, from: 7, to: 21, hit: [9, 18] },
  dragon4: { seq: S.rising, from: 3, to: 18, hit: [6, 9] },
  upper: { seq: S.rising, from: 1, to: 18, hit: [6, 9] },
  crush1: { seq: S.smash, from: 1, to: 19, hit: [12, 14] },
  crush2: { seq: S.rising, from: 2, to: 18, hit: [6, 9] },
  iai: { seq: S.iai, hit: [10, 12] },
  phantom: { seq: S.flurry, from: 0, to: 11, hit: [2, 11], loop: [3, 11], every: 1 },
  phantomEnd: { seq: S.rising, from: 6, to: 18, hit: [6, 18] },
  // no active ticks: the paintings spread over the whole move
  backstep: { seq: S.hop, hit: [0, 0], span: 10 },
};
/** Ticks on each hurt painting before the last is held: the flinch has to land at once. */
const HURT_EVERY = 1;
/** The paintings on the floor: lying (the first LIE of SEQS.down, one a tick, the last held), then
 * getting up over the engine's getup ticks (the rest). */
const LIE = 8;
/** A typical launch speed (px/tick): the air paintings follow the vertical speed like the jump's. */
const LAUNCH_VZ = 16;
/** The stance: the painting every side clip starts from, so the moves leave and return to it in
 * profile (the old three-quarter stance, base, read as turning to the camera and back). */
const STANCE = 'side';
/** The hero's take-off speed (the engine's HERO.jumpVz, px/tick): the jump paintings follow the
 * vertical speed, from this going up to minus this coming down. */
const JUMP_VZ = 33;
/** How far the body goes on each walk and run painting (figure heights), so the feet keep to the floor. */
const WALK_STEP = 0.06;
const RUN_STEP = 0.065;
/**
 * Each clip is painted on its own, so where one ends and the next begins the poses do not meet:
 * the card cross-fades from the last painting over these seconds (longer into the stance, where
 * the eye rests), instead of cutting.
 */
const FADE = 0.12;
const FADE_TO_STANCE = 0.22;
/** Into a move, barely: the strike has to read at once. */
const FADE_TO_MOVE = 0.06;
/** Paintings further apart than this within one sequence are a cut too (a move restarting it). */
const NEAR = 2;
/** The cycles: their last painting runs on into their first. */
const CYCLES: readonly string[] = [SEQS.walk.name, SEQS.run.name];

/** A painting's sequence and index: `combo_7` -> ['combo', 7]; a lone painting is index 0. */
function split(n: string): [string, number] {
  const m = /^(.*)_(\d+)$/.exec(n);
  return m && m[1] !== 'base' ? [m[1], Number(m[2])] : [n, 0];
}
/** Whether showing `b` right after `a` reads as one motion (no fade needed). */
function follows(a: string, b: string): boolean {
  const [sa, ia] = split(a);
  const [sb, ib] = split(b);
  if (sa !== sb) return false;
  let d = Math.abs(ib - ia);
  const cycle = Object.values(SEQS).find((q) => q.name === sa);
  if (cycle && CYCLES.includes(sa)) d = Math.min(d, cycle.n - d);
  return d <= NEAR;
}

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
/** The card's width: a move whose blade reaches past the usual canvas is painted on one this wide
 * (same height and feet, the figure in the middle); the narrower paintings sit in its middle. */
const WIDE_W = 832;
/** How much of a painting's width the card spans (1 for a wide painting). */
const spanOf = (name: string) => WIDE_W / (widths.get(name.slice(0, name.lastIndexOf('_'))) ?? CANVAS_W);

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
/** The cross-fade, in the fragment shader: the last painting under the new one, mixed by coverage
 * (premultiplied, so the clear paper round each figure does not darken the other). */
const FADE_HEAD = `
uniform sampler2D uPrev;
uniform float uMix;
uniform float uPrevSpan;
uniform float uMapSpan;
vec4 painting(sampler2D t, float span, vec2 uv) {
  uv.x = 0.5 + (uv.x - 0.5) * span;
  return uv.x < 0.0 || uv.x > 1.0 ? vec4(0.0) : texture2D(t, uv);
}
`;
const FADE_BODY = `
#ifdef USE_MAP
{
  vec4 a = painting(uPrev, uPrevSpan, vMapUv);
  vec4 b = painting(map, uMapSpan, vMapUv);
  vec4 m = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), uMix);
  diffuseColor *= m.a > 0.0 ? vec4(m.rgb / m.a, m.a) : vec4(0.0);
}
#endif
`;
const SWAY_BODY = `
{
  vec2 q = vec2(0.5 + (uv.x - 0.5) * ${WIDE_W / CANVAS_W}, uv.y);
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
/**
 * The painted hero is the web game's hero (?hero3d brings back the 3D body). The WeChat build
 * keeps the body: the paintings would not fit its package.
 */
export const hero2d =
  typeof location !== 'undefined' && typeof (globalThis as { wx?: unknown }).wx === 'undefined' && !new URLSearchParams(location.search).has('hero3d');

// all of them up front (about 150 paintings); per-move loading or atlases can come later
if (hero2d) {
  for (const s of Object.values(SEQS)) preload(s);
  tex(STANCE);
}

export class Paper {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private t = 0;
  /** How far the body has walked or run (room units), for the stride paintings. */
  private gone = 0;
  private last: [number, number] | null = null;
  private readonly uTime = { value: 0 };
  /** How hard the wind moves the painting now (1 standing, less while moving or striking). */
  private readonly uWind = { value: 1 };
  /** The painting shown, and the one it is fading from (`uMix` 0 -> 1 over `fade` seconds). */
  private shown = STANCE;
  private readonly uPrev = { value: tex(STANCE) };
  private readonly uPrevSpan = { value: spanOf(STANCE) };
  private readonly uMapSpan = { value: spanOf(STANCE) };
  private readonly uMix = { value: 1 };
  private fade = FADE;

  /** `height`: the figure's height in the room. */
  constructor(private readonly height: number) {
    const k = height / FIGURE;
    const w = CANVAS_W * k;
    const h = CANVAS_H * k;
    // fine enough for the wind to bend the painting smoothly
    const geo = new PlaneGeometry(WIDE_W * k, h, 45, 24);
    // the card's origin at the feet
    geo.translate(0, (FEET - CANVAS_H / 2) * k, 0);
    this.mat = new MeshBasicMaterial({ map: tex(STANCE), transparent: true, alphaTest: 0.02, side: DoubleSide, depthWrite: false });
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uWind = this.uWind;
      sh.uniforms.uSize = { value: [w, h] };
      sh.uniforms.uPrev = this.uPrev;
      sh.uniforms.uMix = this.uMix;
      sh.uniforms.uPrevSpan = this.uPrevSpan;
      sh.uniforms.uMapSpan = this.uMapSpan;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
${FADE_HEAD}`)
        .replace('#include <map_fragment>', FADE_BODY);
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
    // across the floor and up or down it alike: the legs step either way
    const x = fromFp(e.x);
    const y = fromFp(e.y);
    const dx = this.last === null ? 0 : Math.hypot(x - this.last[0], y - this.last[1]);
    this.last = [x, y];
    const name = this.frame(e, dx);
    if (name !== this.shown) {
      if (!follows(this.shown, name)) {
        // fade from whichever painting shows most now (a cut during a fade restarts it from there)
        if (this.uMix.value >= 0.5) {
          this.uPrev.value = tex(this.shown);
          this.uPrevSpan.value = spanOf(this.shown);
        }
        this.uMix.value = 0;
        this.fade = name === STANCE ? FADE_TO_STANCE : e.state === 'act' ? FADE_TO_MOVE : FADE;
      }
      this.shown = name;
    }
    this.uMix.value = Math.min(1, this.uMix.value + dt / this.fade);
    this.mat.map = tex(name);
    this.uMapSpan.value = spanOf(name);
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
        if (!m || !t) return STANCE;
        if (t.loop && e.st >= m.active[0] && e.st <= m.active[1]) {
          const [l0, l1] = t.loop;
          return at(t.seq, l0 + (Math.floor((e.st - m.active[0]) / (t.every ?? FLURRY)) % (l1 - l0 + 1)));
        }
        return at(t.seq, tickToIndex(t, e.st, t.span ?? m.total, m.active[0], m.active[1]));
      }
      case 'walk':
      case 'run': {
        this.gone += dx;
        const run = e.state === 'run';
        const cycle = run ? SEQS.run : SEQS.walk;
        const i = Math.floor(this.gone / ((run ? RUN_STEP : WALK_STEP) * this.height));
        return at(cycle, i % cycle.n);
      }
      case 'jump': {
        const u = (JUMP_VZ - fromFp(e.vz)) / (2 * JUMP_VZ);
        return at(SEQS.jump, Math.round(Math.min(1, Math.max(0, u)) * (SEQS.jump.n - 1)));
      }
      case 'down':
      case 'dead':
        return at(SEQS.down, Math.min(LIE - 1, e.st));
      case 'getup': {
        const n = SEQS.down.n - LIE;
        return at(SEQS.down, LIE + Math.min(n - 1, Math.floor((e.st * n) / WORLD.getupTicks)));
      }
      case 'hurt':
        return at(SEQS.hurt, Math.floor(e.st / HURT_EVERY));
      case 'air': {
        const u = (LAUNCH_VZ - fromFp(e.vz)) / (2 * LAUNCH_VZ);
        return at(SEQS.air, Math.round(Math.min(1, Math.max(0, u)) * (SEQS.air.n - 1)));
      }
      default:
        // one painting, brought to life by the wind (SWAY_BODY): two paintings swapped read as a jump
        return STANCE;
    }
  }
}
