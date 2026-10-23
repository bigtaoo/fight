import { BODIES, fromFp, type Entity } from '@dnf/engine';
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Color,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshToonMaterial,
  MeshBasicMaterial,
  CircleGeometry,
  Quaternion,
  Vector3,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
  Sphere,
  type AnimationAction,
  type Bone,
  type Skeleton,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { INK, bakeTone, bodyMaterial, inkMesh, outlineMaterial, ownOutline } from './ink';
import { cutPose, cutting, moveClip } from './pose';
import { Trail } from './trail';

// A body of the engine drawn as a skinned 3D model. The model and its clips come from Tripo
// (art/hero3d, art/archer3d): every Tripo humanoid shares one 41-bone skeleton, so the archer's
// idle, walk, hit and fall clips play on any model. Only their rotations carry over (their bone
// offsets would give every model the archer's proportions), plus the hips' height, scaled.
// Attacks are posed in code from the engine's own move timing, so a cut lands on its active ticks;
// a body with clips of its own (art/model3d/moves.py) plays those instead, scrubbed to the same ticks.

/** The world's depth (y) is drawn this much deeper than it is wide, so the floor band reads from a
 * camera above it. */
export const DEPTH_K = 2;

export type ClipId = 'idle' | 'walk' | 'hit' | 'fall';

export interface Model {
  scene: Object3D;
  /** Height of the model at rest in its own units. */
  height: number;
  map: Texture | null;
  clips: Record<ClipId, AnimationClip>;
  /** The body's own clips by name (moves.py): its moves, and an idle or walk that replace the archer's. */
  moves?: Record<string, AnimationClip>;
}

const loader = new GLTFLoader();

/** Where the models are: the hero's, and the clips (the first, idle, also gives the archer's own
 * model); `read`, when given, fetches a file's bytes instead of the loader (a mini-game has no fetch). */
export interface ModelFiles {
  hero: string;
  clips: Record<ClipId, string>;
  /** Further bodies by name (chapter one's ink villagers), rigged on the same skeleton. */
  bodies?: Record<string, string>;
  /** Clips of a body's own (a file of several), by the body's name in `bodies`. */
  moves?: Record<string, string>;
  read?: (url: string) => Promise<ArrayBuffer>;
}

/** Hip height at rest in the clips' source (the archer) model. */
const CLIP_HIP = 0.5;

/** The clips with only their rotations, and the hips' offset scaled from the source's `from` to `hip`. */
function retarget(clip: AnimationClip, hip: number, from = CLIP_HIP): AnimationClip {
  const tracks = clip.tracks.flatMap((t) => {
    if (t instanceof QuaternionKeyframeTrack) return [t];
    if (t instanceof VectorKeyframeTrack && t.name === 'Hip.position') {
      const v = t.values.slice();
      for (let i = 0; i < v.length; i++) v[i] *= hip / from;
      return [new VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(v))];
    }
    return [];
  });
  return new AnimationClip(clip.name, clip.duration, tracks);
}

export async function loadModels(files: ModelFiles): Promise<{ hero: Model; archer: Model; bodies: Record<string, Model> }> {
  // the archer's own model comes with its clips (its rig_v1.glb has another skeleton)
  const load = (u: string) => (files.read ? files.read(u).then((b) => loader.parseAsync(b, u.slice(0, u.lastIndexOf('/') + 1))) : loader.loadAsync(u));
  const names = Object.keys(files.bodies ?? {});
  const own = Object.keys(files.moves ?? {}).filter((n) => names.includes(n));
  const [[hero, ...clips], bodies, moves] = await Promise.all([
    Promise.all([files.hero, ...Object.values(files.clips)].map(load)),
    Promise.all(names.map((n) => load(files.bodies![n]))),
    Promise.all(own.map((n) => load(files.moves![n]))),
  ]);
  const ids = Object.keys(files.clips) as ClipId[];
  const model = (gltf: typeof hero, name = ''): Model => {
    const scene = gltf.scene;
    const hipBone = scene.getObjectByName('Hip');
    const hip = hipBone ? hipBone.position.length() : CLIP_HIP;
    let map: Texture | null = null;
    scene.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) map = (m.material as MeshToonMaterial).map ?? null;
    });
    const box = new Box3().setFromObject(scene);
    const c = {} as Record<ClipId, AnimationClip>;
    ids.forEach((id, i) => (c[id] = retarget(clips[i].animations[0], hip)));
    const m: Model = { scene, height: box.max.y - box.min.y, map, clips: c };
    const mine = moves[own.indexOf(name)];
    if (mine) {
      // keyed on a body of their own: its hips' height is theirs
      const from = mine.scene.getObjectByName('Hip')?.position.length() ?? CLIP_HIP;
      m.moves = Object.fromEntries(mine.animations.map((a) => [a.name, retarget(a, hip, from)]));
    }
    return m;
  };
  return { hero: model(hero), archer: model(clips[0]), bodies: Object.fromEntries(names.map((n, i) => [n, model(bodies[i], n)])) };
}

