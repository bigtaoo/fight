import { Assets, Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import type { DungeonId } from '@dnf/engine';
import { GROUND_TOP, VIEW_H, VIEW_W } from './layout';

// The painted scenery behind and in front of the fight: per scene a far painting, a middle row
// of trees, palisades or pillars, the floor wash under the bodies and a few things in the
// foreground, each scrolling at its own share of the camera (art/bg_m2/layers.json packs them
// at their screen size). Purely cosmetic: the engine knows nothing of scenes.

type SceneId = 'road' | 'fort' | 'hall';

interface Scene {
  /** Paper behind everything, where the far painting does not reach. */
  paper: number;
  /** Screen y of the far painting's top edge, so its horizon sits on the floor's back edge. */
  farTop: number;
}

const SCENES: Record<SceneId, Scene> = {
  road: { paper: 0xf1ece0, farTop: -274 },
  fort: { paper: 0xe9e4d7, farTop: -17 },
  hall: { paper: 0x7a7d92, farTop: -600 },
};

/** Each room's scene by dungeon; rooms past the list, and other dungeons, are the mountain road. */
const ROOMS: Partial<Record<DungeonId, SceneId[]>> = {
  heifeng: ['road', 'road', 'fort', 'fort', 'fort', 'hall'],
  hall: ['hall'],
};

/** How far each layer moves for a unit of camera movement. */
const FAR = 0.2;
const MID = 0.5;
const FRONT = 1.25;
/** Screen y of the middle row's feet, just under the floor's back edge, and of the foreground's. */
const MID_FEET = GROUND_TOP - 10;
const FRONT_FEET = VIEW_H + 10;
/** The floor wash starts a little behind depth 0, where the floor's back edge is drawn. */
const FLOOR_TOP = GROUND_TOP - 30;

type Layers = { far: Texture; mid: Texture; ground: Texture; front: Texture };

export class Scenery {
  /** Behind the world: paper, far painting, middle row. */
  readonly back = new Container();
  /** Inside the world, under the bodies: the floor wash, as wide as the room. */
  readonly floor: TilingSprite;
  /** Over the world: the foreground pieces. */
  readonly front: TilingSprite;
  private readonly paper = new Graphics();
  private readonly far: TilingSprite;
  private readonly mid: TilingSprite;
  private readonly scenes: Partial<Record<SceneId, Layers>> = {};
  private current: SceneId | null = null;

  constructor() {
    this.far = new TilingSprite({ width: VIEW_W, height: 1 });
    this.mid = new TilingSprite({ width: VIEW_W, height: 1 });
    this.floor = new TilingSprite({ width: 1, height: VIEW_H - FLOOR_TOP });
    this.floor.y = FLOOR_TOP;
    this.front = new TilingSprite({ width: VIEW_W, height: 1 });
    this.back.addChild(this.paper, this.far, this.mid);
    for (const s of [this.far, this.mid, this.floor, this.front]) s.visible = false;
  }

  /** Loads every scene's layers; a scene whose files fail stays plain paper. */
  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SCENES) as SceneId[]).map(async (id) => {
        try {
          const [far, mid, ground, front] = await Promise.all(
            ['far.jpg', 'mid.png', 'ground.jpg', 'front.png'].map((f) => Assets.load<Texture>(`art/bg/${id}_${f}`)),
          );
          this.scenes[id] = { far, mid, ground, front };
        } catch {
          // plain paper for this scene
        }
      }),
    );
  }

  /** Shows the scene of `room` in `dungeon`, `roomWidth` world units wide, scrolled to camera x `camX`. */
  update(dungeon: DungeonId, room: number, roomWidth: number, camX: number): void {
    const id = ROOMS[dungeon]?.[room] ?? 'road';
    if (id !== this.current) this.show(id);
    this.floor.width = roomWidth;
    this.far.tilePosition.x = -camX * FAR;
    this.mid.tilePosition.x = -camX * MID;
    this.front.tilePosition.x = -camX * FRONT;
  }

  private show(id: SceneId): void {
    this.current = id;
    const scene = SCENES[id];
    this.paper.clear().rect(0, 0, VIEW_W, VIEW_H).fill(scene.paper);
    const l = this.scenes[id];
    for (const s of [this.far, this.mid, this.floor, this.front]) s.visible = !!l;
    if (!l) return;
    this.far.texture = l.far;
    this.far.height = l.far.height;
    this.far.y = scene.farTop;
    this.mid.texture = l.mid;
    this.mid.height = l.mid.height;
    this.mid.y = MID_FEET - l.mid.height;
    this.floor.texture = l.ground;
    this.front.texture = l.front;
    this.front.height = l.front.height;
    this.front.y = FRONT_FEET - l.front.height;
  }
}
