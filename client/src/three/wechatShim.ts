// The few browser globals three.js reaches for, made from the WeChat mini-game runtime. Imported
// first by main.wechat3d.ts, before three itself: three looks some of them up as it loads.
//
// What three needs here: `self` with requestAnimationFrame (the render loop), `document` making
// <img> (textures load through ImageLoader) and spare canvases, a TextDecoder (the .glb header),
// performance.now, and event listeners on a canvas and an image, which the runtime spells as
// onload / onerror.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const GameGlobal: any;
declare const wx: any;

declare const __WX_LOG__: string;

/** Sends a line to the log server a debug build names (WX_LOG=http://host:port at build time):
 * DevTools' console and a phone's are out of reach of a script on this PC. */
export function wxLog(kind: string, data: unknown): void {
  if (!__WX_LOG__) return;
  try {
    wx.request({ url: __WX_LOG__, method: 'POST', data: JSON.stringify({ kind, data }), fail: () => {} });
  } catch {
    // no network, no log
  }
}
wxLog('start', {});
wx.onError?.((e: any) => wxLog('error', String(e?.message ?? e).slice(0, 600)));

const g = GameGlobal;
const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();

/** Sets a global the runtime lacks; DevTools' simulator has some as read-only getters. */
function def(key: string, value: unknown): void {
  if (g[key] !== undefined) return;
  try {
    g[key] = value;
  } catch {
    // there already, read-only
  }
}

if (typeof requestAnimationFrame === 'function') def('requestAnimationFrame', requestAnimationFrame);
if (typeof cancelAnimationFrame === 'function') def('cancelAnimationFrame', cancelAnimationFrame);
def('window', g);
def('self', g);
def('innerWidth', win.windowWidth);
def('innerHeight', win.windowHeight);
def('devicePixelRatio', win.pixelRatio);
def('addEventListener', () => {});
def('removeEventListener', () => {});

if (typeof g.performance === 'undefined') {
  // wx's clock counts microseconds
  const p = wx.getPerformance();
  def('performance', { now: () => p.now() / 1000 });
}

/** Gives an object that only has on<type> handlers addEventListener / removeEventListener. */
function listenable<T extends object>(o: T): T {
  const a = o as any;
  if (typeof a.addEventListener === 'function') return o;
  const lists: Record<string, ((this: unknown, ev: unknown) => void)[]> = {};
  a.addEventListener = (type: string, fn: (ev: unknown) => void) => {
    (lists[type] ??= []).push(fn);
    a[`on${type}`] = (ev: unknown) => lists[type].slice().forEach((f) => f.call(o, ev ?? { type, target: o }));
  };
  a.removeEventListener = (type: string, fn: (ev: unknown) => void) => {
    const l = lists[type];
    if (l && l.indexOf(fn) >= 0) l.splice(l.indexOf(fn), 1);
  };
  return o;
}

function element(tag: string): unknown {
  if (tag === 'img') return listenable(wx.createImage());
  if (tag === 'canvas') return listenable(wx.createCanvas());
  throw new Error(`no <${tag}> in a mini-game`);
}

def('document', {});
// newer DevTools simulators have a document of their own, without these
for (const [key, fn] of Object.entries({
  createElementNS: (_ns: string, tag: string) => element(tag),
  createElement: (tag: string) => element(tag),
})) {
  try {
    Object.defineProperty(g.document, key, { value: fn, configurable: true, writable: true });
  } catch {
    // read-only: keep its own
  }
}

if (typeof g.TextDecoder === 'undefined') {
  def('TextDecoder', class {
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (!input) return '';
      const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let s = '';
      for (let i = 0; i < b.length; ) {
        const c = b[i++];
        let cp: number;
        if (c < 0x80) cp = c;
        else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
        else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
        else cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
        s += String.fromCodePoint(cp);
      }
      return s;
    }
  });
}

// three's loaders keep one to cancel fetches; a mini-game reads files without fetch
if (typeof g.AbortController === 'undefined') {
  def('AbortController', class {
    readonly signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
    abort(): void {
      this.signal.aborted = true;
    }
  });
}

/** The screen's canvas (the first one a mini-game makes), ready for three. */
export function screenCanvas(): { canvas: any; width: number; height: number; pixelRatio: number } {
  const canvas = listenable(wx.createCanvas());
  canvas.style = canvas.style ?? {};
  return { canvas, width: win.windowWidth, height: win.windowHeight, pixelRatio: win.pixelRatio };
}