/** The colour pictures of bodies by name (their glb's first skinned mesh's map), loaded on the
 * side for a body to be drawn turning from one into another (Actor.inkFrom). */
export async function loadMaps(urls: Record<string, string>): Promise<Record<string, Texture>> {
  const out: Record<string, Texture> = {};
  await Promise.all(
    Object.entries(urls).map(async ([name, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        const m = o as SkinnedMesh;
        const map = m.isSkinnedMesh ? (m.material as MeshToonMaterial).map : null;
        if (map && !out[name]) out[name] = map;
      });
    }),
  );
  return out;
}

/** Model units: the bodies stand about one tall with their feet at the origin. */
const BODY_SPHERE = new Sphere(new Vector3(0, 0.5, 0), 1.5);

const _q = new Quaternion();
const _p = new Quaternion();
const _axis = new Vector3();

/** The body's own axes while a clip plays (the clips turn the hips a quarter, so the model faces
 * +x in its own space): up, and the side axis a positive turn raises an arm forward on. */
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(0, 0, 1);
const _side = new Vector3();
const _base = new Vector3();
const _tip = new Vector3();

/** A plain dao: grip, guard and a slightly curved blade, along +y from the hand. Its parts are
 * shared by every sword, so a body coming and going leaves nothing behind on the GPU. */
const SWORD = (() => {
  const ink = new MeshBasicMaterial({ color: INK });
  const steel = new MeshToonMaterial({ color: 0xd8dade, gradientMap: null });
  steel.onBeforeCompile = bakeTone;
  return {
    blade: [new BoxGeometry(0.01, 0.46, 0.04), steel, [0, 0.3, 0]],
    edge: [new BoxGeometry(0.014, 0.47, 0.012), ink, [0, 0.3, -0.024]],
    guard: [new BoxGeometry(0.03, 0.016, 0.07), ink, [0, 0.065, 0]],
    grip: [new BoxGeometry(0.02, 0.12, 0.024), ink, [0, 0, 0]],
  } as const;
})();

function sword(): Group {
  const g = new Group();
  for (const [geo, mat, [x, y, z]] of Object.values(SWORD)) {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
  }
  return g;
}

/** The blob of shadow under every body, and the ink line round every body (one width for all). */
const SHADOW_GEO = new CircleGeometry(1, 24);
const SHADOW_MAT = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.28, depthWrite: false });
const OUTLINE = outlineMaterial(0.006);
/** Gongbi's line: finer and even, in a dark brown ink rather than black. */
const GONGBI_WIDTH = 0.0032;
const LINE_INK = new Color(INK);
const LINE_GONGBI = new Color(0x3a2218);

export class Actor {
  readonly root = new Group();
  private readonly body: Group;
  private readonly mixer: AnimationMixer;
  private readonly actions: Record<string, AnimationAction> = {};
  private current: string | null = null;
  private readonly mat: MeshToonMaterial;
  private readonly line: MeshBasicMaterial;
  private readonly shadow: Mesh;
  private readonly bones: Record<string, Bone> = {};
  /** The clone's own skeletons: each keeps its bones in a texture of its own. */
  private readonly skeletons: Skeleton[] = [];
  private readonly scale: number;
  private yaw = 0;
  private blade: Group | null = null;
  /** The swish behind the blade, kept in the room like the shadow. */
  readonly trail = new Trail();
  /** Seconds of white flash left after a hit. */
  flash = 0;
  /** How far the body has broken up into ink (0 whole, 1 gone); set from outside, the effects. */
  dissolve = 0;
  /** How far the ink has run down over the body from the colour villager it was (`inkFrom`):
   * 0 not yet, 1 all ink; set from outside, the story's beats. */
  inked = 1;
  /** How far the body is drawn as gongbi (0 the ink look, 1 fine lines and full colour); set from outside. */
  gongbi = 0;

