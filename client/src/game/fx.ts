import { Container, Graphics, Text } from 'pixi.js';

// Short-lived effects in world space: ink splashes where a hit lands, rising damage numbers, and
// loose ink drops flung by movement (run, jump, land, swing, dash, death). The drops replace the
// specks the paintings came with: those were stuck to the sprite and moved with it, these fly,
// fall, and leave a flattened stain on the floor that fades. Everything here is cosmetic and runs
// on render time, never on the sim.

interface Splash {
  g: Graphics;
  age: number;
  life: number;
  drops: { dx: number; dy: number; r: number }[];
  heavy: boolean;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity, px/s^2; drifting drops (dissolve) have little or none. */
  g: number;
  r: number;
  age: number;
  life: number;
  color: number;
  /** Screen y of the floor under the drop: it stains there instead of falling through. */
  floor: number;
  landed: boolean;
}

export interface Burst {
  /** Count, spread of direction (radians around `dir`), speed range px/s. */
  n: number;
  dir: number;
  spread: number;
  speed: [number, number];
  r: [number, number];
  g?: number;
  life?: number;
  color?: number;
  /** Random offset of the start position, px. */
  jitter?: [number, number];
}

const INK = 0x111014;

interface Num {
  t: Text;
  age: number;
  life: number;
  y0: number;
}

export class Fx {
  readonly layer = new Container();
  private splashes: Splash[] = [];
  private nums: Num[] = [];
  private drops: Drop[] = [];
  private readonly dropG = new Graphics();

  constructor() {
    this.layer.addChild(this.dropG);
  }

  /** Ink drops thrown from (x, y), landing on the floor at screen y `floor`. Angles are screen
   * angles: 0 is right, -PI/2 is up. */
  burst(x: number, y: number, floor: number, b: Burst): void {
    const [jx, jy] = b.jitter ?? [0, 0];
    for (let i = 0; i < b.n; i++) {
      const a = b.dir + (Math.random() - 0.5) * b.spread;
      const v = b.speed[0] + Math.random() * (b.speed[1] - b.speed[0]);
      this.drops.push({
        x: x + (Math.random() - 0.5) * jx,
        y: y + (Math.random() - 0.5) * jy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: b.g ?? 1400,
        r: b.r[0] + Math.random() * (b.r[1] - b.r[0]),
        age: 0,
        life: (b.life ?? 0.6) * (0.7 + Math.random() * 0.6),
        color: b.color ?? INK,
        floor,
        landed: false,
      });
    }
  }

  /** An ink burst at a hit: drops flung outward, more and bigger for heavy hits. */
  splash(x: number, y: number, dir: number, heavy: boolean): void {
    const g = new Graphics();
    g.position.set(x, y);
    const n = heavy ? 11 : 7;
    const drops = Array.from({ length: n }, () => {
      const a = (Math.random() - 0.5) * Math.PI * 1.1 + (dir > 0 ? 0 : Math.PI);
      const v = 60 + Math.random() * (heavy ? 140 : 90);
      return { dx: Math.cos(a) * v, dy: Math.sin(a) * v - 20, r: 4 + Math.random() * (heavy ? 12 : 8) };
    });
    this.layer.addChild(g);
    this.splashes.push({ g, age: 0, life: heavy ? 0.4 : 0.28, drops, heavy });
  }

  damage(x: number, y: number, value: number, taken: boolean): void {
    const t = new Text({
      text: String(value),
      style: {
        fontFamily: 'Georgia, "Songti SC", "SimSun", serif',
        fontSize: taken ? 46 : 52,
        fontWeight: 'bold',
        fill: taken ? 0xc8281e : 0x141317,
        stroke: { color: 0xf3eee2, width: 6 },
      },
    });
    t.anchor.set(0.5, 1);
    t.position.set(x + (Math.random() - 0.5) * 30, y);
    this.layer.addChild(t);
    this.nums.push({ t, age: 0, life: 0.8, y0: t.y });
  }

  update(dt: number): void {
    const g = this.dropG.clear();
    this.drops = this.drops.filter((d) => {
      d.age += dt;
      if (d.age >= d.life) return false;
      if (!d.landed) {
        d.vy += d.g * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.g > 0 && d.vy > 0 && d.y >= d.floor) {
          // splat: a flat stain that lingers a little, then fades
          d.landed = true;
          d.y = d.floor;
          d.life = d.age + 0.5;
        }
      }
      const k = d.age / d.life;
      if (d.landed) g.ellipse(d.x, d.y, d.r * 1.7, d.r * 0.45).fill({ color: d.color, alpha: 0.55 * (1 - k) });
      else g.circle(d.x, d.y, d.r * (1 - k * 0.5)).fill({ color: d.color, alpha: 0.9 * (1 - k * k) });
      return true;
    });
    this.splashes = this.splashes.filter((s) => {
      s.age += dt;
      const k = s.age / s.life;
      if (k >= 1) {
        s.g.destroy();
        return false;
      }
      const ease = 1 - (1 - k) * (1 - k);
      s.g.clear();
      s.g.circle(0, 0, (s.heavy ? 36 : 24) * (1 - k)).fill({ color: 0x111014, alpha: 0.8 * (1 - k) });
      for (const d of s.drops) s.g.circle(d.dx * ease, d.dy * ease + 80 * k * k, d.r * (1 - k * 0.6)).fill({ color: 0x111014, alpha: 1 - k });
      return true;
    });
    this.nums = this.nums.filter((n) => {
      n.age += dt;
      const k = n.age / n.life;
      if (k >= 1) {
        n.t.destroy();
        return false;
      }
      n.t.y = n.y0 - 70 * (1 - (1 - k) * (1 - k));
      n.t.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      n.t.scale.set(k < 0.1 ? 1.4 - k * 4 : 1);
      return true;
    });
  }
}
