import { css, halo, type Overlay } from './dom';
import type { View3D } from '../three/view';

// The numbers and words that float up over the bodies: damage, a potion's heal, poison, an
// affix's word. Each is pinned to a point of the world (engine units: along, height, depth) and
// projected again every frame, so it stays over its body while the camera moves; it rises, pops
// in larger and fades out. They are elements in one layer under the HUD, reused from a pool.

interface Float {
  div: HTMLDivElement;
  x: number;
  height: number;
  depth: number;
  age: number;
  life: number;
  size: number;
  /** What its look was last set to, so the style is written only on a change. */
  look: string;
}

const RISE = 70;

export class Numbers {
  private readonly layer: HTMLDivElement;
  private readonly live: Float[] = [];
  private readonly pool: HTMLDivElement[] = [];

  constructor(private readonly ui: Overlay) {
    this.layer = ui.layer();
  }

  /** A blow's damage over the body it hit: grey when blocked, red when the hero takes it, larger
   * and orange-red on a critical. */
  damage(x: number, height: number, depth: number, dmg: number, taken: boolean, blocked: boolean, crit: boolean): void {
    const size = blocked ? 32 : taken ? 46 : crit ? 68 : 52;
    const color = blocked ? '#8a8478' : taken ? '#c8281e' : crit ? '#d2461e' : '#141317';
    this.add(x + (Math.random() - 0.5) * 30, height, depth, String(dmg), color, size, 0.8);
  }

  /** A potion's heal, in green. */
  heal(x: number, height: number, depth: number, n: number): void {
    this.add(x, height, depth, `+${n}`, '#2f8a3a', 48, 1);
  }

  /** A word (or a small number) in a colour. */
  word(x: number, height: number, depth: number, text: string, color: number, size = 40): void {
    this.add(x, height, depth, text, css(color), size, 0.9);
  }

  clear(): void {
    for (const f of this.live) this.free(f);
    this.live.length = 0;
  }

  /** Moves them on `dt` seconds and places them where their points are now. */
  update(view: View3D, dt: number): void {
    const k = this.ui.k;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        this.free(f);
        this.live.splice(i, 1);
        continue;
      }
      const p = view.project(f.x, f.height, f.depth);
      if (p.behind) {
        f.div.style.display = 'none';
        continue;
      }
      f.div.style.display = '';
      const y = p.y - RISE * k * (1 - (1 - t) ** 2);
      const scale = t < 0.1 ? 1.4 - 4 * t : 1;
      const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      f.div.style.transform = `translate(${p.x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${(scale * k).toFixed(3)})`;
      const look = alpha.toFixed(2);
      if (look !== f.look) {
        f.look = look;
        f.div.style.opacity = look;
      }
    }
  }

  private add(x: number, height: number, depth: number, text: string, color: string, size: number, life: number): void {
    const div = this.pool.pop() ?? this.make();
    div.textContent = text;
    div.style.color = color;
    div.style.fontSize = `${size}px`;
    div.style.opacity = '1';
    div.style.display = 'none';
    this.layer.appendChild(div);
    this.live.push({ div, x, height, depth, age: 0, life, size, look: '1.00' });
  }

  private make(): HTMLDivElement {
    const div = document.createElement('div');
    div.style.cssText = `position:absolute;left:0;top:0;white-space:pre;transform-origin:50% 50%;text-shadow:${halo(3)}`;
    return div;
  }

  private free(f: Float): void {
    f.div.remove();
    this.pool.push(f.div);
  }
}