  constructor(
    private readonly id: number,
    readonly kind: Entity['kind'],
    model: Model,
    tint = 0xffffff,
    armed = false,
  ) {
    this.body = SkeletonUtils.clone(model.scene) as Group;
    this.mat = bodyMaterial(model.map, tint);
    this.line = ownOutline(OUTLINE);
    this.body.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) {
        inkMesh(m, this.mat, this.line);
        // the sun's shadow only for the hero and the boss: the shadow pass skins every caster again,
        // and a room of bandits doing so held an A16 under 40 fps (the rest keep their blob)
        m.castShadow = kind === 'hero' || kind === 'chief' || kind === 'woodcutter';
        m.frustumCulled = false;
        // a fixed sphere round the body: left unset, three works one out on the first frame by
        // skinning every vertex on the CPU (it is only used to sort, so it need not be tight)
        m.boundingSphere = BODY_SPHERE;
        this.skeletons.push(m.skeleton);
      }
      if ((o as Bone).isBone) this.bones[o.name] = o as Bone;
    });
    if (armed) this.arm();
    this.scale = fromFp(BODIES[kind].height) / model.height;
    this.body.scale.setScalar(this.scale);
    this.root.add(this.body);
    this.shadow = new Mesh(SHADOW_GEO, SHADOW_MAT);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;
    this.mixer = new AnimationMixer(this.body);
    // the body's own clips: an idle or walk of its own loops in place of the archer's; its moves
    // hold still and are scrubbed to the engine's ticks
    const clips: Record<string, AnimationClip> = { ...model.clips, ...model.moves };
    for (const [id, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      if (id === 'idle' || id === 'walk') a.setLoop(LoopRepeat, Infinity);
      else {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[id] = a;
    }
  }

  /** Puts a sword in the right hand, pointing forward out of the fist at rest (worked out from the
   * rest pose, where the model faces -z and the arms are out to the sides). */
  private arm(): void {
    const hand = this.bones['R_Hand'];
    const fore = this.bones['R_Forearm'];
    if (!hand || !fore) return;
    this.body.updateMatrixWorld(true);
    const hq = hand.getWorldQuaternion(new Quaternion()).invert();
    const along = hand.getWorldPosition(new Vector3()).sub(fore.getWorldPosition(new Vector3())).normalize().applyQuaternion(hq);
    const s = sword();
    // mostly forward, a little down the arm's line: a cut ends with the blade at the enemy, and a
    // hanging arm (the swordsman's reaches low) keeps the tip above the floor
    const dir = along
      .clone()
      .multiplyScalar(0.4)
      .add(new Vector3(0, 0, -1).applyQuaternion(hq))
      .normalize();
    s.quaternion.setFromUnitVectors(UP, dir);
    // the grip sits in the fist, a little past the wrist (the bones carry the model's own scale)
    s.position.copy(along).multiplyScalar(0.05 / hand.getWorldScale(new Vector3()).x);
    s.scale.setScalar(1 / hand.getWorldScale(new Vector3()).x);
    hand.add(s);
    this.blade = s;
  }

  /** The blob of shadow on the floor, kept apart so it never tilts with the body. */
  get floorShadow(): Mesh {
    return this.shadow;
  }

  private play(id: string, fade = 0.12): AnimationAction {
    const a = this.actions[id];
    if (this.current !== id) {
      const prev = this.current ? this.actions[this.current] : null;
      a.reset().play();
      if (prev) a.crossFadeFrom(prev, fade, false);
      this.current = id;
    }
    return a;
  }

  /** `ground`: the height of the floor (or platform) under it, where its shadow lies. */
  update(e: Entity, alpha: number, dt: number, ground = 0): void {
    const x = fromFp(e.px + (e.x - e.px) * alpha);
    const y = fromFp(e.py + (e.y - e.py) * alpha);
    const z = fromFp(e.pz + (e.z - e.pz) * alpha);
    this.root.position.set(x, z, y * DEPTH_K);
    const r = fromFp(BODIES[e.kind].halfWidth) * 1.4 * Math.max(0.4, 1 - (z - ground) / 400);
    this.shadow.position.set(x, ground + 0.5, y * DEPTH_K);
    this.shadow.scale.set(r, r * 0.45, 1);

    // turn to face the way the engine faces (the clips themselves turn the hips a quarter, so the
    // model already faces +x on screen and -x is a half turn)
    const want = e.facing > 0 ? 0 : Math.PI;
    this.yaw += (want - this.yaw) * Math.min(1, dt * 18);
    this.body.rotation.y = this.yaw;

    const held = e.held;
    let speed = held ? 0 : 1;
    const own = e.state === 'act' ? moveClip(e.move, e.st + (held ? 0 : alpha)) : null;
    if (own && this.actions[own.clip]) {
      const a = this.play(own.clip, 0.08);
      a.timeScale = 0;
      a.time = Math.min(own.tick / 30, a.getClip().duration);
    } else switch (e.state) {
      case 'walk':
        this.play('walk').timeScale = speed;
        break;
      case 'run':
        this.play('walk').timeScale = speed * 1.7;
        break;
      case 'hurt':
        this.play('hit', 0.05).timeScale = speed;
        break;
      case 'air':
      case 'down':
      case 'dead':
        this.play('fall', 0.08).timeScale = speed * 1.6;
        break;
      case 'getup': {
        const a = this.play('fall', 0.1);
        a.timeScale = -speed * 2;
        break;
      }
      default:
        this.play('idle').timeScale = speed;
    }
    this.mixer.update(dt);
    this.body.updateMatrixWorld(true);
    if (e.state === 'act' && !own) this.pose(e, alpha);
    if (this.blade) {
      this.blade.localToWorld(_base.set(0, 0.14, 0));
      this.blade.localToWorld(_tip.set(0, 0.53, 0));
      this.trail.update(dt, e.state === 'act' && cutting(e.move, e.st + alpha), _base, _tip);
    }
    this.flash = Math.max(0, this.flash - dt);
    this.mat.emissive.setRGB(this.flash > 0 ? 0.9 : 0, this.flash > 0 ? 0.9 : 0, this.flash > 0 ? 0.85 : 0);
    this.mat.userData.dissolve.value = this.line.userData.dissolve.value = this.dissolve;
    this.mat.userData.turn.value = this.inked;
    this.mat.userData.gongbi.value = this.gongbi;
    this.line.userData.width.value = OUTLINE.userData.width.value + (GONGBI_WIDTH - OUTLINE.userData.width.value) * this.gongbi;
    this.line.color.lerpColors(LINE_INK, LINE_GONGBI, this.gongbi);
    if (this.blade) this.blade.visible = this.dissolve < 0.5;
    const dead = e.state === 'dead';
    // a lurker is not there to see until it springs
    this.root.visible = this.shadow.visible = e.lurk <= 0 && (!dead || e.st < 40);
  }

  /** Rotates `bone` by `deg` about `axis` given in the body's own space (x: side to side). */
  private turn(bone: string, axis: Vector3, deg: number): void {
    const b = this.bones[bone];
    if (!b || !b.parent) return;
    b.parent.getWorldQuaternion(_p);
    this.body.getWorldQuaternion(_q);
    // parent's rotation within the body
    _p.premultiply(_q.invert());
    _axis.copy(axis).applyQuaternion(_p.clone().invert());
    _q.setFromAxisAngle(_axis, (deg * Math.PI) / 180);
    b.quaternion.premultiply(_q);
    b.updateMatrixWorld(true);
  }

  private pose(e: Entity, alpha: number): void {
    const p = cutPose(e.move, e.st + (e.held ? 0 : alpha));
    if (!p) return;
    this.turn('Spine01', SIDE, p.lean * 0.5);
    this.turn('Spine02', SIDE, p.lean * 0.5);
    this.turn('Spine02', UP, p.twist);
    _side.copy(SIDE).applyAxisAngle(UP, (p.twist * Math.PI) / 180);
    this.turn('R_Upperarm', _side, p.arm);
    this.turn('R_Forearm', _side, p.elbow);
    this.turn('L_Upperarm', _side, p.off);
    this.turn('L_Forearm', _side, p.off * 0.8);
  }

  /** Starts the body as the colour villager `was` (a texture laid out on the same mesh), for the
   * ink to run down over it as `inked` goes to 1. */
  inkFrom(was: Texture): void {
    this.mat.userData.before.value = was;
    this.inked = this.mat.userData.turn.value = 0;
  }

  /** The blade's base and tip in the world, if the body holds one (as of the last update). */
  bladeEnds(base: Vector3, tip: Vector3): boolean {
    if (!this.blade) return false;
    this.blade.localToWorld(base.set(0, 0.14, 0));
    this.blade.localToWorld(tip.set(0, 0.53, 0));
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.shadow.removeFromParent();
    this.trail.mesh.removeFromParent();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
    this.trail.dispose();
    for (const k of this.skeletons) k.dispose();
    // the materials are left alone: dropping the last user of a shader frees it, and the next
    // body would build it again in the middle of a frame
  }

  /** The posed body, for effects that copy it (afterimages). */
  get pose3d(): Group {
    return this.body;
  }

  get entityId(): number {
    return this.id;
  }
}
