import { botButtons } from '@dnf/engine/bot';
import { Engine, LocalInputSource, TICK_RATE, fromFp, runConfig, type DungeonId, type SimEvent } from '@dnf/engine';
import { Keyboard } from '../game/keyboard';
import { Clock } from '../net/Session';
import { View3D, type ViewHost } from './view';

// The bare renderer trial (?proto, dev builds only, and the WeChat build): the engine stepped at
// 30 Hz from the keyboard or its own bot, drawn by View3D with a line of numbers and no game
// around it (no saves, no menus), for measuring frame rates and filming moves.

export async function runProto(params: URLSearchParams, host?: ViewHost): Promise<void> {
  const dungeon = (params.get('dungeon') ?? 'trial') as DungeonId;
  const view = await View3D.create(params, dungeon, host);
  const { renderer, camera } = view;
  let info: { textContent: string | null } = { textContent: '' };
  if (!host) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:12px;top:8px;color:#1c1b1f;font:14px/1.5 monospace;pointer-events:none;white-space:pre';
    document.body.appendChild(div);
    info = div;
  }
  const zoom = Number(params.get('zoom') ?? 1);
  if (zoom > 0) view.dist /= zoom;

  let engine = new Engine(runConfig({ seed: Number(params.get('seed') ?? 1), dungeon }), new LocalInputSource());
  const clock = new Clock(1000 / TICK_RATE);
  // on the web the keyboard plays; elsewhere (and with ?bot) the engine's own bot does
  const keys = host || params.has('bot') ? null : new Keyboard();
  // debugging from the console: proto.pause(true), then proto.step(n, buttons) moves n ticks
  let paused = false;
  const tick = (buttons: number) => {
    engine.submit({ owner: 0, tick: engine.nextTick, buttons });
    view.onEvents(engine.advance() ?? [], engine.state);
  };
  const draw = (dt: number, alpha: number) => {
    const s = engine.state;
    const hero = view.draw(s, dt, alpha);
    const hp = hero ? `${hero.hp}/${hero.maxHp}` : '-';
    const r = renderer.info.render;
    info.textContent =
      `3D trial  fx ${view.fx ? (view.postOn ? 'on' : 'no post') : 'off'}  ${view.fps.toFixed(0)} fps${view.gov ? `  q${view.gov.level}` : ''}  draws ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k  cpu ${view.cpu.toFixed(1)}ms  hero ${hp}  room ${s.room}  ${s.outcome}\n` +
      `arrows move, X attack, C jump, Z dodge, A S D F skills, R restart, P post on/off`;
    return hero;
  };
  const restart = () => {
    engine = new Engine(runConfig({ seed: engine.state.config.seed + 1, dungeon }), new LocalInputSource());
    view.clear();
  };
  (window as unknown as { proto: unknown }).proto = {
    view,
    renderer,
    actors: () => view.actors,
    scene: view.scene,
    engine: () => engine,
    pause: (on: boolean) => (paused = view.frozen = on),
    dist: (d: number) => (view.dist = d),
    post: () => view.post,
    camera,
    vfx: () => view.vfx,
    decor: () => view.decor,
    step: (n: number, buttons = 0) => {
      for (let i = 0; i < n; i++) tick(i === 0 ? buttons : 0);
      draw(1 / TICK_RATE, 1);
    },
    /** `n` ticks played by the bot, each drawn (so the effects run as they would), then waits for
     * anything loading; resolves on the tick `until` (given the events) returns true, if given. */
    run: async (n: number, until?: (events: readonly SimEvent[]) => boolean) => {
      for (let i = 0; i < n; i++) {
        engine.submit({ owner: 0, tick: engine.nextTick, buttons: botButtons(engine.state, 0) });
        const evs = engine.advance() ?? [];
        view.onEvents(evs, engine.state);
        draw(1 / TICK_RATE, 1);
        if (until?.(evs)) return i;
        if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return n;
    },
    /** The intervals between drawn frames (ms) since the last call, for soak tests. */
    takeFrames: () => view.intervals.splice(0),
    /** The quality level the frame cap's governor is at (0 is full), or -1 without one. */
    quality: () => view.gov?.level ?? -1,
    film: (buttons: number, ticks: number, sub?: number, every?: number) => film(buttons, ticks, sub, every),
    unfilm: () => document.querySelector('canvas[data-film]')?.remove(),
  };
  if (!host) {
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyR') restart();
      if (ev.code === 'KeyP') view.togglePost();
    });
  }

  view.loop((dt) => {
    if (paused) return;
    const n = clock.ticks(dt * 1000);
    for (let i = 0; i < n; i++) tick(keys ? keys.read() : botButtons(engine.state, 0));
    // the bot plays on: a new run when this one ends
    if (!keys && engine.state.outcome !== 'playing') restart();
    draw(dt, clock.alpha);
  });

  /** A strip of frames round the hero: `ticks` ticks from pressing `buttons`, `sub` frames a
   * tick, laid over the page (proto.film(16, 11) is the first cut). Pauses the game. */
  function film(buttons: number, ticks: number, sub = 2, every = 1): void {
    paused = true;
    const cell = 260;
    const frames = Math.ceil((ticks * sub) / every);
    const cols = Math.min(frames, 8);
    const out = document.createElement('canvas');
    out.width = cols * cell;
    out.height = Math.ceil(frames / cols) * cell;
    out.style.cssText = 'position:fixed;left:0;top:0;width:100%;background:#fff;z-index:9';
    const g = out.getContext('2d')!;
    g.font = '16px monospace';
    let f = 0;
    for (let t = 0; t < ticks; t++) {
      tick(t === 0 ? buttons : 0);
      for (let k = 1; k <= sub; k++, f++) {
        const hero = draw(1 / TICK_RATE / sub, k / sub);
        if (f % every || !hero) continue;
        const i = f / every;
        const c = renderer.domElement;
        const p = view.project(fromFp(hero.x), fromFp(hero.z) + 110, fromFp(hero.y));
        const px = (p.x / view.width) * c.width;
        const py = (p.y / view.height) * c.height;
        const src = c.height * 0.36;
        const cx = (i % cols) * cell;
        const cy = Math.floor(i / cols) * cell;
        g.drawImage(c, px - src / 2, py - src / 2, src, src, cx, cy, cell, cell);
        g.fillText(`${hero.move || hero.state} ${hero.st}${sub > 1 ? '.' + k : ''}`, cx + 6, cy + 18);
      }
    }
    document.querySelector('canvas[data-film]')?.remove();
    out.dataset.film = '1';
    document.body.appendChild(out);
  }
}
