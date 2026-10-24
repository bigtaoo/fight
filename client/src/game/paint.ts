import { FONT, PAPER, RED } from './dom';

// Canvas 2D drawing shared by the select scroll and the section-end card as a renderer without a
// DOM draws them (scrollCanvas.ts, sectionEndCanvas.ts): the seal, vertical writing, rounded
// boxes, a picture's colour laid over its ink with a soft edge. Sizes in CSS pixels.

/** A canvas or an image, as both the browser and the WeChat runtime give them. */
export type Picture = CanvasImageSource & { width: number; height: number };

/** A spare canvas (the WeChat shim makes one with wx.createCanvas). */
export function spareCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Loads a picture; resolves with it, or null when it cannot be read. */
export function loadPicture(src: string): Promise<Picture | null> {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size.toFixed(1)}px ${FONT}`;
}

const HAN = /[一-鿿]/;

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Text written across with `spacing` px between the characters (a canvas may lack letterSpacing),
 * centred on `cx`. */
export function spaced(g: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number): void {
  const widths = [...text].map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (widths.length - 1);
  let x = cx - total / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  [...text].forEach((c, i) => {
    g.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  g.textAlign = align;
}

/** Text written down a column whose top centre is (cx, y), `size` px characters at `lead` times
 * their size apart: Chinese upright, a Latin run turned on its side as vertical-rl sets it.
 * Returns the column's height. */
export function column(g: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, lead = 1.1): number {
  g.font = g.font.replace(/[\d.]+px/, `${size}px`);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let at = y;
  for (const run of text.match(/[一-鿿]|[^一-鿿]+/g) ?? []) {
    if (HAN.test(run)) {
      g.fillText(run, cx, at + (size * lead) / 2);
      at += size * lead;
    } else {
      const w = g.measureText(run).width;
      g.save();
      g.translate(cx, at + w / 2);
      g.rotate(Math.PI / 2);
      g.fillText(run, 0, 0);
      g.restore();
      at += w + size * (lead - 1);
    }
  }
  return at - y;
}

/** The height `column` would give `text`. */
export function columnHeight(g: CanvasRenderingContext2D, text: string, size: number, lead = 1.1): number {
  g.font = g.font.replace(/[\d.]+px/, `${size}px`);
  let h = 0;
  for (const run of text.match(/[一-鿿]|[^一-鿿]+/g) ?? []) h += HAN.test(run) ? size * lead : g.measureText(run).width + size * (lead - 1);
  return h;
}

/** A red seal with `text` cut white into it (白文), `size` px square, centred on (cx, cy), turned
 * by `turn` radians; `pressed` from 0 (not yet) to 1 (landed) plays it being stamped: it comes
 * down from above, larger, and lands with a little bounce. */
export function seal(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, turn: number, pressed = 1): void {
  if (pressed <= 0) return;
  // cubic-bezier(.5,1.8,.6,1) as the DOM version's transition, near enough: overshoot, settle
  const k = Math.min(1, pressed);
  const ease = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.25;
  const scale = 2.4 + (1 - 2.4) * ease;
  g.save();
  g.globalAlpha *= Math.min(1, k / 0.4);
  g.translate(cx, cy);
  g.rotate(turn);
  g.scale(scale, scale);
  const h = size / 2;
  g.shadowColor = 'rgba(120,20,10,.6)';
  g.shadowBlur = size * 0.04;
  g.fillStyle = RED;
  roundRect(g, -h, -h, size, size, size * 0.08);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(243,238,226,.35)';
  g.lineWidth = size * 0.05;
  roundRect(g, -h + size * 0.025, -h + size * 0.025, size * 0.95, size * 0.95, size * 0.07);
  g.stroke();
  g.fillStyle = PAPER;
  g.font = font(size * 0.4, true);
  if (HAN.test(text)) {
    // two characters, one above the other (more: a second column on the left, as vertical-rl)
    const chars = [...text];
    const per = 2;
    const cols = Math.ceil(chars.length / per);
    const cs = size * 0.4;
    for (let c = 0; c < cols; c++) {
      const x = (cols === 1 ? 0 : (cols - 1) / 2 - c) * cs * 1.05;
      const part = chars.slice(c * per, c * per + per);
      part.forEach((ch, i) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(ch, x, (i - (part.length - 1) / 2) * cs * 1.02);
      });
    }
  } else {
    g.font = font(size * 0.22, true);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
  }
  g.restore();
}

/** How far into its stamp a seal pressed `ms` ago is (0..1), for `seal`'s `pressed`. */
export function pressedAt(ms: number): number {
  return Math.max(0, Math.min(1, ms / 280));
}
