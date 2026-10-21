import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three';
import { INK } from './ink';

// Ink flung off a hit: drops that burst out, fall and thin away, all in one draw (a point cloud,
// each drop a soft round blot sized by its distance to the camera).

const MAX = 512;
/** Gravity on the drops, world units per second squared. */
const FALL = 2600;

export class Splash {
  readonly points: Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private next = 0;
  /** A cheap deterministic-enough scatter; this is only drawing. */
  private seed = 1;

  constructor(color = INK, additive = false) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    const m = new ShaderMaterial({
      uniforms: { color: { value: new Color(color) }, scale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        uniform float scale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          // a blot: solid in the middle, a ragged soft rim
          float a = smoothstep(1.0, 0.55, r) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** `n` drops from `at`, flung mostly along `dir` (x: +1 right, -1 left), `power` times as far. */
  burst(at: Vector3, dir: number, n = 18, power = 1): void {
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % MAX;
      const sp = (300 + this.rand() * 900) * power;
      const up = (this.rand() - 0.25) * 1.2;
      const side = (this.rand() - 0.5) * 0.8;
      const fwd = 0.4 + this.rand() * 0.8;
      const len = Math.hypot(fwd, up, side);
      this.pos.set([at.x, at.y + (this.rand() - 0.5) * 40, at.z], j * 3);
      this.vel.set([((dir * fwd) / len) * sp, (up / len) * sp, (side / len) * sp], j * 3);
      this.size[j] = (4 + this.rand() * 10) * (i < 3 ? 2 : 1);
      this.life[j] = 0.25 + this.rand() * 0.35;
      this.age[j] = 0;
      this.alpha[j] = 1;
    }
  }

  /** Moves the drops on by `dt` seconds; `pxPerUnit` is the view's height over its world height
   * at unit distance, so a drop's size is in world units. */
  update(dt: number, pxPerUnit: number): void {
    (this.points.material as ShaderMaterial).uniforms.scale.value = pxPerUnit;
    for (let j = 0; j < MAX; j++) {
      if (this.alpha[j] <= 0) continue;
      this.age[j] += dt;
      const k = this.age[j] / this.life[j];
      if (k >= 1) {
        this.alpha[j] = 0;
        continue;
      }
      this.vel[j * 3 + 1] -= FALL * dt;
      // drag: the burst is fast and stops short, like flicked ink
      const drag = Math.exp(-dt * 6);
      this.vel[j * 3] *= drag;
      this.vel[j * 3 + 2] *= drag;
      this.pos[j * 3] += this.vel[j * 3] * dt;
      this.pos[j * 3 + 1] = Math.max(1, this.pos[j * 3 + 1] + this.vel[j * 3 + 1] * dt);
      this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      this.alpha[j] = 1 - k * k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}
