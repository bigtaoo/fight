import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, type Vector3 } from 'three';

// Loose bits drawn as one point cloud each, every bit a sprite shaped in the shader: drifting
// smoke and dust, falling leaves, embers and sparks. Each kind of bit is its own Particles, with
// its own look; the bits themselves carry where they go and how they fade.

/** How a bit is drawn: a soft wash with ragged noise (smoke, dust); a leaf, an ellipse that turns;
 * a glow, soft and added on (bright enough to bloom); a streak, a glow stretched along its way. */
export type Look = 'wash' | 'leaf' | 'glow';

export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** World units across, and how fast that grows a second. */
  size: number;
  grow?: number;
  life: number;
  /** Peak opacity (or brightness, for glows). */
  alpha?: number;
  color?: number | Color;
  /** Pull along y a second (negative falls), and the drag on the speed a second. */
  lift?: number;
  drag?: number;
  /** A sideways waver: world units, and how fast. */
  sway?: number;
  /** Turns a second (leaves). */
  spin?: number;
}

const _c = new Color();

export class Particles {
  readonly points: Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly turn: Float32Array;
  private readonly grow!: Float32Array;
  private readonly life!: Float32Array;
  private readonly age!: Float32Array;
  private readonly peak!: Float32Array;
  private readonly lift!: Float32Array;
  private readonly drag!: Float32Array;
  private readonly sway!: Float32Array;
  private readonly spin!: Float32Array;
  private readonly seed!: Float32Array;
  private next = 0;
  private live = 0;
  /** Spawned but not yet aged out, to skip the work when there is none. */
  get count(): number {
    return this.live;
  }

  constructor(look: Look, max = 256, color = 0xffffff, floor = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.turn = new Float32Array(max);
    for (const k of ['grow', 'life', 'age', 'peak', 'lift', 'drag', 'sway', 'spin', 'seed'] as const) (this as unknown as Record<string, Float32Array>)[k] = new Float32Array(max);
    this.floor = floor;
    this.base.set(color);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('turn', new BufferAttribute(this.turn, 1));
    const shape = {
      wash: /* glsl */ `
        // a wash of ink: a soft blot whose rim is eaten by noise, different on every bit
        float n = noise(d * 3.0 + vTurn * 7.0) * 0.55 + noise(d * 7.0 - vTurn * 3.0) * 0.45;
        float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.7);`,
      leaf: /* glsl */ `
        vec2 q = mat2(cos(vTurn), -sin(vTurn), sin(vTurn), cos(vTurn)) * d;
        // pointed at both ends, with a dark vein
        float w = 0.42 * (1.0 - q.x * q.x);
        float a = smoothstep(0.0, 0.08, w - abs(q.y)) * step(abs(q.x), 1.0);
        a *= 0.75 + 0.25 * smoothstep(0.0, 0.05, abs(q.y));`,
      glow: /* glsl */ `
        float a = pow(max(0.0, 1.0 - r), 2.0);`,
    }[look];
    const m = new ShaderMaterial({
      uniforms: { scale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute float turn;
        uniform float scale;
        varying float vAlpha;
        varying float vTurn;
        varying vec3 vColor;
        void main() {
          vAlpha = alpha;
          vTurn = turn;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = alpha > 0.0 ? size * scale / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vTurn;
        varying vec3 vColor;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 d = (gl_PointCoord - 0.5) * 2.0;
          float r = length(d);
          ${shape}
          a *= vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = ${look === 'glow' ? 'vec4(vColor * a, 1.0)' : 'vec4(vColor, a)'};
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: look === 'glow' ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = look === 'glow' ? 5 : 3;
  }

  private readonly floor: boolean;
  private readonly base = new Color();
  private rnd = 7;

  /** A scatter for the effects' own use (only drawing, so it need not be the engine's). */
  rand(): number {
    this.rnd = (this.rnd * 1103515245 + 12345) & 0x7fffffff;
    return this.rnd / 0x7fffffff;
  }

  add(p: Spawn): void {
    const j = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], j * 3);
    this.vel.set([p.vx ?? 0, p.vy ?? 0, p.vz ?? 0], j * 3);
    const c = p.color === undefined ? this.base : typeof p.color === 'number' ? _c.set(p.color) : p.color;
    this.col.set([c.r, c.g, c.b], j * 3);
    this.size[j] = p.size;
    this.grow[j] = p.grow ?? 0;
    this.life[j] = p.life;
    this.age[j] = 0;
    this.peak[j] = p.alpha ?? 1;
    this.alpha[j] = 0.0001;
    this.lift[j] = p.lift ?? 0;
    this.drag[j] = p.drag ?? 0;
    this.sway[j] = p.sway ?? 0;
    this.spin[j] = p.spin ?? 0;
    this.seed[j] = this.rand() * 100;
    this.turn[j] = this.rand() * 6.28;
    this.live = Math.min(this.max, this.live + 1);
  }

  /** Moves the bits on `dt` seconds; `pxPerUnit` as in Splash.update. */
  update(dt: number, pxPerUnit: number, t: number): void {
    (this.points.material as ShaderMaterial).uniforms.scale.value = pxPerUnit;
    if (!this.live) return;
    let live = 0;
    for (let j = 0; j < this.max; j++) {
      if (this.alpha[j] <= 0) continue;
      this.age[j] += dt;
      const k = this.age[j] / this.life[j];
      if (k >= 1) {
        this.alpha[j] = 0;
        continue;
      }
      live++;
      const i = j * 3;
      this.vel[i + 1] += this.lift[j] * dt;
      if (this.drag[j]) {
        const d = Math.exp(-dt * this.drag[j]);
        this.vel[i] *= d;
        this.vel[i + 1] *= d;
        this.vel[i + 2] *= d;
      }
      const w = this.sway[j] ? Math.sin(t * 1.7 + this.seed[j]) * this.sway[j] * dt : 0;
      this.pos[i] += this.vel[i] * dt + w;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      if (this.floor && this.pos[i + 1] < 2) {
        this.pos[i + 1] = 2;
        this.vel[i + 1] = 0;
        this.vel[i] *= 0.8;
        this.spin[j] *= 0.8;
      }
      this.size[j] += this.grow[j] * dt;
      this.turn[j] += this.spin[j] * dt;
      // in quickly, out slowly
      this.alpha[j] = this.peak[j] * Math.min(1, k * 8) * (1 - k) * (1 - k * 0.3);
    }
    this.live = live;
    const g = this.points.geometry;
    for (const a of ['position', 'color', 'size', 'alpha', 'turn']) g.attributes[a].needsUpdate = true;
  }

  /** Puts `n` bits in a ring round `at` on the floor, moving out (dust kicked up). */
  ring(at: Vector3, n: number, speed: number, p: Omit<Spawn, 'x' | 'y' | 'z'>): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.5;
      const s = speed * (0.6 + this.rand() * 0.6);
      this.add({ ...p, x: at.x + Math.cos(a) * 20, y: at.y + 6, z: at.z + Math.sin(a) * 20, vx: Math.cos(a) * s, vz: Math.sin(a) * s * 0.7 });
    }
  }
}
