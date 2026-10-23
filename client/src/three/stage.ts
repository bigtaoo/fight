import { WORLD, fromFp, type DungeonId } from '@dnf/engine';
import {
  Color,
  DataTexture,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { DEPTH_K } from './actor';
import { INK } from './ink';
import { fade, flicker, prop, type PropKind } from './props';

// The painted scenery of the 2D game (client/public/art/bg). The far painting, the middle row and
// the foreground stay flat screen layers scrolled at the 2D game's shares of the camera (drawn
// before and after the 3D room by an orthographic camera); only the floor wash lies in the room,
// under the bodies. The middle row's feet sit where the 3D floor's back edge lands on screen.

export type SceneId = 'road' | 'fort' | 'hall' | 'village' | 'plank' | 'manor' | 'ferry' | 'temple' | 'tail' | 'screen'
  | 'creek' | 'shore' | 'parlor' | 'blossom' | 'lotus' | 'bamboo';
const SCENES: Record<SceneId, { paper: number; farTop: number; props?: true }> = {
  road: { paper: 0xf1ece0, farTop: -274 },
  fort: { paper: 0xe9e4d7, farTop: -17 },
  // the hall's furniture stands in the room in 3D, so its flat foreground (the same burner and jar) is left out
  hall: { paper: 0x7a7d92, farTop: -600, props: true },
  // 1-1's river village (a stopgap cut from the concept art, art/chapter1/bg); the shore sits on the floor's back edge
  village: { paper: 0xd4e0cc, farTop: -380 },
  // the other places of chapter one's painting (art/chapter1/bg, design/CHAPTER1.md)
  plank: { paper: 0xe6e8de, farTop: -380 },
  manor: { paper: 0xdfe2d6, farTop: -380 },
  ferry: { paper: 0xd8e4da, farTop: -380 },
  temple: { paper: 0xe2e4da, farTop: -380 },
  // the scroll's tail: plain mounted paper and the jiehua pattern page, no foreground
  tail: { paper: 0xe8e0cc, farTop: -380 },
  // inside the screen: a gongbi flower-and-bird painting on golden silk
  screen: { paper: 0xe6d8b4, farTop: -380 },
  // room variants: 1-2's creek bridge, shore and main hall (with the folding screen) in the river
  // village; 1-3's crabapple branch, lotus pond and bamboo with rocks inside the screen
  creek: { paper: 0xd4e0cc, farTop: -380 },
  shore: { paper: 0xd4e0cc, farTop: -380 },
  parlor: { paper: 0xd6c8ae, farTop: -380 },
  blossom: { paper: 0xe6d8b4, farTop: -380 },
  lotus: { paper: 0xe6d8b4, farTop: -380 },
  bamboo: { paper: 0xe6d8b4, farTop: -380 },
};
/** The scenes inside the screen's painting, where the hero is drawn gongbi. */
export const IN_SCREEN = new Set<SceneId>(['screen', 'blossom', 'lotus', 'bamboo']);

const ROOMS: Partial<Record<DungeonId, SceneId[]>> = {
  heifeng: ['road', 'road', 'fort', 'fort', 'fort', 'hall'],
  horde: ['road', 'road', 'fort', 'fort', 'fort', 'hall'],
  hall: ['hall'],
  luobi: ['village', 'village', 'village', 'village'],
  // road, stream bridge, river bank, threshing floor, the hall with the folding screen
  jiangcun: ['village', 'creek', 'shore', 'village', 'parlor'],
  screen: ['screen'],
  // flowering branch, lotus pond, bamboo and rock, the pheasant on the open silk
  pingfeng: ['blossom', 'lotus', 'bamboo', 'screen'],
};
/** Where a dungeon inside a painting comes back out to (View3D.leaveScreen), fetched with its own scenery. */
const LEAVES_TO: Partial<Record<DungeonId, SceneId>> = { screen: 'parlor', pingfeng: 'parlor' };
/** ?scene=<id> shows one scene in every room, to look at scenery no dungeon uses yet. */
const PICK = typeof location === 'undefined' ? null : (new URLSearchParams(location.search).get('scene') as SceneId | null);
const FAR = 0.2;
const MID = 0.5;
const FRONT = 1.25;
/** The mounting silk moves with the floor: it is the scroll itself. */
const SILK = 1;
/** The logical screen the layers were painted for. */
const VIEW_H = 1080;
/** In the 2D game the far painting's top is placed against a floor whose back edge is at 660. */
const GROUND_TOP = 660;

const loader = new TextureLoader();

type Scenery = Record<'far' | 'mid' | 'ground' | 'front', Texture>;

function load(url: string): Promise<Texture> {
  return loader.loadAsync(url).then((t) => {
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    return t;
  });
}

/** A painting not made yet: one pixel of the scene's paper, see-through where it is a layer over others. */
function blankPaper(hex: number): Texture {
  const t = new DataTexture(new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 0]), 1, 1);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function size(t: Texture): { width: number; height: number } {
  return t.image as { width: number; height: number };
}

