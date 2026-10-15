import { Application } from 'pixi.js';
import { Game } from './game/Game';
import { initLang, readKeyboardLayout } from './i18n';
import { initPlatform, platform } from './platform';

async function main(): Promise<void> {
  // the URL switches (?bot, ?seed, ?dungeon, ?debug, ?bench...) are for development: a release
  // build reads none, so a player on the platform cannot cheat or break the game with one
  const params = new URLSearchParams(import.meta.env.DEV ? location.search : '');
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
  // the platform first: the language and the saves come from it (when the page has its SDK)
  await initPlatform();
  platform.loadingStart();
  initLang(platform.locale, params.get('lang'));
  await readKeyboardLayout();
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1c1b1f, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2) });
  document.body.appendChild(app.canvas);
  const game = new Game(app, params);
  await game.load();
  platform.loadingStop();
}

void main();
