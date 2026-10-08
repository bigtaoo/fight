import { Application } from 'pixi.js';
import { Game } from './game/Game';

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1c1b1f, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2) });
  document.body.appendChild(app.canvas);
  const game = new Game(app, new URLSearchParams(location.search));
  await game.load();
}

void main();
