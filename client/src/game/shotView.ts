import { SHOTS, fromFp, type Projectile } from '@dnf/engine';
import { Container, Graphics } from 'pixi.js';
import { floorY, lerp } from './layout';

// One projectile: an arrow in flight, an ink shaft with a head and fletching, its shadow on the
// floor under it so its lane reads at a glance; its hit box in debug.

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
    g.ellipse(0, 0, 34, 5).fill({ color: 0x2a2620, alpha: 0.2 });
    const tip = f * 36;
    const tail = -f * 36;
    // a faint streak behind, for the speed
    g.rect(Math.min(tail, tail - f * 60), -z - 1, 60, 2).fill({ color: INK, alpha: 0.25 });
    g.moveTo(tail, -z).lineTo(tip, -z).stroke({ width: 3, color: INK });
    g.poly([tip + f * 12, -z, tip - f * 2, -z - 6, tip - f * 2, -z + 6]).fill(INK);
    for (const s of [-1, 1]) g.moveTo(tail + f * 14, -z).lineTo(tail - f * 2, -z + s * 9).stroke({ width: 2, color: 0x8a4a2a });
    if (debug) {
      const b = SHOTS[p.kind].box;
      const x0 = f > 0 ? fromFp(b.x0) : -fromFp(b.x1);
      g.rect(x0, -z - fromFp(b.z1), fromFp(b.x1 - b.x0), fromFp(b.z1 - b.z0)).stroke({ width: 2, color: 0xc8281e });
    }
  }
}
