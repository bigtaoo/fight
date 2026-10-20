import { botButtons } from '@dnf/engine/bot';
import { Engine, LocalInputSource, TICK_RATE, WORLD, fromFp, runConfig, type DungeonId, type SimEvent, type SimState } from '@dnf/engine';
import { Vector3, ACESFilmicToneMapping, AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { Keyboard } from '../game/keyboard';
import { Clock } from '../net/Session';
import { Actor, DEPTH_K, loadModels, type Model, type ModelFiles } from './actor';
import { Splash } from './splash';
import { Stage } from './stage';
import { WEB_FILES } from './webModels';

// The 3D renderer trial (?three, dev builds only): the same engine, stepped at 30 Hz from the
// keyboard, drawn with three.js instead of PixiJS. Single player on its own, no saves, no HUD
// beyond a line of text; see design/ART.md for what it is meant to answer.

/** Camera: vertical field of view, how far down it looks, and how far back it stands. */
const FOV = 30;
const PITCH = (20 * Math.PI) / 180;
const DIST = 2050;
/** The height on the bodies the camera aims at. */
const AIM_Y = 110;
const VIEW_W = 1920;

/** Where the trial runs when it is not a web page (the WeChat build, main.wechat3d.ts). */
export interface ProtoHost {
  /** The screen's canvas and its WebGL2 context. */
  canvas: HTMLCanvasElement;
  context: WebGL2RenderingContext;
  width: number;
  height: number;
  pixelRatio: number;
  models: ModelFiles;
  /** Where the scenery files are. */
  scenery: string;
  /** About once a second: frames a second, the slowest frame and the draw calls. */
  onStats?: (s: { fps: number; worstMs: number; draws: number; triangles: number }) => void;
}

export async function runProto(params: URLSearchParams, host?: ProtoHost): Promise<void> {
  const renderer = host
    ? new WebGLRenderer({ canvas: host.canvas, context: host.context, antialias: true })
    : new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const width = () => host?.width ?? window.innerWidth;
  const height = () => host?.height ?? window.innerHeight;
  renderer.setPixelRatio(host?.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width(), height(), !host);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let info: { textContent: string | null } = { textContent: '' };
  if (!host) {
    document.body.appendChild(renderer.domElement);
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:12px;top:8px;color:#1c1b1f;font:14px/1.5 monospace;pointer-events:none;white-space:pre';
    document.body.appendChild(div);
    info = div;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, width() / height(), 10, 20000);
  scene.add(new HemisphereLight(0xfff8ec, 0x6a6458, 1.2));
  scene.add(new AmbientLight(0xffffff, 0.3));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-600, 1400, 1200);
  scene.add(sun);
  const stage = new Stage(scene, host?.scenery);
  const ink = new Splash();
  const cinnabar = new Splash(0xb3261e);
  scene.add(ink.points, cinnabar.points);
  const at = new Vector3();

  const models = await loadModels(host?.models ?? WEB_FILES);
  const dungeon = (params.get('dungeon') ?? 'trial') as DungeonId;
  let engine = new Engine(runConfig({ seed: Number(params.get('seed') ?? 1), dungeon }), new LocalInputSource());
  const clock = new Clock(1000 / TICK_RATE);
  // on the web the keyboard plays; elsewhere (and with ?bot) the engine's own bot does
  const keys = host || params.has('bot') ? null : new Keyboard();
  const actors = new Map<number, Actor>();
  let shake = 0;
  // debugging from the console: proto.pause(true), then proto.step(n, buttons) moves n ticks
  let paused = false;
  let dist = DIST;
  const tick = (buttons: number) => {
    engine.submit({ owner: 0, tick: engine.nextTick, buttons });
    onEvents(engine.advance() ?? []);
  };
  (window as unknown as { proto: unknown }).proto = {
    models,
    actors: () => actors,
    scene,
    engine: () => engine,
    pause: (on: boolean) => (paused = on),
    dist: (d: number) => (dist = d),
    step: (n: number, buttons = 0) => {
      for (let i = 0; i < n; i++) tick(i === 0 ? buttons : 0);
      draw(1 / TICK_RATE, 1);
    },
    film: (buttons: number, ticks: number, sub?: number, every?: number) => film(buttons, ticks, sub, every),
    unfilm: () => document.querySelector('canvas[data-film]')?.remove(),
  };
  let fps = 0;
  let last = performance.now();

  const modelFor = (kind: string): { model: Model; tint: number } =>
    kind === 'hero' ? { model: models.hero, tint: 0xffffff } : { model: models.archer, tint: kind === 'elite' ? 0xd08870 : kind === 'chief' ? 0xa07060 : 0xb8bcc8 };

  const sync = (s: SimState) => {
    const live = new Set(s.entities.map((e) => e.id));
    for (const [id, a] of actors) {
      if (!live.has(id)) {
        a.dispose();
        actors.delete(id);
      }
    }
    for (const e of s.entities) {
      if (actors.has(e.id)) continue;
      const { model, tint } = modelFor(e.kind);
      const a = new Actor(e.id, e.kind, model, tint, e.kind !== 'archer');
      actors.set(e.id, a);
      scene.add(a.root, a.floorShadow, a.trail.mesh);
    }
  };

  const onEvents = (events: readonly SimEvent[]) => {
    for (const ev of events) {
      if (ev.type === 'hit') {
        const a = actors.get(ev.target);
        if (a && !ev.blocked && !ev.armor) a.flash = 0.08;
        at.set(fromFp(ev.x), fromFp(ev.z) + 120, fromFp(ev.y) * DEPTH_K);
        const power = ev.blocked ? 0.4 : ev.launch || ev.stop >= 5 ? 1.4 : 1;
        ink.burst(at, ev.dir, ev.blocked ? 8 : 26, power);
        if (ev.crit) cinnabar.burst(at, ev.dir, 14, power * 1.2);
        if (ev.stop >= 5 || ev.launch) shake = Math.max(shake, 0.14);
      } else if (ev.type === 'roomEnter') {
        for (const a of actors.values()) a.dispose();
        actors.clear();
      }
    }
  };

  const restart = () => (engine = new Engine(runConfig({ seed: engine.state.config.seed + 1, dungeon }), new LocalInputSource()));
  if (!host) {
    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyR') restart();
    });
  }

  /** Draws the state `alpha` of the way from the last tick to the current one, `dt` seconds on. */
  const draw = (dt: number, alpha: number) => {
    renderer.info.reset();
    const s = engine.state;
    const roomW = fromFp(s.roomWidth);
    void stage.show(s.config.dungeon, s.room, roomW);
    sync(s);
    for (const e of s.entities) actors.get(e.id)!.update(e, alpha, dt);
    const pxPerUnit = renderer.domElement.height / (2 * Math.tan((FOV * Math.PI) / 360));
    ink.update(dt, pxPerUnit);
    cinnabar.update(dt, pxPerUnit);

    // the camera follows the hero along x, kept inside the room like the 2D one
    const hero = s.entities.find((e) => e.team === 0);
    const hx = hero ? fromFp(hero.px + (hero.x - hero.px) * alpha) : roomW / 2;
    // half the width the camera sees at the bodies' depth (VIEW_W on a 16:9 screen)
    const halfView = Math.tan((FOV * Math.PI) / 360) * dist * camera.aspect;
    const cx = Math.min(Math.max(hx + VIEW_W * 0.1, halfView), Math.max(halfView, roomW - halfView));
    shake = Math.max(0, shake - dt);
    const sx = shake > 0 ? (Math.random() - 0.5) * 16 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * 10 : 0;
    const tz = (fromFp(WORLD.depth) * DEPTH_K) / 2;
    camera.position.set(cx + sx, AIM_Y + Math.sin(PITCH) * dist + sy, tz + Math.cos(PITCH) * dist);
    camera.lookAt(cx + sx, AIM_Y + sy, tz);
    stage.render(renderer, camera, cx - halfView, cx, () => renderer.render(scene, camera));

    const hp = hero ? `${hero.hp}/${hero.maxHp}` : '-';
    info.textContent = `3D trial  ${fps.toFixed(0)} fps  draws ${renderer.info.render.calls}  hero ${hp}  room ${s.room}  ${s.outcome}\n` + `arrows move, X attack, C jump, Z dodge, A S D F skills, R restart`;
    return hero;
  };

  renderer.info.autoReset = false;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    if (paused) return;
    const n = clock.ticks(dt * 1000);
    for (let i = 0; i < n; i++) tick(keys ? keys.read() : botButtons(engine.state, 0));
    // the bot plays on: a new run when this one ends
    if (!keys && engine.state.outcome !== 'playing') restart();
    draw(dt, clock.alpha);
    stats(dt);
  });

  let frames = 0;
  let span = 0;
  let worst = 0;
  function stats(dt: number): void {
    frames++;
    span += dt;
    worst = Math.max(worst, dt);
    if (span < 1) return;
    host?.onStats?.({ fps: frames / span, worstMs: worst * 1000, draws: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    frames = span = worst = 0;
  }

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
    const v = new Vector3();
    let f = 0;
    for (let t = 0; t < ticks; t++) {
      tick(t === 0 ? buttons : 0);
      for (let k = 1; k <= sub; k++, f++) {
        const hero = draw(1 / TICK_RATE / sub, k / sub);
        if (f % every || !hero) continue;
        const i = f / every;
        v.set(fromFp(hero.x), fromFp(hero.z) + 110, fromFp(hero.y) * DEPTH_K).project(camera);
        const c = renderer.domElement;
        const px = ((v.x + 1) / 2) * c.width;
        const py = ((1 - v.y) / 2) * c.height;
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
