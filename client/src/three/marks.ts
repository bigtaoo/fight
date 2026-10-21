import { Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, NormalBlending, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, AdditiveBlending } from 'three';

// Brush marks, each kind one instanced draw: the crescent of a cut flashing over a hit (a single
// stroke of the brush, with the dry streaks of 飞白 where the brush ran out of ink), and the blots
// of ink left on the floor under the fighting, slowly drying away.

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _z = new Vector3(0, 0, 1);
const _c = new Color();

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }`;

/** What a mark draws, given `p` (-1..1 over the quad), `t` (0..1 of its life) and `seed`: sets `a`. */
const SHAPES = {
  // a crescent swept from one end to the other in the first third of its life, then thinning away
  slash: /* glsl */ `
    vec2 c = vec2(0.0, -1.1);
    vec2 q = p - c;
    float ang = atan(q.x, q.y);
    float s = (ang + 1.05) / 2.1;
    float rad = length(q);
    float drawn = clamp(t * 3.2, 0.0, 1.0);
    float body = pow(max(0.0, sin(3.14159 * clamp(s, 0.0, 1.0))), 0.7) * (1.0 - t * 0.85);
    float w = 0.2 * body * (0.75 + 0.5 * noise(vec2(s * 9.0, seed)));
    float edge = abs(rad - 1.65 - (noise(vec2(s * 4.0, seed + 3.0)) - 0.5) * 0.1);
    float a = smoothstep(w, w * 0.6, edge) * step(0.0, s) * step(s, drawn) * step(s, 1.0);
    // dry streaks across the stroke, opening up towards the tail and as it fades
    float streak = noise(vec2(s * 2.5 + seed, (rad - 1.65) / max(w, 0.001) * 6.0));
    a *= smoothstep(0.15 + 0.55 * t + 0.4 * (1.0 - s), 0.35 + 0.55 * t + 0.4 * (1.0 - s), streak + 0.35);
    a *= 1.0 - smoothstep(0.55, 1.0, t);`,
  // a blot with a few flung drops round it, drying lighter from the rim in
  stain: /* glsl */ `
    float r = length(p);
    float n = noise(p * 3.0 + seed) * 0.6 + noise(p * 9.0 - seed) * 0.4;
    float a = smoothstep(0.62, 0.5, r + (n - 0.5) * 0.45);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 dp = vec2(cos(seed * 3.1 + fi * 1.7), sin(seed * 2.3 + fi * 2.9)) * (0.62 + 0.3 * hash(vec2(seed, fi)));
      a = max(a, smoothstep(0.09, 0.05, length(p - dp)) * step(0.3, hash(vec2(fi, seed))));
    }
    a *= (0.55 + 0.45 * smoothstep(0.7, 0.2, r)) * (1.0 - smoothstep(0.6, 1.0, t));`,
} as const;

export class Marks {
  readonly mesh: InstancedMesh;
  private readonly max: number;
  private readonly color: InstancedBufferAttribute;
  private readonly seed: InstancedBufferAttribute;
  private readonly tAttr: InstancedBufferAttribute;
  private readonly peak: InstancedBufferAttribute;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private next = 0;
  private live = 0;
  private rnd = 11;

  /** `flat`: lies on the floor; otherwise stands facing the camera (which looks straight along -z). */
  constructor(
    kind: keyof typeof SHAPES,
    max: number,
    private readonly flat = false,
    additive = false,
  ) {
    this.max = max;
    const g = new PlaneGeometry(2, 2);
    this.color = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.seed = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    this.tAttr = new InstancedBufferAttribute(new Float32Array(max).fill(1), 1).setUsage(DynamicDrawUsage);
    this.peak = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    g.setAttribute('aColor', this.color);
    g.setAttribute('aSeed', this.seed);
    g.setAttribute('aT', this.tAttr);
    g.setAttribute('aPeak', this.peak);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(1);
    const m = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSeed;
        attribute float aT;
        attribute float aPeak;
        varying vec2 vP;
        varying vec3 vColor;
        varying float vSeed;
        varying float vT;
        varying float vPeak;
        void main() {
          vP = position.xy;
          vColor = aColor; vSeed = aSeed; vT = aT; vPeak = aPeak;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        varying vec3 vColor;
        varying float vSeed;
        varying float vT;
        varying float vPeak;
        ${NOISE}
        void main() {
          if (vT >= 1.0) discard;
          vec2 p = vP; float t = vT; float seed = vSeed;
          ${SHAPES[kind]}
          a *= vPeak;
          if (a < 0.01) discard;
          gl_FragColor = ${additive ? 'vec4(vColor * a, 1.0)' : 'vec4(vColor, a)'};
        }`,
      transparent: true,
      depthWrite: false,
      // mirrored marks are scaled by -1 across, which turns their faces away
      side: DoubleSide,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new InstancedMesh(g, m, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = flat ? -0.5 : 4;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, _m);
  }

  rand(): number {
    this.rnd = (this.rnd * 1103515245 + 12345) & 0x7fffffff;
    return this.rnd / 0x7fffffff;
  }

  /** A mark at `at`, `size` across, turned `angle` (radians; on the floor, about the up axis),
   * stretched `stretch` times across; it lasts `life` seconds. */
  add(at: Vector3, size: number, angle: number, color: number | Color, life: number, alpha = 1, stretch = 1): void {
    const j = this.next;
    this.next = (this.next + 1) % this.max;
    _q.setFromAxisAngle(_z, angle);
    const m = _m.compose(_p.copy(at), this.flat ? flatQ(angle) : _q, _s.set(size * stretch, size, 1));
    this.mesh.setMatrixAt(j, m);
    (typeof color === 'number' ? _c.set(color) : _c.copy(color)).toArray(this.color.array, j * 3);
    this.seed.array[j] = this.rand() * 50;
    this.peak.array[j] = alpha;
    this.age[j] = 0;
    this.life[j] = life;
    this.tAttr.array[j] = 0;
    this.live = this.max;
    this.mesh.instanceMatrix.needsUpdate = this.color.needsUpdate = this.seed.needsUpdate = this.peak.needsUpdate = true;
  }

  /** Marks still showing. */
  get count(): number {
    return this.live;
  }

  update(dt: number): void {
    if (!this.live) return;
    let live = 0;
    const t = this.tAttr.array as Float32Array;
    for (let j = 0; j < this.max; j++) {
      if (t[j] >= 1) continue;
      this.age[j] += dt;
      t[j] = Math.min(1, this.age[j] / this.life[j]);
      if (t[j] < 1) live++;
    }
    this.live = live;
    this.tAttr.needsUpdate = true;
  }
}

const _fq = new Quaternion();
const _fy = new Quaternion();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);
/** Lying on the floor (the quad's own plane turned down flat), then turned `angle` about up. */
function flatQ(angle: number): Quaternion {
  _fq.setFromAxisAngle(_x, -Math.PI / 2);
  return _fy.setFromAxisAngle(_y, angle).multiply(_fq);
}
