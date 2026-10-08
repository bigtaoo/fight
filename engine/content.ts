import { toFp, ticks } from './math/fixed';

// Tuning and content: physics, bodies, the moves' frame data, the dungeons. Distances are
// written in world units (1 unit = 1 logical pixel at 1080p) and converted to FP once, at load.
// Frame data is in ticks of the 30 Hz sim; a move's tick 1 is the first tick it is active.
// Any change here changes replays: bump ENGINE_VERSION (Engine.ts).

export const WORLD = {
  /** Downward acceleration of a jumping body, FP per tick per tick. */
  gravity: toFp(3.6),
  /** Lighter gravity while launched by a hit, so juggles float the way DNF's do. */
  launchGravity: toFp(2.4),
  /** Slide-out of a hit, FP per tick per tick. */
  friction: toFp(1.2),
  /** Depth of the walkable floor band: y runs from 0 (back) to this (front). */
  depth: toFp(360),
  /** A launched body landing faster than this bounces once. */
  bounceSpeed: toFp(10),
  /** Ticks lying down after a launch, then getting up (both untouchable). */
  downTicks: ticks(0.8),
  getupTicks: ticks(0.33),
  /** A dead monster fades for this long before it leaves the state. */
  fadeTicks: ticks(1.5),
};

export interface Body {
  /** Half the hurtbox width. */
  halfWidth: number;
  height: number;
  hp: number;
}

export type Kind = 'hero' | 'bandit' | 'dummy';

export const BODIES: Record<Kind, Body> = {
  hero: { halfWidth: toFp(32), height: toFp(220), hp: 1000 },
  bandit: { halfWidth: toFp(44), height: toFp(235), hp: 520 },
  dummy: { halfWidth: toFp(40), height: toFp(220), hp: 1_000_000 },
};

export const HERO = {
  walkX: toFp(7),
  walkY: toFp(4.5),
  runX: toFp(12),
  jumpVz: toFp(33),
  /** Horizontal speed steered in the air. */
  airX: toFp(6),
  /** Two presses of a direction within this many ticks start a run. */
  doubleTap: 8,
  /** A press is remembered this long (in unfrozen ticks) until the hero can act on it. */
  buffer: 6,
};

export const BANDIT = {
  walkX: toFp(3.5),
  walkY: toFp(2.5),
  /** Attacks once the hero is this close in x and lined up within alignY in depth. */
  range: toFp(150),
  alignY: toFp(20),
  /** Ticks between two attacks, rolled each time. */
  cooldown: [ticks(1.3), ticks(2.7)] as const,
  /** Ticks before the first attack after the room opens. */
  firstCooldown: [ticks(0.7), ticks(1.7)] as const,
  /** Two monsters closer than this in x and depth push apart. */
  sepX: toFp(60),
  sepY: toFp(24),
  sepPush: toFp(2),
};

/** An attack box relative to the attacker: x forward of its facing, z up from its feet. */
export interface HitBox {
  x0: number;
  x1: number;
  /** Max depth (y) distance to the target. */
  depth: number;
  z0: number;
  z1: number;
}

export interface Move {
  id: string;
  /** Length in ticks; the body is free again after it. */
  total: number;
  /** First and last active tick, inclusive. */
  active: readonly [number, number];
  box: HitBox;
  damage: number;
  /** Ticks a grounded target stays stunned after the hitstop. */
  hitstun: number;
  /** Ticks both bodies freeze on contact. */
  stop: number;
  /** Speed the target slides away at, FP per tick. */
  push: number;
  /** Upward speed a grounded target is launched at (0: it stays on the ground). */
  launch: number;
  /** Upward speed an airborne target is lifted to, before the juggle decay. */
  lift: number;
  /** From this tick on a buffered press may start the follow-up (or a skill). 0: never. */
  cancel: number;
  /** The follow-up an ATTACK press chains into. */
  next?: string;
  /** Forward speed during ticks [from, to], FP per tick. */
  advance?: { from: number; to: number; speed: number };
  /** Started in the air: gravity keeps acting, and landing ends it. */
  air?: boolean;
  /** Ticks before the skill can be used again. */
  cooldown?: number;
}

