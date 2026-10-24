import { DOOR_HALF, DUNGEONS, WORLD, fromFp, surfaceUnder, type DungeonId, type Entity, type SimEvent, type SimState } from '@dnf/engine';
import { Vector3, AmbientLight, type Texture, type BufferGeometry, BoxGeometry, Group, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, NoToneMapping, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { Decor } from './decor';
import { Figures } from './figures';
import { Governor } from './governor';
import { lodReady, variant } from './lod';
import { Actor, DEPTH_K, loadMaps, loadModels, loadPictures, type Model, type ModelFiles } from './actor';
import { Beats } from './beats';
import { Post } from './post';
import { propWarmup, setGlow } from './props';
import { Splash } from './splash';
import { IN_SCREEN, PERCHES, Stage } from './stage';
import { Vfx } from './vfx';
import { COLOUR_OF, WEB_FILES } from './webModels';

// The game drawn with three.js: the engine's state, `alpha` of the way from the last tick to the
// current one, as bodies in a painted room, with the effects (bloom and the finishing pass,
// particles and brush marks, real shadows and haze; off with ?fx=0). It only reads the state and
// the events; the game (game/Game.ts) and the trial (proto.ts) step the engine.

/** Camera: vertical field of view, how far down it looks, and how far back it stands. */
export const FOV = 30;
export const PITCH = (20 * Math.PI) / 180;
export const DIST = 2050;
/** The height on the bodies the camera aims at. */
export const AIM_Y = 110;
const VIEW_W = 1920;

/** Where the view draws when it is not a web page (the WeChat build, main.wechat3d.ts). */
export interface ViewHost {
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

/** Each level of the frame cap's governor a cheaper picture: sharpness first (the A16 is bound by
 * pixels), then the decorations, then the finishing pass. */
const LEVELS = [
  { dpr: 1, decor: true, post: true },
  { dpr: 0.85, decor: true, post: true },
  { dpr: 0.7, decor: true, post: true },
  { dpr: 0.7, decor: false, post: true },
  { dpr: 0.6, decor: false, post: true },
  { dpr: 0.6, decor: false, post: false },
];

/** The open doors of a cleared room: a cinnabar wash on the floor, pulsing. */
const DOOR_INK = new MeshBasicMaterial({ color: 0xc8281e, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });

type InkBody = 'inkfisher' | 'inkwasher' | 'inkboatman' | 'inkwood' | 'inkoldman' | 'inkpeddler';

/** Chapter one's monsters: which ink villagers they are drawn as (varied by id), and their tint. */
const INK_BODY: Partial<Record<string, { bodies: readonly InkBody[]; tint: number }>> = {
  inkling: { bodies: ['inkfisher', 'inkwasher', 'inkoldman', 'inkpeddler'], tint: 0xe0dcd4 },
  brute: { bodies: ['inkboatman'], tint: 0xd8c8c0 },
  woodcutter: { bodies: ['inkwood'], tint: 0xffffff },
  fisher: { bodies: ['inkfisher'], tint: 0xc8d0d4 },
  washer: { bodies: ['inkwasher'], tint: 0xd8ccd0 },
  hewer: { bodies: ['inkwood'], tint: 0xc8c0b8 },
  // the birds' placeholders where a build has no model of theirs (art/model3d/bird.py): a small,
  // dark ink villager for the finch, a brown one and a red-gold one for the big sparrow and the pheasant
  finch: { bodies: ['inkwasher'], tint: 0x585058 },
  bigfinch: { bodies: ['inkboatman'], tint: 0x8a6a48 },
  pheasant: { bodies: ['inkwood'], tint: 0xe0a040 },
};

/** Bodies that fight bare-handed or with a bow: no dao in the hand. */
const UNARMED = new Set(['archer', 'inkling', 'brute', 'woodcutter', 'fisher', 'washer', 'hewer', 'finch', 'bigfinch', 'pheasant']);

/** 1-2 ends walking up to the folding screen: the picture is pulled into it. */
const INTO_SCREEN = new Set<DungeonId>(['jiangcun']);
/** Dungeons inside the screen: winning one steps the hero back out into the hall (`leaveScreen`).
 * 1-3's own dungeon goes here once it has one. */
export const OUT_OF_SCREEN = new Set<DungeonId>(['screen', 'pingfeng']);
/** Seconds for the hero to turn gongbi in the screen's painting, or back. */
const GONGBI_SEC = 0.8;

/** Raised floors (Room.platforms): a pale wash on top, a thick ink stroke along the front. */
const PLATFORM_TOP = new MeshBasicMaterial({ color: 0x8a8276, transparent: true, opacity: 0.55, toneMapped: false });
const PLATFORM_EDGE = new MeshBasicMaterial({ color: 0x1a1816, toneMapped: false });
/** The top over a painted perch: just enough to show how deep the platform runs, writing no depth
 * so the half of the piece below it (it stands across the middle) still shows through. */
const PERCH_TOP = new MeshBasicMaterial({ color: 0x8a8276, transparent: true, opacity: 0.15, depthWrite: false, toneMapped: false });
/** A perch is drawn this much wider than its platform, so its ends do not stop at the edge. */
const PERCH_OVERHANG = 1.15;
/** How far above the floor a perch in the air keeps its lowest twig. */
const PERCH_CLEAR = 12;

export class View3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly actors = new Map<number, Actor>();
  readonly fx: boolean;
  post: Post | null = null;
  /** The finishing pass is drawn; P switches it (postWanted), the governor's last level drops it. */
  postOn: boolean;
  postWanted: boolean;
  vfx: Vfx | null = null;
  decor: Decor | null = null;
  gov: Governor | null = null;
  /** The camera's distance (?zoom brings it in). */
  dist = DIST;
  /** Smoothed frames a second, and ms of the frame spent on the CPU. */
  fps = 0;
  cpu = 0;
  /** The intervals between drawn frames (ms), for soak tests. */
  readonly intervals: number[] = [];
  /** No frames counted for the governor (a debugger holding the trial still). */
  frozen = false;
  private readonly stage: Stage;
  private readonly sun: DirectionalLight;
  private readonly ink = new Splash();
  private readonly cinnabar = new Splash(0xb3261e);
  private readonly at = new Vector3();
  private readonly doors: Mesh[] = [];
  private readonly platforms = new Group();
  private platformKey = '';
  private models!: { hero: Model; mob: Model; lead: Model; ink: Partial<Record<InkBody, Model>>; birds: Record<string, Model> };
  private shake = 0;
  private airKey = '';
  private time = 0;
  /** Where the last monster fell (world units), for the colour to flow back from. */
  private readonly lastKill = new Vector3();
  private killed = false;
  /** How far the hero is drawn as gongbi (in the screen's painting, see Actor.gongbi). */
  private gongbi = 0;
  /** Colour drains from a room monsters hold (Post.drained); ?drain=0 keeps it. */
  drainOn: boolean;
  /** 1-1's staged moments (beats.ts); the ink villagers' bodies by actor, and the colour pictures
   * they had (web only: loaded on the side, a villager drawn ink from the start without). */
  private beats!: Beats;
  private readonly bodyOf = new Map<number, InkBody>();
  private colours: Record<string, Texture> = {};
  private figures!: Figures;
  /** ?beast=<name>: every monster drawn as that bird or beast (art/model3d/bird.py), to look at one. */
  private readonly beast: string | null;

  private constructor(
    private readonly params: URLSearchParams,
    private readonly host?: ViewHost,
  ) {
    const renderer = host
      ? new WebGLRenderer({ canvas: host.canvas, context: host.context, antialias: true })
      : new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer = renderer;
    renderer.setPixelRatio(this.dpr);
    renderer.setSize(this.width, this.height, !host);
    renderer.outputColorSpace = SRGBColorSpace;
    // the filmic curve is in the lit materials' own shaders (ink.ts bakeTone)
    renderer.toneMapping = NoToneMapping;
    renderer.info.autoReset = false;
    this.fx = params.get('fx') !== '0';
    this.beast = params.get('beast');
    this.postOn = this.postWanted = this.fx;
    this.drainOn = params.get('drain') !== '0';
    setGlow(this.fx);
    if (this.fx) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
    }
    if (!host) document.body.appendChild(renderer.domElement);

    const scene = this.scene;
    this.camera = new PerspectiveCamera(FOV, this.width / this.height, 10, 20000);
    scene.add(new HemisphereLight(0xfff8ec, 0x6a6458, 1.2));
    scene.add(new AmbientLight(0xffffff, 0.3));
    const sun = (this.sun = new DirectionalLight(0xffffff, 2.2));
    sun.position.set(-600, 1400, 1200);
    scene.add(sun, sun.target);
    if (this.fx) {
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
    this.stage = new Stage(scene, host?.scenery);
    if (this.fx) {
      this.stage.effects();
      // MSAA only off a touch screen: phones pay too much for it (Post), a desktop GPU does not
      const msaa = !host && navigator.maxTouchPoints === 0 ? 4 : 0;
      this.post = new Post(renderer, Number(params.get('msaa') ?? msaa));
      // ?reveal[=seconds]: the first room painted in on blank paper, a moment after it is shown
      if (params.has('reveal')) {
        const post = this.post;
        post.blank();
        setTimeout(() => post.reveal(Number(params.get('reveal')) || undefined), 800);
      }
    }
    scene.add(this.ink.points, this.cinnabar.points);
    if (!host) {
      window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.post?.resize(renderer);
      });
    }
  }

  get width(): number {
    return this.host?.width ?? window.innerWidth;
  }

  get height(): number {
    return this.host?.height ?? window.innerHeight;
  }

  private get dpr(): number {
    return this.host?.pixelRatio ?? Number(this.params.get('dpr') ?? Math.min(window.devicePixelRatio, 2));
  }

  /** The view with its models loaded, the scenery of `dungeon` on the GPU and every shader the
   * fight will need built. */
  static async create(params: URLSearchParams, dungeon: DungeonId, host?: ViewHost): Promise<View3D> {
    const v = new View3D(params, host);
    await v.load(dungeon);
    return v;
  }

  private async load(dungeon: DungeonId): Promise<void> {
    const { renderer, scene, camera } = this;
    const models = await loadModels(this.host?.models ?? WEB_FILES);
    // the budget bench (budget.ts): rank-and-file at 5k tris on the lean skeleton, the boss and elites at 8k
    await lodReady;
    // chapter one's ink villagers on the same budgets (left out of a build that does not pack them)
    const ink: Partial<Record<InkBody, Model>> = {};
    for (const [name, b] of Object.entries(models.bodies)) if (name.startsWith('ink')) ink[name as InkBody] = variant(b, name === 'inkwood' ? { tris: 8000, bones: 0 } : { tris: 5000, bones: 'lean' });
    this.models = { hero: models.hero, mob: variant(models.archer, { tris: 5000, bones: 'lean' }), lead: variant(models.archer, { tris: 8000, bones: 0 }), ink, birds: models.birds };
    void (this.host ? loadPictures(this.host.models.colours ?? {}) : loadMaps(COLOUR_OF)).then((maps) => {
      for (const t of Object.values(maps)) this.renderer.initTexture(t);
      this.colours = maps;
    });
    // the scenery's figures: the child as it is, the beasts on their own skeletons
    this.figures = new Figures(scene, { ...models.birds, ...(models.bodies.child ? { child: models.bodies.child } : {}) }, (name) => this.colours[name] ?? null);
    const vfx = (this.vfx = this.fx ? new Vfx(models.hero, this.post) : null);
    if (vfx) scene.add(vfx.root);
    const decor = (this.decor = this.fx ? new Decor() : null);
    if (decor) scene.add(decor.root);
    this.beats = new Beats(
      {
        scene,
        post: this.post,
        decor,
        ink: this.ink,
        cinnabar: this.cinnabar,
        colourOf: (id) => this.colours[this.bodyOf.get(id) ?? ''] ?? null,
        shake: (sec) => this.shakeFor(sec),
      },
      this.host ? 'art/props/' : `${import.meta.env.BASE_URL}art/props/`,
    );
    await this.preload(dungeon);
    // build every shader the fight will need now, not when the first enemy walks in: one of each
    // kind of body, put in the room for a moment so they compile under the room's own lights
    const m = this.models;
    const warm = [new Actor(-1, 'hero', m.hero, 0xffffff, true), new Actor(-2, 'archer', m.mob, 0xb8bcc8, true), new Actor(-3, 'chief', m.lead, 0xa07060, true)];
    for (const a of warm) scene.add(a.root, a.floorShadow, a.trail.mesh);
    const furniture = propWarmup();
    scene.add(furniture);
    const extra = vfx?.warm(true) ?? [];
    decor?.warm(true);
    await renderer.compileAsync(scene, camera);
    // and draw them once: a program's first draw is when three reads back its uniforms and logs
    const post = this.post;
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
  }

  /** Fetches the scenery of every room of `dungeon` and hands it to the GPU (each scene once). */
  preload(dungeon: DungeonId): Promise<void> {
    return this.stage.preload(dungeon, this.renderer);
  }

  /** A new run: no bodies left over from the last one. */
  clear(): void {
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.figures?.clear();
    this.shake = 0;
    this.stage.instead = null;
    this.post?.settle();
  }

  /** Shakes the camera for `sec` seconds at least. */
  shakeFor(sec: number): void {
    this.shake = Math.max(this.shake, sec);
  }

  /** The effects of a tick's events. */
  onEvents(events: readonly SimEvent[], s: SimState): void {
    const at = this.at;
    for (const ev of events) {
      this.vfx?.onEvent(ev, s, this.actors);
      this.beats.onEvent(ev, s);
      if (ev.type === 'hit') {
        const a = this.actors.get(ev.target);
        if (a && !ev.blocked && !ev.armor) a.flash = 0.08;
        at.set(fromFp(ev.x), fromFp(ev.z) + 120, fromFp(ev.y) * DEPTH_K);
        const power = ev.blocked ? 0.4 : ev.launch || ev.stop >= 5 ? 1.4 : 1;
        this.ink.burst(at, ev.dir, ev.blocked ? 12 : 40, power);
        if (ev.crit) this.cinnabar.burst(at, ev.dir, 24, power * 1.2);
        if (ev.stop >= 5 || ev.launch) this.shakeFor(0.14);
      } else if (ev.type === 'death') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (e && e.team !== 0) {
          this.lastKill.set(fromFp(e.x), fromFp(e.z) + 90, fromFp(e.y) * DEPTH_K);
          this.killed = true;
        }
      } else if (ev.type === 'roomClear') {
        this.decor?.stroke();
        if (this.post) {
          const v = this.killed ? this.lastKill.project(this.camera) : null;
          this.post.restore(v ? (v.x + 1) / 2 : 0.5, v ? (v.y + 1) / 2 : 0.45);
        }
      } else if (ev.type === 'dungeonClear') {
        if (INTO_SCREEN.has(s.config.dungeon)) this.post?.suckInto(...this.screenAt(s, true));
        else if (OUT_OF_SCREEN.has(s.config.dungeon)) this.leaveScreen(s);
      } else if (ev.type === 'roomEnter') {
        this.decor?.stroke();
        this.clear();
        this.killed = false;
      }
    }
  }

  /** Where on the screen (0..1, y up) the hero goes into a painting or comes out of it: the
   * painting just ahead of them and above their head going in, their own middle coming out. */
  private screenAt(s: SimState, into: boolean): [number, number] {
    const h = s.entities.find((e) => e.team === 0);
    if (!h) return [0.5, 0.55];
    const v = this.at.set(fromFp(h.x) + (into ? 140 : 0), fromFp(h.z) + (into ? 260 : 120), fromFp(h.y) * DEPTH_K * (into ? 0.5 : 1)).project(this.camera);
    return [(v.x + 1) / 2, (v.y + 1) / 2];
  }

  /** The way out of a painting (1-3's end): the hall comes back round the hero, unwinding out of
   * them in ink, and its colour washes back from there. Called on winning a dungeon in
   * `OUT_OF_SCREEN`; a dungeon can call it itself at another moment. */
  leaveScreen(s: SimState): void {
    this.stage.instead = 'parlor';
    this.post?.emerge(...this.screenAt(s, false));
  }

  /** Going into a painting or coming out of one is still playing (the result waits for it). */
  get passing(): boolean {
    return !!this.post && this.postOn && this.post.passing;
  }

  /** Where a point of the world (engine units: along, height, depth) is on the page, in CSS pixels. */
  project(x: number, height: number, depth: number): { x: number; y: number; behind: boolean } {
    const v = this.at.set(x, height, depth * DEPTH_K).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, behind: v.z > 1 };
  }

  /** Draws the state `alpha` of the way from the last tick to the current one, `dt` seconds on;
   * returns the hero, if there is one. */
  draw(s: SimState, dt: number, alpha: number): Entity | undefined {
    const { renderer, scene, camera, at, post, vfx, decor } = this;
    renderer.info.reset();
    this.time += dt;
    const roomW = fromFp(s.roomWidth);
    void this.stage.show(s.config.dungeon, s.room, roomW);
    this.sync(s);
    // in the screen's gongbi painting the hero is drawn gongbi too: fine lines, full colour
    const shown = this.stage.showing;
    const g = shown && IN_SCREEN.has(shown) ? 1 : 0;
    this.gongbi += Math.sign(g - this.gongbi) * Math.min(Math.abs(g - this.gongbi), dt / GONGBI_SEC);
    for (const e of s.entities) {
      const a = this.actors.get(e.id)!;
      if (e.team === 0) a.gongbi = this.gongbi;
      a.update(e, alpha, dt, fromFp(surfaceUnder(s, e.x, e.y, e.z)));
    }
    const pxPerUnit = renderer.domElement.height / (2 * Math.tan((FOV * Math.PI) / 360));
    this.ink.update(dt, pxPerUnit);
    this.cinnabar.update(dt, pxPerUnit);
    this.drawDoors(s);
    this.drawPlatforms(s);

    // the camera follows the hero along x, kept inside the room
    const hero = s.entities.find((e) => e.team === 0);
    const hx = hero ? fromFp(hero.px + (hero.x - hero.px) * alpha) : roomW / 2;
    // half the width the camera sees at the bodies' depth (VIEW_W on a 16:9 screen)
    const follow = (half: number) => Math.min(Math.max(hx + VIEW_W * 0.1, half), Math.max(half, roomW - half));
    const tan = Math.tan((FOV * Math.PI) / 360);
    const beats = this.beats;
    beats.update(dt, s, this.actors, follow(tan * this.dist * camera.aspect));
    this.figures.update(s, dt, beats.seeping, this.gongbi);
    // a beat's camera: as near as it says, looking where it says, eased in from following the hero
    const look = beats.camera.look;
    const dist = this.dist * (1 + (beats.camera.close - 1) * look);
    const halfView = tan * dist * camera.aspect;
    const cx = follow(halfView) + (beats.camera.x - follow(halfView)) * look;
    this.shake = Math.max(0, this.shake - dt);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 16 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 10 : 0;
    const tz = (fromFp(WORLD.depth) * DEPTH_K) / 2;
    // `dist` ahead of the aim and as high as a 20-degree look down; a heavy blow pushes the camera
    // in a little for an instant
    const d = dist * (1 - (vfx?.punch ?? 0) * 0.035);
    const aim = AIM_Y + (beats.camera.y - AIM_Y) * look;
    camera.position.set(cx + sx, aim + Math.tan(PITCH) * d + sy, tz + d);
    level(camera, Math.tan(PITCH) * d, d);
    const feet = hero ? at.set(hx, fromFp(hero.pz + (hero.z - hero.pz) * alpha), fromFp(hero.py + (hero.y - hero.py) * alpha) * DEPTH_K) : undefined;
    if (vfx) {
      const air = this.stage.showing ?? 'road';
      const key = `${air}:${roomW}`;
      if (key !== this.airKey) {
        this.airKey = key;
        vfx.setScene(air, roomW);
        decor?.setScene(air, roomW);
      }
      vfx.update(dt, s, this.actors, pxPerUnit, cx, alpha);
      vfx.incense(this.stage.burners, dt);
      decor?.update(dt, cx, pxPerUnit);
      this.sun.target.position.set(cx, 0, tz);
      this.sun.position.copy(this.sun.target.position).add(SUN);
    }
    const t = performance.now() / 1000;
    const room = () => renderer.render(scene, camera);
    if (post && this.postOn) {
      post.paper = this.stage.paperColor;
      post.vivid = this.gongbi;
      post.drained = this.drainOn && s.room >= 0 && !s.roomCleared && s.entities.some((e) => e.team === 1 && e.hp > 0);
      if (feet) {
        const v = at.clone().setY(at.y + 120).project(camera);
        post.focus((v.x + 1) / 2, (v.y + 1) / 2);
      }
      renderer.setRenderTarget(post.target);
      this.stage.render(renderer, camera, cx - halfView, cx, room, feet);
      post.present(renderer, dt, t);
    } else {
      renderer.setRenderTarget(null);
      this.stage.render(renderer, camera, cx - halfView, cx, room, feet);
    }
    decor?.drawOverlay(renderer);
    return hero;
  }

  /** Runs `frame` on every drawn display frame with the seconds since the last; `?fps=30` draws
   * every other one (the engine ticks at 30 Hz and each frame is interpolated between ticks),
   * halving the GPU's work and the heat it makes, and a governor holds that rate (unless ?gov=0);
   * `defaultCap` is the rate without ?fps (0: every display frame). */
  loop(frame: (dt: number) => void, defaultCap = 0): void {
    const cap = Number(this.params.get('fps') ?? defaultCap);
    const dpr = this.dpr;
    this.gov =
      cap > 0 && this.params.get('gov') !== '0'
        ? new Governor(1000 / cap, LEVELS.length, (l) => {
            const q = LEVELS[l];
            this.renderer.setPixelRatio(Math.max(1, dpr * q.dpr));
            this.renderer.setSize(this.width, this.height, !this.host);
            this.post?.resize(this.renderer);
            if (this.decor) this.decor.root.visible = q.decor;
            this.postOn = this.postWanted && q.post;
          })
        : null;
    let last = performance.now();
    let frames = 0;
    let span = 0;
    let worst = 0;
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      // skip a display frame only when the next one is nearer the target: rAF times jitter by a few
      // ms, and a margin narrower than half a display frame (8 ms) skips a frame it should draw
      if (cap > 0 && now - last < 1000 / cap - 8) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      if (this.intervals.length < 4000) this.intervals.push(now - last);
      if (!this.frozen) this.gov?.frame(now - last);
      last = now;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      frame(dt);
      this.cpu += (performance.now() - now - this.cpu) * 0.05;
      frames++;
      span += dt;
      worst = Math.max(worst, dt);
      if (span < 1) return;
      const r = this.renderer.info.render;
      this.host?.onStats?.({ fps: frames / span, worstMs: worst * 1000, draws: r.calls, triangles: r.triangles });
      frames = span = worst = 0;
    });
  }

  /** Holds the view on blank paper (until `reveal`); the scene is still drawn underneath. */
  blank(): void {
    this.post?.blank();
  }

  /** Paints the scene in on the paper over `sec` seconds, outlines first and then the colour, as
   * the first strokes of a chapter; without the finishing pass (?fx=0, the governor's last level)
   * the scene just shows. */
  reveal(sec?: number): void {
    this.post?.reveal(sec);
  }

  /** The reveal is still painting (or is held on blank paper). */
  get revealing(): boolean {
    return this.post?.revealing ?? false;
  }

  /** Something is being shown that the fight waits for: the reveal, or one of 1-1's beats. */
  get cutscene(): boolean {
    return this.revealing || this.beats.holding;
  }

  /** The run's end has been shown (1-1's camera resting on the folding screen), so its result can be. */
  get outroDone(): boolean {
    return this.beats.outroDone;
  }

  /** P: the finishing pass on or off, to compare. */
  togglePost(): void {
    if (this.post) this.postOn = this.postWanted = !this.postOn;
  }

  private sync(s: SimState): void {
    const live = new Set(s.entities.map((e) => e.id));
    for (const [id, a] of this.actors) {
      if (live.has(id)) continue;
      a.dispose();
      this.actors.delete(id);
      this.bodyOf.delete(id);
    }
    for (const e of s.entities) {
      if (this.actors.has(e.id)) continue;
      const { model, tint } = this.modelFor(e.kind, e.id);
      const ink = INK_BODY[e.kind];
      const body = ink?.bodies[e.id % ink.bodies.length];
      if (body && model === this.models.ink[body]) this.bodyOf.set(e.id, body);
      const a = new Actor(e.id, e.kind, model, tint, !UNARMED.has(e.kind));
      this.actors.set(e.id, a);
      this.scene.add(a.root, a.floorShadow, a.trail.mesh);
    }
  }

  private modelFor(kind: string, id: number): { model: Model; tint: number } {
    const m = this.models;
    if (kind === 'hero') return { model: m.hero, tint: 0xffffff };
    // a bird on its own skeleton, already within budget
    if (m.birds[kind]) return { model: m.birds[kind], tint: 0xffffff };
    if (this.beast && m.birds[this.beast]) return { model: m.birds[this.beast], tint: 0xffffff };
    const ink = INK_BODY[kind];
    if (ink) {
      const model = m.ink[ink.bodies[id % ink.bodies.length]];
      if (model) return { model, tint: ink.tint };
      return { model: kind === 'woodcutter' ? m.lead : m.mob, tint: 0x606068 };
    }
    if (kind === 'elite' || kind === 'chief') return { model: m.lead, tint: kind === 'elite' ? 0xd08870 : 0xa07060 };
    return { model: m.mob, tint: 0xb8bcc8 };
  }

  /** The room's platforms, built when the room changes: each a slab with its top at the
   * platform's height, a pale top and an ink-black front stroke; in a scene with a perch
   * (PERCHES), a fainter top on the painted piece instead of the stroke. */
  private drawPlatforms(s: SimState): void {
    const key = `${s.config.dungeon}:${s.room}`;
    if (key === this.platformKey) return;
    this.platformKey = key;
    for (const c of this.platforms.children) {
      const m = c as Mesh<BufferGeometry, MeshBasicMaterial>;
      m.geometry.dispose();
      // the perches' own materials (the rest are shared)
      if (m.material.map) m.material.dispose();
    }
    this.platforms.clear();
    if (!this.platforms.parent) this.scene.add(this.platforms);
    const list = s.room >= 0 ? (DUNGEONS[s.config.dungeon].rooms[s.room].platforms ?? []) : [];
    const scene = Stage.sceneOf(s.config.dungeon, s.room);
    const perch = list.length ? this.stage.perch(scene) : null;
    const slabs = list.map((p) => {
      const [x0, x1, z0, z1, h] = [fromFp(p.x0), fromFp(p.x1), fromFp(p.y0) * DEPTH_K, fromFp(p.y1) * DEPTH_K, fromFp(p.z)];
      const top = new Mesh(new BoxGeometry(x1 - x0, 6, z1 - z0), perch ? PERCH_TOP : PLATFORM_TOP);
      top.position.set((x0 + x1) / 2, h - 3, (z0 + z1) / 2);
      this.platforms.add(top);
      if (perch) return { x0, x1, z: (z0 + z1) / 2, h };
      const edge = new Mesh(new BoxGeometry(x1 - x0 + 8, 14, 10), PLATFORM_EDGE);
      edge.position.set((x0 + x1) / 2, h - 7, z1);
      // the stroke's legs down to the floor at the front corners, thin as a screen frame
      for (const x of [x0 + 6, x1 - 6]) {
        const leg = new Mesh(new BoxGeometry(6, h, 6), PLATFORM_EDGE);
        leg.position.set(x, h / 2, z1);
        this.platforms.add(leg);
      }
      this.platforms.add(edge);
      return null;
    });
    // the painted pieces, upright across the middle of each platform's depth (the floor hides
    // what reaches below it), every other one mirrored so a row of them does not repeat
    void perch?.then((tex) => {
      if (this.platformKey !== key) return;
      const { stand, squash = 1, ground } = PERCHES[scene]!;
      const { width, height } = tex.image as { width: number; height: number };
      slabs.forEach((p, i) => {
        if (!p) return;
        const w = (p.x1 - p.x0) * PERCH_OVERHANG;
        let ph = ((w * height) / width) * squash;
        // one standing on the floor reaches down to it; one in the air (a branch) stops short of
        // it, narrower in proportion if it must, so the floor never cuts across it
        ph = ground ? Math.max(ph, p.h / (1 - stand)) : Math.min(ph, (p.h - PERCH_CLEAR) / (1 - stand));
        const m = new Mesh(new PlaneGeometry(w, ph), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
        m.position.set((p.x0 + p.x1) / 2, p.h + stand * ph - ph / 2, p.z);
        m.scale.x = i % 2 ? -1 : 1;
        this.platforms.add(m);
      });
    }).catch(() => {});
  }

  /** A cleared room's doors, washed in pulsing cinnabar on the floor where they lead out. */
  private drawDoors(s: SimState): void {
    const doors = s.roomCleared && s.outcome === 'playing' && s.room >= 0 ? DUNGEONS[s.config.dungeon].rooms[s.room].doors : [];
    while (this.doors.length < doors.length) {
      const m = new Mesh(new PlaneGeometry(1, 1), DOOR_INK);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.doors.push(m);
      this.scene.add(m);
    }
    const w = fromFp(s.roomWidth);
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    const half = fromFp(DOOR_HALF);
    DOOR_INK.opacity = 0.18 + 0.12 * Math.sin(this.time * 3.75);
    this.doors.forEach((m, i) => {
      const d = doors[i];
      m.visible = !!d;
      if (!d) return;
      const x = fromFp(d.x ?? 0);
      // [x0, x1, z0, z1] on the floor
      const box =
        d.side === 'right' ? [w - 140, w, 0, depth] : d.side === 'left' ? [0, 140, 0, depth] : d.side === 'up' ? [x - half, x + half, 0, 110] : [x - half, x + half, depth - 110, depth];
      m.position.set((box[0] + box[1]) / 2, 1.5, (box[2] + box[3]) / 2);
      m.scale.set(box[1] - box[0], box[3] - box[2], 1);
    });
  }
}

/** Where the sun is from what it lights (it follows the camera, so its shadows stay sharp). */
const SUN = new Vector3(-600, 1900, 1100);
