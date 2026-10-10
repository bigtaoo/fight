import { SHOTS, fromFp, type Projectile } from '@dnf/engine';
import { Container, Graphics } from 'pixi.js';
import { floorY, lerp } from './layout';

// One projectile: an arrow in flight, an ink shaft with a head and fletching, or the sword wave,
// a tall crescent of ink; its shadow on the floor under it so its lane reads at a glance; its hit
// box in debug.

const INK = 0x2b2620;

export class ShotView {
  readonly root = new Container();
  private readonly g = new Graphics();

  constructor() {
    this.root.addChild(this.g);
  }

  draw(p: Projectile, alpha: number, debug: boolean): void {
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    const z = lerp(p.pz, p.z, alpha);
    this.root.position.set(x, floorY(y));
    this.root.zIndex = y;
    const f = Math.sign(p.vx);
    const g = this.g.clear();
    if (p.kind === 'wave') this.wave(g, p, f, z);
    else this.arrow(g, f, z);
    if (debug) {
      const b = SHOTS[p.kind].box;
      const x0 = f > 0 ? fromFp(b.x0) : -fromFp(b.x1);
      g.rect(x0, -z - fromFp(b.z1), fromFp(b.x1 - b.x0), fromFp(b.z1 - b.z0)).stroke({ width: 2, color: 0xc8281e });
    }
  }

  private arrow(g: Graphics, f: number, z: number): void {
    g.ellipse(0, 0, 34, 5).fill({ color: 0x2a2620, alpha: 0.2 });
    const tip = f * 36;
    const tail = -f * 36;
    // a faint streak behind, for the speed
    g.rect(Math.min(tail, tail - f * 60), -z - 1, 60, 2).fill({ color: INK, alpha: 0.25 });
    g.moveTo(tail, -z).lineTo(tip, -z).stroke({ width: 3, color: INK });
    g.poly([tip + f * 12, -z, tip - f * 2, -z - 6, tip - f * 2, -z + 6]).fill(INK);
    for (const s of [-1, 1]) g.moveTo(tail + f * 14, -z).lineTo(tail - f * 2, -z + s * 9).stroke({ width: 2, color: 0x8a4a2a });
  }

  /** A crescent as tall as its hit box, bulging forward, thinning to dry tips; fading out over
   * its last ticks. */
  private wave(g: Graphics, p: Projectile, f: number, z: number): void {
    const b = SHOTS.wave.box;
    const h = fromFp(b.z1 - b.z0);
    const mid = -z - fromFp(b.z0) - h / 2;
    const fade = Math.min(1, p.life / 6);
    g.ellipse(0, 0, 70, 9).fill({ color: 0x2a2620, alpha: 0.25 * fade });
    const n = 16;
    const outer: number[] = [];
    const inner: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = (u - 0.5) * Math.PI * 0.8;
      const thick = 34 * Math.cos((u - 0.5) * Math.PI);
      outer.push(f * (Math.cos(a) * 60 - 20), mid + Math.sin(a) * h * 0.55);
      inner.push(f * (Math.cos(a) * 60 - 20 - thick), mid + Math.sin(a) * h * 0.5);
    }
    const pts = [...outer];
    for (let i = n; i >= 0; i--) pts.push(inner[i * 2], inner[i * 2 + 1]);
    // a pale wash trailing it, then the stroke
    g.rect(f > 0 ? -140 : 20, mid - h * 0.3, 120, h * 0.6).fill({ color: INK, alpha: 0.08 * fade });
    g.poly(pts).fill({ color: INK, alpha: 0.85 * fade });
  }
}