/** A flat layer: a unit quad scaled to its size, its texture repeating across. */
function layer(tex: Texture, transparent: boolean): Mesh {
  const m = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, transparent, depthWrite: false, depthTest: false, toneMapped: false }));
  return m;
}

export class Stage {
  private readonly back = new Scene();
  private readonly fore = new Scene();
  private readonly ortho = new OrthographicCamera(0, 1, 0, -1, -10, 10);
  private far: Mesh | null = null;
  private mid: Mesh | null = null;
  private front: Mesh | null = null;
  private ground: Mesh | null = null;
  /** The mounting silk along the top and bottom of the view (the second one flipped). */
  private readonly silk: Mesh[] = [];
  private silkTex: Promise<Texture> | null = null;
  private readonly props = new Group();
  private current = '';
  /** The scene the flat layers show now. */
  private scene: SceneId | null = null;
  private readonly sets = new Map<SceneId, Promise<Scenery>>();
  private paper = 0xf1ece0;
  private farTop = 0;
  private readonly _v = new Vector3();
  private readonly _size = new Vector2();
  /** With the effects: a haze of the paper's colour over the far end of the room, and the sun's
   * real shadows caught on the floor (on top of the bodies' blobs). */
  private fog: Fog | null = null;
  private catcher: Mesh | null = null;
  /** Shown in every room in place of the dungeon's own scenery (stepping back out of a painting). */
  instead: SceneId | null = null;
  /** The feet of the burners of the room shown now, for the incense. */
  readonly burners: Vector3[] = [];

  /** `base`: where the scenery files are (the web build serves them from public/art/bg). */
  constructor(
    private readonly room: Scene,
    private readonly base = `${import.meta.env.BASE_URL}art/bg/`,
  ) {
    room.add(this.props);
  }

