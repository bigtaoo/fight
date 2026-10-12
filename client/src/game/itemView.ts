import { fromFp, type Item } from '@dnf/engine';
import { Container, Graphics } from 'pixi.js';
import { floorY } from './layout';

// A potion on the floor (colour block until its art): a red flask with a cork, its shadow under
// it; it pops out of the fallen monster, then bobs gently so it reads as something to pick up.
// The big one is larger and darker.

const INK = 0x2b2620;

export class ItemView {
  readonly root = new Container();
  private readonly g = new Graphics();
  private age = 0;

  constructor() {
    this.root.addChild(this.g);
  }

  draw(it: Item, dt: number): void {
    this.age += dt;
    const y = fromFp(it.y);
    this.root.position.set(fromFp(it.x), floorY(y));
    this.root.zIndex = y;
    const big = it.kind === 'bigPotion';
    const s = big ? 1.35 : 1;
    // pop: a hop up out of the body over the first 0.4 s, then a slow bob
    const pop = Math.min(1, this.age / 0.4);
    const lift = pop < 1 ? Math.sin(pop * Math.PI) * 60 : 4 + Math.sin(this.age * 3) * 4;
    const g = this.g.clear();
    g.ellipse(0, 0, 18 * s, 5 * s).fill({ color: INK, alpha: 0.25 });
    const by = -lift - 16 * s;
    g.circle(0, by, 13 * s).fill(big ? 0x8e1a14 : 0xc8281e).stroke({ width: 3, color: INK });
    g.rect(-5 * s, by - 24 * s, 10 * s, 12 * s).fill(0xf3eee2).stroke({ width: 2, color: INK });
    g.rect(-6 * s, by - 29 * s, 12 * s, 6 * s).fill(0x8a6a3a);
    // a glint, so it reads as glass
    g.circle(-5 * s, by - 4 * s, 3 * s).fill({ color: 0xffffff, alpha: 0.6 });
  }
}
