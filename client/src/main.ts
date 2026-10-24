import { DUNGEONS, type DungeonId } from '@dnf/engine';
import { Game } from './game/Game';
import { initLang, readKeyboardLayout } from './i18n';
import { initPlatform, platform } from './platform';
import { View3D } from './three/view';

async function main(): Promise<void> {
  // the URL switches (?bot, ?seed, ?dungeon, ?bench...) are for development: a release
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
  if (import.meta.env.DEV && params.has('budget')) {
    // what the 3D bodies may cost (three/budget.ts)
    const { runBudget } = await import('./three/budget');
    return runBudget(params);
  }
  if (import.meta.env.DEV && params.has('proto')) {
    // the 3D renderer's bare harness: the bot or the keyboard in a dungeon, no menus (three/proto.ts)
    const { runProto } = await import('./three/proto');
    return runProto(params);
  }
  if (import.meta.env.DEV && params.has('wxui')) {
    // the WeChat mini-game's chapter flow on a dev page: the canvas scroll and end card (three/chapterRun.ts)
    const [{ runChapter }, { browserStore }, { setLang }] = await Promise.all([import('./three/chapterRun'), import('./platform/store'), import('./i18n')]);
    setLang('zh');
    return runChapter(params, {
      store: browserStore,
      art: `${import.meta.env.BASE_URL}art/`,
      listen: (p) => {
        const c = document.querySelector('canvas')!;
        c.style.touchAction = 'none';
        c.addEventListener('pointerdown', (ev) => p.down(ev.clientX, ev.clientY));
        window.addEventListener('pointermove', (ev) => p.move(ev.clientX, ev.clientY));
        window.addEventListener('pointerup', (ev) => p.up(ev.clientX, ev.clientY));
      },
    });
  }
  // the platform first: the language and the saves come from it (when the page has its SDK)
  await initPlatform();
  platform.loadingStart();
  initLang(platform.locale, params.get('lang'));
  await readKeyboardLayout();
  const d = params.get('dungeon');
  const dungeon: DungeonId = d && Object.prototype.hasOwnProperty.call(DUNGEONS, d) ? (d as DungeonId) : 'luobi';
  const view = await View3D.create(params, dungeon);
  const game = new Game(view, params);
  await game.load();
  platform.loadingStop();
}

void main();
