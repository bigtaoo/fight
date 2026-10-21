import { botButtons } from '@dnf/engine/bot';
import { Engine, LocalInputSource, TICK_RATE, WORLD, fromFp, runConfig, type DungeonId, type SimEvent, type SimState } from '@dnf/engine';
import { Vector3, AmbientLight, DirectionalLight, HemisphereLight, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { Keyboard } from '../game/keyboard';
import { Clock } from '../net/Session';
import { Decor } from './decor';
import { Governor } from './governor';
import { lodReady, variant } from './lod';
import { Actor, DEPTH_K, loadModels, type Model, type ModelFiles } from './actor';
import { Post } from './post';
import { propWarmup, setGlow } from './props';
import { Splash } from './splash';
import { Stage } from './stage';
import { Vfx } from './vfx';
import { WEB_FILES } from './webModels';

// The 3D renderer trial (?three, dev builds only): the same engine, stepped at 30 Hz from the
// keyboard, drawn with three.js instead of PixiJS. Single player on its own, no saves, no HUD
// beyond a line of text; see design/ART.md for what it is meant to answer.

/** Camera: vertical field of view, how far down it looks, and how far back it stands. */
export const FOV = 30;
export const PITCH = (20 * Math.PI) / 180;
export const DIST = 2050;
/** The height on the bodies the camera aims at. */
export const AIM_Y = 110;
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

/** Points `camera` straight ahead (level, along -z) and slides its picture down instead of tilting
 * it, so the aim, `drop` below and `ahead` in front, still lands in the middle of the screen: a
 * shift lens, as in architectural photographs. Upright things stay upright on screen (a tilted
 * camera leans the pillars at the edges of a wide view); the floor still runs back the same way. */
export function level(camera: PerspectiveCamera, drop: number, ahead: number): void {
  camera.rotation.set(0, 0, 0);
  camera.updateProjectionMatrix();
  // y on screen = (f * y + b * z) / -z in camera space; the aim at (0, -drop, -ahead) goes to 0
  const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
  camera.projectionMatrix.elements[9] = (-f * drop) / ahead;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export async function runProto(params: URLSearchParams, host?: ProtoHost): Promise<void> {
  const renderer = host
    ? new WebGLRenderer({ canvas: host.canvas, context: host.context, antialias: true })
    : new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const width = () => host?.width ?? window.innerWidth;
  const height = () => host?.height ?? window.innerHeight;
  const dpr = host?.pixelRatio ?? Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 2));
  renderer.setPixelRatio(dpr);
  renderer.setSize(width(), height(), !host);
  renderer.outputColorSpace = SRGBColorSpace;
  // the filmic curve is in the lit materials' own shaders (ink.ts bakeTone)
  renderer.toneMapping = NoToneMapping;
  // the effects (on unless ?fx=0): bloom and the finishing pass, particles and brush marks, real
  // shadows and haze; P switches the finishing pass alone, to compare
  const fx = params.get('fx') !== '0';
  let post: Post | null = null;
  setGlow(fx);
  if (fx) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }
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
  scene.add(sun, sun.target);
  /** Where the sun is from what it lights (it follows the camera, so its shadows stay sharp). */
  const SUN = new Vector3(-600, 1900, 1100);
  if (fx) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera;
    c.left = -1500;
    c.right = 1500;
    c.top = 900;
    c.bottom = -900;
    c.near = 500;
    c.far = 4500;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 1.5;
  }
  const stage = new Stage(scene, host?.scenery);
  if (fx) {
    stage.effects();
    post = new Post(renderer, Number(params.get('msaa') ?? 0));
  }
  let postOn = fx;
  /** What P last asked for: the governor's lowest level turns the pass off without forgetting it. */
  let postWanted = fx;
  const ink = new Splash();
  const cinnabar = new Splash(0xb3261e);
  scene.add(ink.points, cinnabar.points);
  const at = new Vector3();

  const models = await loadModels(host?.models ?? WEB_FILES);
  // the budget bench (budget.ts): rank-and-file at 5k tris on the lean skeleton, the boss and elites at 8k
  await lodReady;
  const mob = variant(models.archer, { tris: 5000, bones: 'lean' });
  const lead = variant(models.archer, { tris: 8000, bones: 0 });
  const vfx = fx ? new Vfx(models.hero, post) : null;
  if (vfx) scene.add(vfx.root);
  const decor = fx ? new Decor() : null;
  if (decor) scene.add(decor.root);
  const dungeon = (params.get('dungeon') ?? 'trial') as DungeonId;
  await stage.preload(dungeon, renderer);
  // build every shader the fight will need now, not when the first enemy walks in: one of each
  // kind of body, put in the room for a moment so they compile under the room's own lights
  const warm = [new Actor(-1, 'hero', models.hero, 0xffffff, true), new Actor(-2, 'archer', mob, 0xb8bcc8, true), new Actor(-3, 'chief', lead, 0xa07060, true)];
  for (const a of warm) scene.add(a.root, a.floorShadow, a.trail.mesh);
  const furniture = propWarmup();
  scene.add(furniture);
  const extra = vfx?.warm(true) ?? [];
  decor?.warm(true);
  await renderer.compileAsync(scene, camera);
  // and draw them once: a program's first draw is when three reads back its uniforms and logs
  if (post) {
    renderer.setRenderTarget(post.target);
    renderer.render(scene, camera);
    post.present(renderer, 0, 0);
  } else renderer.render(scene, camera);
  // the governor's last level draws without the finishing pass: compile for the screen too
  if (post) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }
  decor?.drawOverlay(renderer);
  vfx?.warm(false);
  decor?.warm(false);
  for (const o of extra) o.removeFromParent();
  for (const a of warm) a.dispose();
  furniture.removeFromParent();
  let engine = new Engine(runConfig({ seed: Number(params.get('seed') ?? 1), dungeon }), new LocalInputSource());
  const clock = new Clock(1000 / TICK_RATE);
  // on the web the keyboard plays; elsewhere (and with ?bot) the engine's own bot does
  const keys = host || params.has('bot') ? null : new Keyboard();
  const actors = new Map<number, Actor>();
  let shake = 0;
  // debugging from the console: proto.pause(true), then proto.step(n, buttons) moves n ticks
  let paused = false;
  let dist = DIST;
  let airKey = '';
  const tick = (buttons: number) => {
    engine.submit({ owner: 0, tick: engine.nextTick, buttons });
    onEvents(engine.advance() ?? []);
  };
  (window as unknown as { proto: unknown }).proto = {
    models,
    renderer,
    actors: () => actors,
    scene,
    engine: () => engine,
    pause: (on: boolean) => (paused = on),
    dist: (d: number) => (dist = d),
    post: () => post,
    camera,
    vfx: () => vfx,
    decor: () => decor,
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
        onEvents(evs);
        draw(1 / TICK_RATE, 1);
        if (until?.(evs)) return i;
        if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return n;
    },
    /** The intervals between drawn frames (ms) since the last call, for soak tests. */
    takeFrames: () => intervals.splice(0),
    /** The quality level the frame cap's governor is at (0 is full), or -1 without one. */
    quality: () => gov?.level ?? -1,
    film: (buttons: number, ticks: number, sub?: number, every?: number) => film(buttons, ticks, sub, every),
    unfilm: () => document.querySelector('canvas[data-film]')?.remove(),
  };
  let fps = 0;
  /** Smoothed ms of the frame spent on the CPU: ticks, posing and handing the scene to WebGL. */
  let cpu = 0;
  let last = performance.now();
  const intervals: number[] = [];

  const modelFor = (kind: string): { model: Model; tint: number } =>
    kind === 'hero' ? { model: models.hero, tint: 0xffffff } : kind === 'elite' || kind === 'chief'
        ? { model: lead, tint: kind === 'elite' ? 0xd08870 : 0xa07060 }
        : { model: mob, tint: 0xb8bcc8 };

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
      vfx?.onEvent(ev, engine.state, actors);
      if (ev.type === 'hit') {
        const a = actors.get(ev.target);
        if (a && !ev.blocked && !ev.armor) a.flash = 0.08;
        at.set(fromFp(ev.x), fromFp(ev.z) + 120, fromFp(ev.y) * DEPTH_K);
        const power = ev.blocked ? 0.4 : ev.launch || ev.stop >= 5 ? 1.4 : 1;
        ink.burst(at, ev.dir, ev.blocked ? 12 : 40, power);
        if (ev.crit) cinnabar.burst(at, ev.dir, 24, power * 1.2);
        if (ev.stop >= 5 || ev.launch) shake = Math.max(shake, 0.14);
      } else if (ev.type === 'roomClear') decor?.stroke();
      else if (ev.type === 'roomEnter') {
        decor?.stroke();
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
      post?.resize(renderer);
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyR') restart();
      if (ev.code === 'KeyP' && post) postOn = postWanted = !postOn;
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
    // `dist` ahead of the aim and as high as a 20-degree look down, so the view is as wide as before;
    // a heavy blow pushes the camera in a little for an instant
    const d = dist * (1 - (vfx?.punch ?? 0) * 0.035);
    camera.position.set(cx + sx, AIM_Y + Math.tan(PITCH) * d + sy, tz + d);
    level(camera, Math.tan(PITCH) * d, d);
    const feet = hero ? at.set(hx, fromFp(hero.pz + (hero.z - hero.pz) * alpha), fromFp(hero.py + (hero.y - hero.py) * alpha) * DEPTH_K) : undefined;
    if (vfx) {
      const air = stage.showing ?? 'road';
      const key = `${air}:${roomW}`;
      if (key !== airKey) {
        airKey = key;
        vfx.setScene(air, roomW);
        decor?.setScene(air, roomW);
      }
      vfx.update(dt, s, actors, pxPerUnit, cx, alpha);
      vfx.incense(stage.burners, dt);
      decor?.update(dt, cx, pxPerUnit);
      sun.target.position.set(cx, 0, tz);
      sun.position.copy(sun.target.position).add(SUN);
    }
    const t = performance.now() / 1000;
    if (post && postOn) {
      post.paper = stage.paperColor;
      if (feet) {
        const v = at.clone().setY(at.y + 120).project(camera);
        post.focus((v.x + 1) / 2, (v.y + 1) / 2);
      }
      renderer.setRenderTarget(post.target);
      stage.render(renderer, camera, cx - halfView, cx, () => renderer.render(scene, camera), feet);
      post.present(renderer, dt, t);
    } else {
      renderer.setRenderTarget(null);
      stage.render(renderer, camera, cx - halfView, cx, () => renderer.render(scene, camera), feet);
    }
    decor?.drawOverlay(renderer);

    const hp = hero ? `${hero.hp}/${hero.maxHp}` : '-';
    info.textContent = `3D trial  fx ${fx ? (postOn ? 'on' : 'no post') : 'off'}  ${fps.toFixed(0)} fps${gov ? `  q${gov.level}` : ''}  draws ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k  cpu ${cpu.toFixed(1)}ms  hero ${hp}  room ${s.room}  ${s.outcome}\n` + `arrows move, X attack, C jump, Z dodge, A S D F skills, R restart, P post on/off`;
    return hero;
  };

  renderer.info.autoReset = false;
  // `?fps=30`: draw every other display frame (the engine ticks at 30 Hz and each frame is
  // interpolated between ticks), halving the GPU's work and the heat it makes
  const cap = Number(params.get('fps') ?? 0);
  // and what holds the cap (on with it, unless ?gov=0): each level a cheaper picture, sharpness
  // first (the A16 is bound by pixels), then the decorations, then the finishing pass
  const LEVELS = [
    { dpr: 1, decor: true, post: true },
    { dpr: 0.85, decor: true, post: true },
    { dpr: 0.7, decor: true, post: true },
    { dpr: 0.7, decor: false, post: true },
    { dpr: 0.6, decor: false, post: true },
    { dpr: 0.6, decor: false, post: false },
  ];
  const gov =
    cap > 0 && params.get('gov') !== '0'
      ? new Governor(1000 / cap, LEVELS.length, (l) => {
          const q = LEVELS[l];
          renderer.setPixelRatio(Math.max(1, dpr * q.dpr));
          renderer.setSize(width(), height(), !host);
          post?.resize(renderer);
          if (decor) decor.root.visible = q.decor;
          postOn = postWanted && q.post;
        })
      : null;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // skip a display frame only when the next one is nearer the target: rAF times jitter by a few
    // ms, and a margin narrower than half a display frame (8 ms) skips a frame it should draw
    if (cap > 0 && now - last < 1000 / cap - 8) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    if (intervals.length < 4000) intervals.push(now - last);
    if (!paused) gov?.frame(now - last);
    last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    if (paused) return;
    const n = clock.ticks(dt * 1000);
    for (let i = 0; i < n; i++) tick(keys ? keys.read() : botButtons(engine.state, 0));
    // the bot plays on: a new run when this one ends
    if (!keys && engine.state.outcome !== 'playing') restart();
    draw(dt, clock.alpha);
    cpu += (performance.now() - now - cpu) * 0.05;
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