  /** Turns on the haze and the floor that catches shadows (once, before the shaders are built). */
  effects(): void {
    this.fog = new Fog(this.paper, 2300, 7000);
    this.room.fog = this.fog;
    this.catcher = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ color: INK, opacity: 0.3, depthWrite: false }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.receiveShadow = true;
    this.catcher.renderOrder = -0.8;
    this.room.add(this.catcher);
  }

  /** The scene shown now and its paper colour. */
  get showing(): SceneId | null {
    return this.scene;
  }

  get paperColor(): number {
    return this.paper;
  }

  /** Fetches the scenery of every room of `dungeon` and hands it to the GPU up front, so walking
   * into a room never stalls a frame on decoding and uploading a painting. */
  async preload(dungeon: DungeonId, renderer: WebGLRenderer): Promise<void> {
    const ids = PICK && SCENES[PICK] ? [PICK] : [...new Set<SceneId>([...(ROOMS[dungeon] ?? ['road']), ...(LEAVES_TO[dungeon] ? [LEAVES_TO[dungeon]] : [])])];
    const [silk, ...sets] = await Promise.all([this.mount(), ...ids.map((id) => this.scenery(id))]);
    renderer.initTexture(silk);
    for (const set of sets) for (const t of Object.values(set)) renderer.initTexture(t);
  }

  /** The mounting silk, fetched once: the same strip above the painting and, upside down, below it,
   * so the view never shows anything past the scroll's edges. */
  private mount(): Promise<Texture> {
    if (!this.silkTex) {
      this.silkTex = load(`${this.base}silk.jpg`).then((top) => {
        for (const tex of [top, top.clone()]) {
          const m = layer(tex, false);
          m.renderOrder = 10;
          this.silk.push(m);
          this.fore.add(m);
        }
        return top;
      });
    }
    return this.silkTex;
  }

  /** The four paintings of a scene, fetched once; one not painted yet is plain paper. */
  private scenery(id: SceneId): Promise<Scenery> {
    let set = this.sets.get(id);
    if (!set) {
      const base = `${this.base}${id}_`;
      set = Promise.all(['far.jpg', 'mid.png', 'ground.jpg', 'front.png'].map((f) => load(base + f).catch(() => blankPaper(SCENES[id].paper)))).then(([far, mid, ground, front]) => {
        ground.wrapT = RepeatWrapping;
        return { far, mid, ground, front };
      });
      if (id !== 'road') set = set.catch(() => this.scenery('road'));
      this.sets.set(id, set);
    }
    return set;
  }

  async show(dungeon: DungeonId, roomIndex: number, roomWidth: number): Promise<void> {
    const id = this.instead ?? (PICK && SCENES[PICK] ? PICK : (ROOMS[dungeon]?.[roomIndex] ?? 'road'));
    const key = `${id}:${roomWidth}`;
    if (key === this.current) return;
    this.current = key;
    const [{ far, mid, ground, front }] = await Promise.all([this.scenery(id), this.mount()]);
    if (this.current !== key) return;
    if (this.scene !== id) {
      this.scene = id;
      for (const m of [this.far, this.mid, this.front]) m?.removeFromParent();
      this.paper = SCENES[id].paper;
      this.farTop = SCENES[id].farTop;
      this.fog?.color.set(this.paper);
      this.far = layer(far, false);
      this.mid = layer(mid, true);
      this.front = SCENES[id].props ? null : layer(front, true);
      this.back.add(this.far, this.mid);
      if (this.front) this.fore.add(this.front);
    }

    // the floor wash, lying flat from a little behind the back edge to past the front
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    const w = roomWidth + 3000;
    const gd = depth + 900;
    const gi = size(ground);
    ground.repeat.set(w / gi.width, gd / (gi.height * 1.6));
    // one floor, refitted: a new material would drop its shader and build it again mid-fight
    if (!this.ground) {
      this.ground = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: ground, toneMapped: false }));
      this.ground.rotation.x = -Math.PI / 2;
      this.room.add(this.ground);
    }
    this.ground.geometry.dispose();
    this.ground.geometry = new PlaneGeometry(w, gd);
    (this.ground.material as MeshBasicMaterial).map = ground;
    this.ground.position.set(roomWidth / 2, 0, gd / 2 - 60);
    if (this.catcher) {
      this.catcher.scale.set(w, gd, 1);
      this.catcher.position.set(roomWidth / 2, 0.4, gd / 2 - 60);
    }
    this.furnish(SCENES[id].props ? roomWidth : 0);
  }

  /** Lays the hall's furniture along a room `roomWidth` wide (none when 0): burners, candlesticks
   * and jars along the back edge, behind the bodies, and a row of pillars past the front of the
   * floor that the bodies pass behind. The same room always gets the same layout. */
  private furnish(roomWidth: number): void {
    this.props.clear();
    this.burners.length = 0;
    if (!roomWidth) return;
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    let pillars = 0;
    const put = (kind: PropKind, x: number, z: number, turn = 0) => {
      const p = prop(kind, kind === 'pillar' ? pillars++ : 0);
      p.position.set(x, 0, z);
      p.rotation.y = turn;
      this.props.add(p);
      if (kind === 'burner') this.burners.push(p.position);
      return p;
    };
    const back: PropKind[] = ['candle', 'burner', 'candle', 'jar'];
    for (let i = 0, x = 260; x < roomWidth - 120; i++, x += 520) {
      const kind = back[i % back.length];
      put(kind, x, -26, i * 0.7);
      if (kind === 'jar') put('jar', x + 74, -6, i * 1.3 + 2);
    }
    for (let x = 640; x < roomWidth + 400; x += 1280) put('pillar', x, depth + 150);
    put('jar', 420, depth + 60, 1.1);
    // paper lanterns hung from the beams above the back row, between the furniture
    for (let x = 520; x < roomWidth - 200; x += 1040) put('lantern', x, 90).position.y = 1330;
  }

  /** Fades the pillars that stand between the camera and `focus`, a body about 220 tall and 70
   * wide: on screen, the pillar's strip and the body's box overlap. */
  private clearView(camera: Camera, focus: Vector3): void {
    const v = this._v;
    const ndc = (x: number, y: number, z: number) => v.set(x, y, z).project(camera).x;
    const bx0 = ndc(focus.x - 45, focus.y + 110, focus.z);
    const bx1 = ndc(focus.x + 45, focus.y + 110, focus.z);
    for (const p of this.props.children) {
      if (p.userData.kind !== 'pillar') continue;
      const { x, z } = p.position;
      const over = z > focus.z && ndc(x + 40, 200, z) > bx0 && ndc(x - 40, 200, z) < bx1;
      fade(p, over ? 0.28 : 1, 0.18);
    }
  }

  /** Lays the flat layers out for a `w` x `h` view scrolled to camera x `camX` (left edge, world
   * units), the middle row's feet on the 3D floor's back edge as `camera` sees it. */
  private place(w: number, h: number, camX: number, camera: Camera, backEdge: Vector3): void {
    this.ortho.left = 0;
    this.ortho.right = w;
    this.ortho.top = 0;
    this.ortho.bottom = -h;
    this.ortho.updateProjectionMatrix();
    const k = h / VIEW_H;
    // where the floor's back edge lands on screen, in logical units from the top
    const p = this._v.copy(backEdge).project(camera);
    const edge = ((1 - p.y) / 2) * VIEW_H;
    const put = (m: Mesh | null, top: number, share: number) => {
      if (!m) return;
      const tex = (m.material as MeshBasicMaterial).map!;
      const s = size(tex);
      const lw = w / k;
      m.scale.set(w, s.height * k, 1);
      m.position.set(w / 2, -(top * k + (s.height * k) / 2), 0);
      tex.repeat.set(lw / s.width, 1);
      tex.offset.x = (camX * share) / s.width;
    };
    if (this.far) put(this.far, this.farTop + (edge - GROUND_TOP), FAR);
    if (this.mid) put(this.mid, edge - 10 - size((this.mid.material as MeshBasicMaterial).map!).height, MID);
    if (this.front) put(this.front, VIEW_H + 10 - size((this.front.material as MeshBasicMaterial).map!).height, FRONT);
    this.silk.forEach((m, i) => {
      const tex = (m.material as MeshBasicMaterial).map!;
      const s = size(tex);
      const sh = s.height * k;
      m.scale.set(w, sh, 1);
      m.position.set(w / 2, i ? -(h - sh / 2) : -sh / 2, 0);
      tex.repeat.set(w / k / s.width, i ? -1 : 1);
      tex.offset.set((camX * SILK) / s.width, i ? 1 : 0);
    });
  }

  /** Draws the back layers, the room through `camera`, then the foreground. */
  /** `focus`: where the hero stands (feet), so a pillar in front of them can fade. */
  render(renderer: WebGLRenderer, camera: Camera, camX: number, roomCenterX: number, draw: () => void, focus?: Vector3): void {
    if (this.props.children.length) {
      flicker(this.props, performance.now() / 1000);
      if (focus) this.clearView(camera, focus);
    }
    const size = renderer.getSize(this._size);
    this.place(size.x, size.y, camX, camera, new Vector3(roomCenterX, 0, -30));
    renderer.autoClear = false;
    renderer.setClearColor(new Color(this.paper), 1);
    renderer.clear();
    renderer.render(this.back, this.ortho);
    renderer.clearDepth();
    draw();
    renderer.render(this.fore, this.ortho);
  }
}
