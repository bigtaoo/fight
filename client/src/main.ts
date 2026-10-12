import { Application } from 'pixi.js';
import { Game } from './game/Game';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('bench')) {
    // the performance measurement instead of the game (see bench/bench.ts)
    const out = document.createElement('pre');
    out.style.cssText = 'color:#f3eee2;font:16px/1.6 monospace;padding:24px;white-space:pre-wrap';
    document.body.style.background = '#1c1b1f';
    document.body.appendChild(out);
    out.textContent = '测量中…';
    const { runBench } = await import('./bench/bench');
    return runBench(out);
  }
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1c1b1f, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2) });
  document.body.appendChild(app.canvas);
  const game = new Game(app, params);
  await game.load();
}

void main();
