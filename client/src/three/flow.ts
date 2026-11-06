import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { INK } from './ink';

// Cloth that flies: strips of a body's robe and cords of its sash drawn as ribbons that hang off a
// bone and are thrown about by how the body moves, with a breeze always at its back. Only for the
// look: each is a chain of points (verlet) pinned at one end, and nothing in the game reads them.
//
// A strip is given in the rig's frame at rest (x forward, y the body's left, z up; the model
// 1.0 tall, as in art/model3d/joints.json), on the bone it hangs from.

export interface Strip {
  bone: string;
  /** Where it hangs from, rig frame at rest. */
  at: readonly [number, number, number];
  /** Its length and its width at the root and at the end (model heights). */
  len: number;
  w0: number;
  w1: number;
  /** How hard the breeze takes it (1: a hem strip). */
  sail?: number;
  color: number;
}

const RED = 0xb0231a;
/** The concept's hem torn into strips flying back, and the red cords hung from the sash. */
export const FLOWS: Record<string, readonly Strip[]> = {
  hero: [
    { bone: 'Hip', at: [-0.13, 0.07, 0.5], len: 0.34, w0: 0.08, w1: 0.015, color: RED },
    { bone: 'Hip', at: [-0.14, 0.0, 0.52], len: 0.42, w0: 0.1, w1: 0.012, color: RED },
    { bone: 'Hip', at: [-0.13, -0.07, 0.5], len: 0.3, w0: 0.075, w1: 0.015, color: RED },
    { bone: 'Waist', at: [0.08, 0.05, 0.6], len: 0.3, w0: 0.014, w1: 0.01, sail: 0.7, color: RED },
    { bone: 'Waist', at: [0.08, 0.02, 0.6], len: 0.24, w0: 0.014, w1: 0.01, sail: 0.7, color: RED },
  ],
};

/** Points along a strip. */
const N = 7;
/** Physics steps a second. */
const HZ = 60;
const LINE = new MeshBasicMaterial({ color: INK, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
const mats = new Map<number, MeshBasicMaterial>();
function cloth(color: number): MeshBasicMaterial {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new MeshBasicMaterial({ color: new Color(color), side: DoubleSide })));
  return m;
}

const _a = new Vector3();
const _d = new Vector3();
const _w = new Vector3();
const VIEW = new Vector3(0, 0, 1);

class Chain {
  readonly p: Vector3[] = [];
  readonly q: Vector3[] = [];
  readonly seg: number;
  readonly fill: Mesh;
  readonly rim: Mesh;
  private readonly pos = new Float32Array(N * 2 * 3);
  private readonly rimPos = new Float32Array(N * 2 * 3);
  private readonly local: Vector3;
  private started = false;

