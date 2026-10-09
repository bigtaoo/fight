import { Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import { aimChain, chainOf, computeWorld, restPoses, type Affine, type Chain } from './pose';
import { blendPoses, clipTime, copyPoses, ease, samplePose } from './sample';
import type { BonePose, TaoSkeleton } from './types';

// Plays a .tao skeleton (ported from standing). The view's origin is the skeleton origin
// (between the feet). update() plays a clip in real time; seek() sets the clip time directly,
// which is how the game drives it: attacks from the sim tick so the cut lands on the active
// frames, walking from the distance covered so the feet do not slide.
// A clip change cross-fades from the pose last shown, frozen, not from the old clip running on:
// that pose is what is on screen, also when the change cuts into an unfinished fade, so
// nothing jumps however fast the clips change (a combo cancelled early, a hit landing mid-move).
// Sprites sit flat in one container in slot order, because draw order does not follow the
// bone hierarchy (a hand is drawn behind its own forearm).

const FADE = 0.12; // seconds of cross-fade when switching clips

export interface TaoAsset {
  skeleton: TaoSkeleton;
  textures: Map<string, Texture>;
}

/** Cuts the atlas into one texture per image. */
export function sliceAtlas(skeleton: TaoSkeleton, atlas: Texture): TaoAsset {
  const textures = new Map<string, Texture>();
  for (const [name, f] of Object.entries(skeleton.images)) {
    textures.set(name, new Texture({ source: atlas.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
  }
  return { skeleton, textures };
}

export class TaoActor {
  readonly view = new Container();
  private readonly sk: TaoSkeleton;
  private readonly textures: Map<string, Texture>;
  private readonly sprites: { sprite: Sprite; bone: string; x: number; y: number }[] = [];
  private readonly bySlot = new Map<string, Sprite>();
  private readonly poses: Map<string, BonePose>;
  private readonly fromPoses: Map<string, BonePose>;
  private readonly world = new Map<string, Affine>();
  private readonly m = new Matrix();
  private clip = '';
  private time = 0;
  private fade = 0;
  private fadeLen = FADE;
  private aimed: { chain: Chain; angle: number; weight: number } | null = null;

  constructor(asset: TaoAsset) {
    this.sk = asset.skeleton;
    this.textures = asset.textures;
    this.poses = restPoses(this.sk);
    this.fromPoses = restPoses(this.sk);
    for (const slot of this.sk.slots) {
      const sprite = new Sprite(this.texture(slot.image));
      this.view.addChild(sprite);
      this.sprites.push({ sprite, bone: slot.bone, x: slot.x, y: slot.y });
      this.bySlot.set(slot.id, sprite);
    }
    this.update(0);
  }

  get height(): number {
    return this.sk.height;
  }

  get current(): string {
    return this.clip;
  }

  /** Seconds since the current clip started. */
  get elapsed(): number {
    return this.time;
  }

  /** True once a one-shot clip has reached its end; loops never finish. */
  get finished(): boolean {
    const anim = this.sk.animations[this.clip];
    return !!anim && !anim.loop && this.time >= anim.duration;
  }

  /** Switches clip (cross-fading from the current one); a no-op if it is already playing. */
  play(name: string, restart = false): void {
    if (!this.sk.animations[name]) throw new Error(`${this.sk.name} has no animation ${name}`);
    if (name === this.clip && !restart) return;
    if (this.clip) this.startFade(FADE);
    this.clip = name;
    this.time = 0;
  }

  /** Swaps a slot's image, e.g. the face to "face_hurt"; null restores the default. */
  setImage(slot: string, image: string | null): void {
    const sprite = this.bySlot.get(slot);
    const def = this.sk.slots.find((s) => s.id === slot);
    if (!sprite || !def) throw new Error(`${this.sk.name} has no slot ${slot}`);
    sprite.texture = this.texture(image ?? def.image);
  }

  /**
   * Holds the limb from `bone` to `tip` pointed along `angle` (radians, skeleton space) over
   * whatever the clip does, e.g. an arm swinging a staff; a `weight` under 1 mixes toward the
   * clip's pose, and null hands the limb back to the clip.
   */
  aim(bone: string, tip: string, angle: number | null, weight = 1): void {
    if (angle === null || weight <= 0) {
      this.aimed = null;
      return;
    }
    const chain = this.aimed?.chain.bone === bone ? this.aimed.chain : chainOf(this.sk, bone, tip);
    this.aimed = { chain, angle, weight: Math.min(1, weight) };
  }

  /** A bone's pivot in the view's space, as of the last update. */
  point(bone: string): { x: number; y: number } {
    return this.pointIn(bone, 0, 0);
  }

  /** A point given in a bone's own space (skeleton units from its pivot, as at rest), in the
   * view's space as of the last update: e.g. the tips of a bow held by that bone. */
  pointIn(bone: string, x: number, y: number): { x: number; y: number } {
    const w = this.world.get(bone);
    if (!w) throw new Error(`${this.sk.name} has no bone ${bone}`);
    return { x: w.a * x + w.c * y + w.tx, y: w.b * x + w.d * y + w.ty };
  }

  /** Fades one slot, e.g. a shield that is not guarding; 1 restores it. */
  setAlpha(slot: string, alpha: number): void {
    const sprite = this.bySlot.get(slot);
    if (!sprite) throw new Error(`${this.sk.name} has no slot ${slot}`);
    sprite.alpha = alpha;
  }

  update(dt: number): void {
    this.time += dt;
    this.apply(dt);
  }

  /**
   * Shows `name` at clip time `time` (seconds), cross-fading over `fade` seconds of real time
   * when the clip changes or a one-shot clip starts over; dt is the real time since the last call.
   */
  seek(name: string, time: number, dt: number, fade = FADE): void {
    const anim = this.sk.animations[name];
    if (!anim) throw new Error(`${this.sk.name} has no animation ${name}`);
    const restart = name === this.clip && !anim.loop && time < this.time - 0.05;
    if (name !== this.clip || restart) {
      if (this.clip && fade > 0) this.startFade(fade);
      else this.fade = 0;
      this.clip = name;
    }
    this.time = time;
    this.apply(dt);
  }

  /** Freezes the pose on screen as the start of a cross-fade `len` seconds long. */
  private startFade(len: number): void {
    copyPoses(this.poses, this.fromPoses);
    this.fade = this.fadeLen = len;
  }

  private apply(dt: number): void {
    const anim = this.sk.animations[this.clip];
    if (anim) {
      samplePose(anim, clipTime(anim, this.time), this.poses);
      if (this.fade > 0) {
        this.fade = Math.max(0, this.fade - dt);
        // eased out: most of the way at once, so a move still answers the button straight away
        blendPoses(this.fromPoses, this.poses, ease('ease-out', 1 - this.fade / this.fadeLen));
      }
    }
    if (this.aimed) aimChain(this.sk, this.poses, this.world, this.aimed.chain, this.aimed.angle, this.aimed.weight);
    else computeWorld(this.sk, this.poses, this.world);
    for (const s of this.sprites) {
      const w = this.world.get(s.bone)!;
      // the sprite's top-left sits at (x, y) in bone space
      this.m.set(w.a, w.b, w.c, w.d, w.a * s.x + w.c * s.y + w.tx, w.b * s.x + w.d * s.y + w.ty);
      s.sprite.setFromMatrix(this.m);
    }
  }

  private texture(image: string): Texture {
    const t = this.textures.get(image);
    if (!t) throw new Error(`${this.sk.name} has no image ${image}`);
    return t;
  }
}
