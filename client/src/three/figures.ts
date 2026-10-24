import { fromFp, type DungeonId, type SimState } from '@dnf/engine';
import type { Scene, Texture } from 'three';
import { Actor, type Model } from './actor';

// The scenery's figures (design/CHAPTER1.md): bodies that stand about a room without being the
// engine's, drawn only. In 1-1 and 1-2's river village a buffalo grazes (taken by the ink with the
// villagers in 1-1's seep) and a child plays (it runs off as the ink comes down); in 1-3's lotus
// pond and bamboo a crane stands in the painting.

interface Place {
  /** The model's name in the loaded bodies or birds. */
  model: string;
  x: number;
  /** Engine depth: 0 is the floor's back edge. */
  depth: number;
  facing: 1 | -1;
  /** World units tall (the hero is 220). */
  height: number;
  /** Clips played now and then between spells of idle, in turn. */
  also: string[];
  /** Drawn in colour until 1-1's seep reaches it (`seepAt` seconds in), then ink. */
  seepAt?: number;
  /** Runs off to the left when 1-1's seep is this many seconds in, and is gone. */
  fleeAt?: number;
}

const BUFFALO: Pick<Place, 'model' | 'height' | 'also'> = { model: 'inkbuffalo', height: 170, also: ['graze', 'swish', 'graze'] };
const CRANE: Pick<Place, 'model' | 'height' | 'also'> = { model: 'crane', height: 200, also: ['dip', 'spread', 'dip'] };

/** By dungeon, then room. */
const PLACES: Partial<Record<DungeonId, Place[][]>> = {
  luobi: [
    [],
    [
      { model: 'child', x: 520, depth: 40, facing: 1, height: 140, also: [], fleeAt: 0.6 },
      { ...BUFFALO, x: 1950, depth: 15, facing: -1, seepAt: 1.6 },
    ],
    [{ ...BUFFALO, x: 420, depth: 20, facing: 1 }],
    [],
  ],
  jiangcun: [[{ ...BUFFALO, x: 600, depth: 15, facing: 1 }], [], [{ ...BUFFALO, x: 2200, depth: 25, facing: -1 }], [], []],
  pingfeng: [[], [{ ...CRANE, x: 620, depth: 20, facing: 1 }], [{ ...CRANE, x: 2150, depth: 15, facing: -1 }], []],
};

/** Seconds of idle between a figure's other clips; how long the seep takes to ink one; how fast a
 * fleeing child runs (world units a second). */
const IDLE_SEC = [4, 6.5, 5];
const INK_SEC = 1.0;
const FLEE_SPEED = 320;

interface Figure {
  place: Place;
  actor: Actor;
  x: number;
  facing: number;
  /** Seconds into the clip being played, its length, and which of `also` comes next. */
  t: number;
  len: number;
  clip: string;
  next: number;
  /** The seep has reached it: inked, or gone. */
  seen: boolean;
}

export class Figures {
  private key = '';
  private list: Figure[] = [];
  /** 1-1's child has run off this run: it does not come back. */
  private fled = false;
  private lastTick = 0;

  constructor(
    private readonly scene: Scene,
    private readonly models: Record<string, Model>,
    /** The colour picture of a body by name, for one drawn turning to ink. */
    private readonly colourOf: (name: string) => Texture | null,
  ) {}

  /** Moves the figures on `dt` seconds. `seep`: seconds into 1-1's seep, or -1 while there is none;
   * `gongbi`: how far the room's bodies are drawn gongbi. */
  update(s: SimState, dt: number, seep: number, gongbi: number): void {
    if (s.tick < this.lastTick) this.fled = false;
    this.lastTick = s.tick;
    const key = `${s.config.dungeon}:${s.room}`;
    if (key !== this.key) this.build(key, s);
    const roomW = fromFp(s.roomWidth);
    for (const f of this.list) {
      const p = f.place;
      if (p.fleeAt !== undefined && seep >= p.fleeAt && !f.seen) {
        f.seen = true;
        f.facing = -1;
      }
      if (p.seepAt !== undefined && f.actor.inked < 1) {
        if (seep >= 0) f.actor.inked = Math.min(1, Math.max(0, (seep - p.seepAt) / INK_SEC));
        else if (f.seen) f.actor.inked = 1;
        if (seep >= p.seepAt) f.seen = true;
      }
      let speed = 1;
      if (p.fleeAt !== undefined && f.seen) {
        f.clip = 'walk';
        speed = 1.8;
        f.x -= FLEE_SPEED * dt;
        if (f.x < -200 || f.x > roomW + 200) {
          this.fled = true;
          f.actor.root.visible = f.actor.floorShadow.visible = false;
          continue;
        }
      } else {
        f.t += dt;
        if (f.t >= f.len) this.nextClip(f);
      }
      f.actor.gongbi = gongbi;
      f.actor.stand(f.x, p.depth, f.facing, f.clip, speed, p.height * 0.3, dt);
    }
  }

  private nextClip(f: Figure): void {
    const { also } = f.place;
    f.t = 0;
    if (f.clip !== 'idle' || !also.length) {
      f.clip = 'idle';
      f.len = IDLE_SEC[f.next % IDLE_SEC.length];
      return;
    }
    f.clip = also[f.next % also.length];
    f.next++;
    f.len = this.models[f.place.model].moves?.[f.clip]?.duration ?? 2;
  }

  private build(key: string, s: SimState): void {
    this.dispose();
    this.key = key;
    const places = s.room >= 0 ? (PLACES[s.config.dungeon]?.[s.room] ?? []) : [];
    for (const place of places) {
      const model = this.models[place.model];
      if (!model || (place.fleeAt !== undefined && this.fled)) continue;
      const actor = new Actor(-100 - this.list.length, 'inkling', model, 0xffffff, false, place.height);
      if (place.seepAt !== undefined) {
        const was = this.colourOf(place.model);
        if (was) actor.inkFrom(was);
      }
      this.scene.add(actor.root, actor.floorShadow);
      const f: Figure = { place, actor, x: place.x, facing: place.facing, t: 0, len: 0, clip: 'idle', next: this.list.length, seen: false };
      // start each one somewhere in its idle, so two of a kind do not move together
      f.len = IDLE_SEC[f.next % IDLE_SEC.length];
      f.t = f.len * 0.4;
      this.list.push(f);
    }
  }

  /** A new run: the figures built again when the room is next drawn, the child back. */
  clear(): void {
    this.dispose();
    this.fled = false;
  }

  private dispose(): void {
    for (const f of this.list) f.actor.dispose();
    this.list = [];
    this.key = '';
  }
}
