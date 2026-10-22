// The HTML overlay over the 3D view: the HUD, the menus, the panels and the touch controls are
// plain elements laid out on a logical 1920x1080 screen. That screen is not letterboxed as one:
// each part of the overlay sits in a frame of its own, scaled by the same factor but pinned to a
// corner, an edge's middle or the centre of the window, so on a wide phone the controls stay
// under the thumbs and the health bar in the corner.

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const FONT = 'Georgia, "Songti SC", "SimSun", serif';

export const PAPER = '#f3eee2';
export const CELL_BG = '#e6dfcf';
export const INK = '#141317';
export const GREY = '#6f6a60';
export const DARK = '#4a4640';
export const RED = '#c8281e';
export const GREEN = '#3a7a3a';

/** A colour number (0xc8281e) as CSS. */
export const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A ring of paper round the letters, `w` px wide: the ink-on-paper outline the HUD's text has. */
export function halo(w: number, color = PAPER): string {
  const out: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push(`${(Math.cos(a) * w).toFixed(1)}px ${(Math.sin(a) * w).toFixed(1)}px 0 ${color}`);
  }
  return out.join(',');
}

/** A new element, styled by `style` (CSS text), in `parent`, with `text`. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, style = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Text at (x, y) on a frame, its anchor point at `ax`, `ay` of its own size (0.5, 0.5 centres it). */
export function label(parent: HTMLElement, text: string, x: number, y: number, size: number, color = INK, ax = 0, ay = 0, extra = ''): HTMLDivElement {
  const tr = ax || ay ? `transform:translate(${-ax * 100}%,${-ay * 100}%);` : '';
  return el('div', `position:absolute;left:${x}px;top:${y}px;font-size:${size}px;color:${color};white-space:pre;${tr}${extra}`, parent, text);
}

/** A tappable rounded button centred on (x, y). */
export function button(parent: HTMLElement, text: string, x: number, y: number, w: number, h: number, size: number, fill: string, act: () => void, radius = 12): HTMLDivElement {
  const b = el(
    'div',
    `position:absolute;left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px;border-radius:${radius}px;` +
      `background:${fill};border:3px solid ${INK};box-sizing:border-box;color:${PAPER};font-size:${size}px;` +
      'display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre;pointer-events:auto;cursor:pointer',
    parent,
    text,
  );
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    act();
  });
  return b;
}

/** Sets an element's text only when it changed (the HUD is written every frame). */
export function setText(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}

/** Shows or hides an element, only when that changes. */
export function show(e: HTMLElement, on: boolean): void {
  const d = on ? '' : 'none';
  if (e.style.display !== d) e.style.display = d;
}

/** Where a frame is pinned: left, centre or right; top, middle or bottom. */
export type Anchor = `${'l' | 'c' | 'r'}${'t' | 'm' | 'b'}`;

interface Frame {
  div: HTMLDivElement;
  anchor: Anchor;
  tx: number;
  ty: number;
}

export class Overlay {
  readonly root: HTMLDivElement;
  /** The scale from the logical screen to the window's CSS pixels. */
  k = 1;
  private readonly frames: Frame[] = [];

  constructor() {
    const style = el('style', '', document.head);
    style.textContent =
      `#ui{position:fixed;inset:0;pointer-events:none;overflow:hidden;font-family:${FONT};font-weight:bold;` +
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;line-height:1.2}' +
      `#ui .frame{position:absolute;left:0;top:0;width:${VIEW_W}px;height:${VIEW_H}px;transform-origin:0 0}`;
    this.root = el('div', '', document.body);
    this.root.id = 'ui';
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  /** A new frame pinned at `anchor`, above the ones made before it. */
  frame(anchor: Anchor): HTMLDivElement {
    const div = el('div', '', this.root);
    div.className = 'frame';
    const f = { div, anchor, tx: 0, ty: 0 };
    this.frames.push(f);
    this.place(f);
    return div;
  }

  /** A full-window layer (a veil, the touch area), above what was made before it. */
  layer(style = ''): HTMLDivElement {
    return el('div', `position:absolute;inset:0;${style}`, this.root);
  }

  /** A point of the window (CSS pixels) on the logical screen of a frame pinned at `anchor`. */
  toFrame(anchor: Anchor, cx: number, cy: number): { x: number; y: number } {
    const { tx, ty } = this.offset(anchor);
    return { x: (cx - tx) / this.k, y: (cy - ty) / this.k };
  }

  private offset(anchor: Anchor): { tx: number; ty: number } {
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    const k = this.k;
    const room = (a: string, inner: number, full: number) => (a === 'l' || a === 't' ? 0 : a === 'r' || a === 'b' ? full - inner * k : (full - inner * k) / 2);
    return { tx: room(anchor[0], VIEW_W, iw), ty: room(anchor[1], VIEW_H, ih) };
  }

  private place(f: Frame): void {
    const { tx, ty } = this.offset(f.anchor);
    f.tx = tx;
    f.ty = ty;
    f.div.style.transform = `translate(${tx}px,${ty}px) scale(${this.k})`;
  }

  private fit(): void {
    this.k = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    for (const f of this.frames) this.place(f);
  }
}