function box(x0: number, x1: number, depth: number, z0: number, z1: number): HitBox {
  return { x0: toFp(x0), x1: toFp(x1), depth: toFp(depth), z0: toFp(z0), z1: toFp(z1) };
}

const MOVE_LIST: Move[] = [
  {
    id: 'atk1', total: 11, active: [3, 5], box: box(10, 150, 40, 40, 200),
    damage: 34, hitstun: 12, stop: 3, push: toFp(5), launch: 0, lift: toFp(9),
    cancel: 6, next: 'atk2', advance: { from: 1, to: 3, speed: toFp(3) },
  },
  {
    id: 'atk2', total: 12, active: [3, 5], box: box(10, 160, 40, 40, 200),
    damage: 38, hitstun: 13, stop: 3, push: toFp(5), launch: 0, lift: toFp(9),
    cancel: 6, next: 'atk3', advance: { from: 1, to: 3, speed: toFp(3) },
  },
  {
    id: 'atk3', total: 18, active: [4, 7], box: box(0, 190, 45, 20, 220),
    damage: 60, hitstun: 18, stop: 5, push: toFp(14), launch: 0, lift: toFp(12),
    cancel: 12, advance: { from: 1, to: 5, speed: toFp(6) },
  },
  {
    id: 'jumpAtk', total: 14, active: [2, 8], box: box(-10, 150, 40, -60, 160),
    damage: 36, hitstun: 14, stop: 3, push: toFp(4), launch: 0, lift: toFp(10),
    cancel: 0, air: true,
  },
  {
    id: 'upper', total: 20, active: [4, 7], box: box(0, 150, 40, 0, 260),
    damage: 52, hitstun: 20, stop: 4, push: toFp(3), launch: toFp(30), lift: toFp(26),
    cancel: 13, cooldown: ticks(2.5),
  },
  {
    id: 'dash', total: 18, active: [3, 10], box: box(-20, 140, 45, 0, 220),
    damage: 75, hitstun: 22, stop: 5, push: toFp(16), launch: toFp(14), lift: toFp(14),
    cancel: 14, advance: { from: 2, to: 10, speed: toFp(26) }, cooldown: ticks(4),
  },
  {
    id: 'slash', total: 40, active: [17, 19], box: box(0, 170, 35, 20, 220),
    damage: 80, hitstun: 16, stop: 4, push: toFp(8), launch: 0, lift: toFp(8),
    cancel: 0, advance: { from: 15, to: 18, speed: toFp(4) },
  },
];

export const MOVES: Readonly<Record<string, Move>> = Object.fromEntries(MOVE_LIST.map((m) => [m.id, m]));

/** The hero's skills, by slot: SKILL1, SKILL2. */
export const SKILLS = ['upper', 'dash'] as const;

export interface Spawn {
  kind: Kind;
  x: number;
  y: number;
}

export interface Room {
  width: number;
  spawns: readonly Spawn[];
  /** A room that never clears (the training ground). */
  endless?: boolean;
}

export type DungeonId = 'trial' | 'training';

function room(width: number, spawns: [Kind, number, number][], endless = false): Room {
  return { width: toFp(width), spawns: spawns.map(([kind, x, y]) => ({ kind, x: toFp(x), y: toFp(y) })), endless };
}

export const DUNGEONS: Record<DungeonId, readonly Room[]> = {
  trial: [
    room(2600, [['bandit', 1100, 120], ['bandit', 1300, 260], ['bandit', 1500, 60]]),
    room(2200, [['bandit', 900, 200], ['bandit', 1100, 80], ['bandit', 1300, 300], ['bandit', 1500, 160]]),
  ],
  training: [room(2400, [['dummy', 900, 180], ['dummy', 1300, 120]], true)],
};

/** Where heroes stand when a room opens. */
export const ENTRY = { x: toFp(160), y: toFp(180) };
/** A hero this close to the right wall of a cleared room walks into the next one. */
export const DOOR_ZONE = toFp(120);
