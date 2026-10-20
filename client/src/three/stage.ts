import { WORLD, fromFp, type DungeonId } from '@dnf/engine';
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  TextureLoader,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { DEPTH_K } from './actor';

// The painted scenery of the 2D game (client/public/art/bg). The far painting, the middle row and
// the foreground stay flat screen layers scrolled at the 2D game's shares of the camera (drawn
// before and after the 3D room by an orthographic camera); only the floor wash lies in the room,
// under the bodies. The middle row's feet sit where the 3D floor's back edge lands on screen.

type SceneId = 'road' | 'fort' | 'hall';
const SCENES: Record<SceneId, { paper: number; farTop: number }> = {
  road: { paper: 0xf1ece0, farTop: -274 },
  fort: { paper: 0xe9e4d7, farTop: -17 },
  hall: { paper: 0x7a7d92, farTop: -600 },
};
const ROOMS: Partial<Record<DungeonId, SceneId[]>> = {
  heifeng: ['road', 'road', 'fort', 'fort', 'fort', 'hall'],
  hall: ['hall'],
};
const FAR = 0.2;
const MID = 0.5;
const FRONT = 1.25;
/** The logical screen the layers were painted for. */
const VIEW_H = 1080;
/** In the 2D game the far painting's top is placed against a floor whose back edge is at 660. */
const GROUND_TOP = 660;

const loader = new TextureLoader();

function load(url: string): Promise<Texture> {
  return loader.loadAsync(url).then((t) => {
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    return t;
  });
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
  private current = '';
  private paper = 0xf1ece0;
  private farTop = 0;
  private readonly _v = new Vector3();
  private readonly _size = new Vector2();

  /** `base`: where the scenery files are (the web build serves them from public/art/bg). */
  constructor(
    private readonly room: Scene,
    private readonly base = `${import.meta.env.BASE_URL}art/bg/`,
  ) {}

  async show(dungeon: DungeonId, roomIndex: number, roomWidth: number): Promise<void> {
    const id = ROOMS[dungeon]?.[roomIndex] ?? 'road';
    const key = `${id}:${roomWidth}`;
    if (key === this.current) return;
    this.current = key;
    const base = `${this.base}${id}_`;
    const [far, mid, ground, front] = await Promise.all(['far.jpg', 'mid.png', 'ground.jpg', 'front.png'].map((f) => load(base + f)));
    for (const m of [this.far, this.mid, this.front, this.ground]) m?.removeFromParent();
    this.paper = SCENES[id].paper;
    this.farTop = SCENES[id].farTop;
    this.far = layer(far, false);
    this.mid = layer(mid, true);
    this.front = layer(front, true);
    this.back.add(this.far, this.mid);
    this.fore.add(this.front);

    // the floor wash, lying flat from a little behind the back edge to past the front
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    const w = roomWidth + 3000;
    const gd = depth + 900;
    const gi = size(ground);
    const gt = ground.clone();
    gt.wrapT = RepeatWrapping;
    gt.repeat.set(w / gi.width, gd / (gi.height * 1.6));
    gt.needsUpdate = true;
    this.ground = new Mesh(new PlaneGeometry(w, gd), new MeshBasicMaterial({ map: gt, toneMapped: false }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(roomWidth / 2, 0, gd / 2 - 60);
    this.room.add(this.ground);
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
  }

  /** Draws the back layers, the room through `camera`, then the foreground. */
  render(renderer: WebGLRenderer, camera: Camera, camX: number, roomCenterX: number, draw: () => void): void {
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