  constructor(
    readonly s: Strip,
    private readonly bone: Object3D,
    body: Object3D,
    mh: number,
    private readonly H: number,
  ) {
    // the hanging point in the bone's own space (the glTF is y up: rig (x, y, z) is (x, z, -y))
    this.local = bone.worldToLocal(body.localToWorld(new Vector3(s.at[0], s.at[2], -s.at[1]).multiplyScalar(mh)));
    this.seg = (s.len * H) / (N - 1);
    for (let i = 0; i < N; i++) {
      this.p.push(new Vector3());
      this.q.push(new Vector3());
    }
    const index: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = (pos: Float32Array) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setIndex(index);
      return g;
    };
    this.fill = new Mesh(geo(this.pos), cloth(s.color));
    this.rim = new Mesh(geo(this.rimPos), LINE);
    for (const m of [this.fill, this.rim]) m.frustumCulled = false;
  }

  /** Where it hangs from now, in the room. */
  anchor(out: Vector3): Vector3 {
    return this.bone.localToWorld(out.copy(this.local));
  }

  /** One step of `h` seconds with the breeze `wind` (room units a second squared). */
  step(h: number, wind: Vector3, ground: number, t: number, k: number): void {
    const a = this.anchor(_a);
    if (!this.started || this.p[0].distanceTo(a) > this.H) {
      // first seen (or carried off): hung straight down, still
      for (let i = 0; i < N; i++) this.p[i].set(a.x, a.y - i * this.seg, a.z), this.q[i].copy(this.p[i]);
      this.started = true;
    }
    const g = -5.0 * this.H;
    const sail = this.s.sail ?? 1;
    for (let i = 1; i < N; i++) {
      const p = this.p[i];
      const q = this.q[i];
      // the breeze takes the loose end more, and flutters along the strip
      const f = (i / (N - 1)) * sail;
      const flick = 0.75 + 0.25 * Math.sin(t * 9 + i * 1.3 + k * 2.1);
      _d.copy(p).sub(q).multiplyScalar(0.94);
      q.copy(p);
      p.add(_d);
      p.x += wind.x * f * flick * h * h;
      p.y += (g + wind.y * f * flick) * h * h;
      p.z += wind.z * f * flick * h * h;
    }
    this.p[0].copy(a);
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < N; i++) {
        const p0 = this.p[i - 1];
        const p1 = this.p[i];
        _d.copy(p1).sub(p0);
        const l = _d.length() || 1e-6;
        p1.copy(p0).addScaledVector(_d, this.seg / l);
      }
      for (let i = 1; i < N; i++) if (this.p[i].y < ground + 1) this.p[i].y = ground + 1;
    }
  }

  /** The ribbon through the points, `origin` taken off (the meshes ride on the body's root). */
  draw(origin: Vector3): void {
    for (let i = 0; i < N; i++) {
      const p = this.p[i];
      _d.copy(this.p[Math.min(N - 1, i + 1)]).sub(this.p[Math.max(0, i - 1)]);
      _w.crossVectors(_d, VIEW);
      if (_w.lengthSq() < 1e-8) _w.set(1, 0, 0);
      _w.normalize();
      const k = i / (N - 1);
      const w = ((this.s.w0 + (this.s.w1 - this.s.w0) * k) * this.H) / 2;
      const r = w + 0.006 * this.H;
      const x = p.x - origin.x;
      const y = p.y - origin.y;
      const z = p.z - origin.z;
      this.pos.set([x + _w.x * w, y + _w.y * w, z + _w.z * w, x - _w.x * w, y - _w.y * w, z - _w.z * w], i * 6);
      this.rimPos.set([x + _w.x * r, y + _w.y * r, z + _w.z * r, x - _w.x * r, y - _w.y * r, z - _w.z * r], i * 6);
    }
    this.fill.geometry.attributes.position.needsUpdate = true;
    this.rim.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.rim.geometry.dispose();
  }
}

export class Flow {
  readonly group = new Group();
  private readonly chains: Chain[] = [];
  private left = 0;
  private t = 0;
  private readonly wind = new Vector3();

  /** `body`: the scaled model at rest, `mh` its height in its own units; `H`: its height in the room. */
  constructor(strips: readonly Strip[], bones: Record<string, Object3D>, body: Object3D, mh: number, H: number) {
    body.updateMatrixWorld(true);
    for (const s of strips) {
      const b = bones[s.bone];
      if (!b) continue;
      const c = new Chain(s, b, body, mh, H);
      this.chains.push(c);
      this.group.add(c.rim, c.fill);
    }
    this.H = H;
  }

  private readonly H: number;

  /** Runs the cloth on by `dt`; `yaw` the way the body faces, `origin` the root it rides on. */
  update(dt: number, yaw: number, origin: Vector3, ground: number): void {
    this.left = Math.min(this.left + dt, 4 / HZ);
    const h = 1 / HZ;
    while (this.left >= h) {
      this.left -= h;
      this.t += h;
      // a breeze at the body's back, a little up, gusting
      const gust = 0.85 + 0.15 * Math.sin(this.t * 1.7) * Math.sin(this.t * 0.6 + 1);
      const s = 12 * this.H * gust;
      this.wind.set(-Math.cos(yaw) * s, 3 * this.H * gust, Math.sin(yaw) * s);
      this.chains.forEach((c, k) => c.step(h, this.wind, ground, this.t, k));
    }
    for (const c of this.chains) c.draw(origin);
  }

  dispose(): void {
    for (const c of this.chains) c.dispose();
  }
}
