import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { INK } from './ink';

// The swish behind a cutting blade: a ribbon through where the blade's tip and middle were over
// the last moments, solid ink at the blade and thinning to nothing behind it. A cut is only a
// few frames, so the samples are joined by a Catmull-Rom curve, not straight lines.

const SAMPLES = 16;
/** Points the curve puts between two samples. */
const SUB = 5;
const POINTS = (SAMPLES - 1) * SUB + 1;
/** Seconds a sample lasts. */
const LIFE = 0.16;

function catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/** One material for every trail (the colour is in the vertices). */
const MATERIAL = new MeshBasicMaterial({ vertexColors: true, transparent: true, side: DoubleSide, depthWrite: false, toneMapped: false });

export class Trail {
  readonly mesh: Mesh;
  private readonly base: Vector3[] = [];
  private readonly tip: Vector3[] = [];
  private readonly age: number[] = [];
  private readonly pos = new Float32Array(POINTS * 2 * 3);
  private readonly col = new Float32Array(POINTS * 2 * 4);
  private readonly geo = new BufferGeometry();
  private readonly _b = new Vector3();
  private readonly _t = new Vector3();

  constructor(color = INK) {
    const c = new Color(color);
    for (let i = 0; i < POINTS * 2; i++) this.col.set([c.r, c.g, c.b, 0], i * 4);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 4));
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(index);
    this.mesh = new Mesh(this.geo, MATERIAL);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Ages the samples by `dt` and, while `on`, adds where the blade's `base` and `tip` are now. */
  update(dt: number, on: boolean, base: Vector3, tip: Vector3): void {
    for (let i = 0; i < this.age.length; i++) this.age[i] += dt;
    while (this.age.length && this.age[this.age.length - 1] > LIFE) {
      this.age.pop();
      this.base.pop();
      this.tip.pop();
    }
    // a frozen blade (hit-stop) adds nothing new
    const moved = !this.tip.length || this.tip[0].distanceToSquared(tip) > 4;
    if (on && moved) {
      this.base.unshift(base.clone());
      this.tip.unshift(tip.clone());
      this.age.unshift(0);
      if (this.age.length > SAMPLES) this.age.length = this.base.length = this.tip.length = SAMPLES;
    }
    const n = this.age.length;
    const at = (a: Vector3[], i: number) => a[Math.max(0, Math.min(n - 1, i))];
    for (let p = 0; p < POINTS; p++) {
      const i = Math.floor(p / SUB);
      const t = (p % SUB) / SUB;
      let alpha = 0;
      if (n >= 2 && i < n - 1) {
        catmull(at(this.base, i - 1), at(this.base, i), at(this.base, i + 1), at(this.base, i + 2), t, this._b);
        catmull(at(this.tip, i - 1), at(this.tip, i), at(this.tip, i + 1), at(this.tip, i + 2), t, this._t);
        const age = this.age[i] + (this.age[i + 1] - this.age[i]) * t;
        const k = Math.max(0, 1 - age / LIFE);
        alpha = Math.pow(k, 1.4);
        // a crescent: wide at the blade, narrowing to the tip's line as it fades
        this._b.lerp(this._t, 1 - k * 0.7);
      } else if (n) {
        this._b.copy(this.tip[n - 1]);
        this._t.copy(this.tip[n - 1]);
      }
      this.pos.set([this._b.x, this._b.y, this._b.z], p * 6);
      this.pos.set([this._t.x, this._t.y, this._t.z], p * 6 + 3);
      this.col[p * 8 + 3] = alpha * 0.25;
      this.col[p * 8 + 7] = alpha * 0.9;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}
