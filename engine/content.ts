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

/** What drives a monster: `melee` walks up, lines up in depth and swings; `ranged` keeps its
 * distance, lines up in depth and shoots, hopping back when the hero gets close; `guard` walks up
 * and swings like `melee` behind a shield, turning slowly to a hero behind it; `still` stands there. */
export type Brain = 'melee' | 'ranged' | 'guard' | 'still';

/** How a ranged monster keeps its distance. */
export interface Ranged {
  /** Backs off while the hero is closer than this in x. */
  keep: number;
  /** Hops back (`backstep`) when the hero is closer than this in x and within `fleeY` in depth. */
  flee: number;
  fleeY: number;
  backstep: string;
  /** Ticks between two hops. */
  backstepCd: number;
}

/** A shield held forward: a hit from the front while guarding (see `guarding` in combat.ts)
 * deals `pct` percent of its damage and no stun, unless the move `breaks` guards. */
export interface Guard {
  pct: number;
  /** The move it turns around with when the hero gets behind it (it guards neither side meanwhile). */
  turn: string;
}

export interface Monster {
  body: Body;
  brain: Brain;
  walkX: number;
  walkY: number;
  /** Swings (or shoots) once the hero is this close in x and lined up within alignY in depth. */
  range: number;
  alignY: number;
  /** The move it swings. */
  attack: string;
  /** Ticks between two attacks, rolled each time. */
  cooldown: readonly [number, number];
  /** Ticks before the first attack after the room opens, rolled as it spawns (none: no roll). */
  firstCooldown?: readonly [number, number];
  /** Heals back to full every tick (the training dummy). */
  immortal?: boolean;
  ranged?: Ranged;
  guard?: Guard;
}

export type MonsterKind = 'bandit' | 'archer' | 'shield' | 'dummy';
export type Kind = 'hero' | MonsterKind;

export const MONSTERS: Readonly<Record<MonsterKind, Monster>> = {
  bandit: {
    body: { halfWidth: toFp(44), height: toFp(235), hp: 520 },
    brain: 'melee',
    walkX: toFp(3.5),
    walkY: toFp(2.5),
    range: toFp(150),
    alignY: toFp(20),
    attack: 'slash',
    cooldown: [ticks(1.3), ticks(2.7)],
    firstCooldown: [ticks(0.7), ticks(1.7)],
  },
  archer: {
    body: { halfWidth: toFp(38), height: toFp(225), hp: 340 },
    brain: 'ranged',
    walkX: toFp(3),
    walkY: toFp(2.5),
    range: toFp(800),
    alignY: toFp(16),
    attack: 'shoot',
    cooldown: [ticks(1.6), ticks(2.8)],
    firstCooldown: [ticks(1), ticks(2)],
    ranged: { keep: toFp(420), flee: toFp(230), fleeY: toFp(70), backstep: 'hop', backstepCd: ticks(2.5) },
  },
  shield: {
    body: { halfWidth: toFp(50), height: toFp(235), hp: 700 },
    brain: 'guard',
    walkX: toFp(2),
    walkY: toFp(1.6),
    range: toFp(140),
    alignY: toFp(22),
    attack: 'bash',
    cooldown: [ticks(1.8), ticks(3)],
    firstCooldown: [ticks(1), ticks(2)],
    guard: { pct: 15, turn: 'turn' },
  },
  dummy: {
    body: { halfWidth: toFp(40), height: toFp(220), hp: 1_000_000 },
    brain: 'still',
    walkX: 0,
    walkY: 0,
    range: 0,
    alignY: 0,
    attack: '',
    cooldown: [0, 0],
    immortal: true,
  },
};

export const BODIES: Readonly<Record<Kind, Body>> = {
  hero: { halfWidth: toFp(32), height: toFp(220), hp: 1000 },
  bandit: MONSTERS.bandit.body,
  archer: MONSTERS.archer.body,
  shield: MONSTERS.shield.body,
  dummy: MONSTERS.dummy.body,
};

/** Two monsters closer than this in x and depth push apart. */
export const CROWD = {
  sepX: toFp(60),
  sepY: toFp(24),
  push: toFp(2),
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
  /** Untouchable this long after a quick rise has got the hero up (on top of the getup itself). */
  riseInv: ticks(0.4),
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

/** What a hit does to its target, from a move or a projectile. */
export interface HitData {
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
  /** Goes through a shield (see Guard). */
  breaks?: boolean;
}

export interface Move extends HitData {
  id: string;
  /** Length in ticks; the body is free again after it. */
  total: number;
  /** First and last active tick, inclusive. */
  active: readonly [number, number];
  /** None: the move hits nothing itself (it shoots, or only moves the body). */
  box?: HitBox;
  /** From this tick on a buffered press may start the follow-up, a skill or the dodge. 0: never
   * (nothing cancels it). */
  cancel: number;
  /** The follow-up an ATTACK press chains into. */
  next?: string;
  /** The skill this move is part of: no move of a skill cancels into the same skill. */
  of?: SkillId;
  /** The next part a press of the same skill's button chains into (from `cancel` on). */
  follow?: string;
  /** The part that starts by itself when this one ends, steered like `steer`. */
  then?: string;
  /** Steered as it starts: the held direction turns it around (left, right) and sends it along
   * the depth (up, down) as well as, or instead of, forward. */
  steer?: boolean;
  /** Forward speed during ticks [from, to], FP per tick. */
  advance?: { from: number; to: number; speed: number };
  /** Super armour over ticks [from, to]: a hit still deals its damage and hitstop, but no stun. */
  armor?: readonly [number, number];
  /** Untouchable for this many ticks from the start. */
  inv?: number;
  /** Hits each target again every this many ticks of its active window (the hit list clears). */
  rehit?: number;
  /** A JUMP press before the move fires (or ends) cuts to this finish. */
  early?: string;
  /** Started in the air: gravity keeps acting, and landing ends it. */
  air?: boolean;
  /** Speeds the body is thrown at when the move starts: back (against its facing) and up.
   * With `air`, the move then lasts until it lands. */
  hop?: { back: number; up: number };
  /** Fires projectile `shot` on tick `at`, from `x` ahead of the body and `z` above its feet. */
  fire?: { at: number; shot: ShotKind; x: number; z: number };
  /** The body turns around as the move ends. */
  turn?: boolean;
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
  // the hero's skills (see SKILLS); every part of a skill is tagged with it
  {
    id: 'tri1', of: 'triple', total: 14, active: [3, 7], box: box(-10, 150, 45, 20, 220),
    damage: 45, hitstun: 18, stop: 3, push: toFp(8), launch: 0, lift: toFp(10),
    cancel: 8, follow: 'tri2', advance: { from: 1, to: 6, speed: toFp(18) },
  },
  {
    id: 'tri2', of: 'triple', total: 14, active: [3, 7], box: box(-10, 150, 45, 20, 220),
    damage: 50, hitstun: 18, stop: 3, push: toFp(8), launch: 0, lift: toFp(10),
    cancel: 8, follow: 'tri3', advance: { from: 1, to: 6, speed: toFp(18) },
  },
  {
    id: 'tri3', of: 'triple', total: 20, active: [3, 8], box: box(-10, 160, 45, 0, 230),
    damage: 65, hitstun: 20, stop: 5, push: toFp(10), launch: toFp(22), lift: toFp(18),
    cancel: 13, advance: { from: 1, to: 7, speed: toFp(20) },
  },
  // four dashes in a row that go where the stick points, the last one launching
  ...[1, 2, 3].map((i): Move => ({
    id: `dragon${i}`, of: 'dragon', total: 9, active: [2, 7], box: box(-20, 130, 50, 0, 220),
    damage: 40, hitstun: 20, stop: 2, push: toFp(6), launch: 0, lift: toFp(10),
    cancel: 0, steer: true, then: `dragon${i + 1}`, advance: { from: 1, to: 7, speed: toFp(30) },
  })),
  {
    id: 'dragon4', of: 'dragon', total: 20, active: [2, 8], box: box(-20, 140, 50, 0, 240),
    damage: 70, hitstun: 22, stop: 5, push: toFp(10), launch: toFp(26), lift: toFp(22),
    cancel: 14, steer: true, advance: { from: 1, to: 7, speed: toFp(30) },
  },
  {
    id: 'upper', of: 'upper', total: 20, active: [4, 7], box: box(0, 150, 40, 0, 260),
    damage: 52, hitstun: 20, stop: 4, push: toFp(3), launch: toFp(30), lift: toFp(26),
    cancel: 13, breaks: true,
  },
  // a shoulder ram under super armour, then the one-handed rising cut
  {
    id: 'crush1', of: 'crush', total: 12, active: [4, 8], box: box(0, 120, 45, 20, 220),
    damage: 40, hitstun: 22, stop: 3, push: toFp(4), launch: 0, lift: toFp(10),
    cancel: 0, then: 'crush2', advance: { from: 2, to: 8, speed: toFp(16) }, armor: [1, 12], breaks: true,
  },
  {
    id: 'crush2', of: 'crush', total: 20, active: [3, 6], box: box(0, 150, 45, 0, 280),
    damage: 70, hitstun: 22, stop: 5, push: toFp(3), launch: toFp(32), lift: toFp(28),
    cancel: 13, advance: { from: 1, to: 3, speed: toFp(6) }, armor: [1, 6], breaks: true,
  },
  // a still gathering, then one wide cut that knocks down all round
  {
    id: 'iai', of: 'iai', total: 34, active: [14, 16], box: box(-80, 380, 110, 0, 240),
    damage: 140, hitstun: 24, stop: 6, push: toFp(18), launch: toFp(14), lift: toFp(16),
    cancel: 24,
  },
  // the ultimate: a flurry on the spot under super armour, then a sword wave; jump fires the wave at once
  {
    id: 'phantom', of: 'phantom', total: 66, active: [4, 51], box: box(-40, 200, 60, 0, 240),
    damage: 22, hitstun: 14, stop: 1, push: toFp(2), launch: 0, lift: toFp(7),
    cancel: 0, rehit: 3, armor: [1, 66], early: 'phantomEnd', fire: { at: 56, shot: 'wave', x: toFp(60), z: 0 },
  },
  {
    id: 'phantomEnd', of: 'phantom', total: 14, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, armor: [1, 4], fire: { at: 3, shot: 'wave', x: toFp(60), z: 0 },
  },
  // the dodge: a hop back, untouchable as it leaves the ground
  {
    id: 'backstep', total: 30, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, air: true, hop: { back: toFp(17), up: toFp(20) }, inv: 8,
  },
  // the archer: a long, visible draw, then the arrow; and a hop back out of reach
  {
    id: 'shoot', total: 34, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, fire: { at: 21, shot: 'arrow', x: toFp(50), z: toFp(150) },
  },
  {
    id: 'hop', total: 30, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, air: true, hop: { back: toFp(13), up: toFp(20) },
  },
  {
    id: 'slash', total: 40, active: [17, 19], box: box(0, 170, 35, 20, 220),
    damage: 80, hitstun: 16, stop: 4, push: toFp(8), launch: 0, lift: toFp(8),
    cancel: 0, advance: { from: 15, to: 18, speed: toFp(4) },
  },
  // the shield bearer: a short step in behind the shield and a shove that throws the hero back;
  // and turning round, slowly, which is when it is open from both sides
  {
    id: 'bash', total: 34, active: [15, 17], box: box(0, 150, 35, 20, 220),
    damage: 65, hitstun: 18, stop: 5, push: toFp(20), launch: 0, lift: toFp(10),
    cancel: 0, advance: { from: 12, to: 16, speed: toFp(7) },
  },
  {
    id: 'turn', total: 16, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, turn: true,
  },
];

export const MOVES: Readonly<Record<string, Move>> = Object.fromEntries(MOVE_LIST.map((m) => [m.id, m]));

export type ShotKind = 'arrow' | 'wave';

/** A projectile: flies straight along x at `speed`, hits what its box touches (`box` is around
 * its own position, x forward of its flight), and is gone after `life` ticks, `pierce` hits or
 * the room's wall. */
export interface Shot extends HitData {
  speed: number;
  life: number;
  pierce: number;
  box: HitBox;
}

export const SHOTS: Readonly<Record<ShotKind, Shot>> = {
  // thin in depth and height: stepping out of its lane, or jumping, dodges it
  arrow: {
    speed: toFp(24), life: ticks(2.2), pierce: 1, box: box(-30, 30, 18, -8, 8),
    damage: 55, hitstun: 14, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
  },
  // the phantom dance's sword wave: tall and wide, through everything in its way
  wave: {
    speed: toFp(32), life: ticks(0.9), pierce: 20, box: box(-50, 50, 60, 0, 240),
    damage: 160, hitstun: 26, stop: 5, push: toFp(18), launch: toFp(24), lift: toFp(22), breaks: true,
  },
};

export type SkillId = 'triple' | 'dragon' | 'upper' | 'crush' | 'iai' | 'phantom';

/** A skill the hero can carry: the slot it goes in (0..2 the skills, 3 the ultimate; the buttons
 * SKILL1, SKILL2, SKILL3, ULT), the move it starts with, and its cooldown from that start. */
export interface Skill {
  slot: number;
  move: string;
  cooldown: number;
}

export const SKILLS: Readonly<Record<SkillId, Skill>> = {
  triple: { slot: 0, move: 'tri1', cooldown: ticks(4) },
  dragon: { slot: 0, move: 'dragon1', cooldown: ticks(7) },
  upper: { slot: 1, move: 'upper', cooldown: ticks(2.5) },
  crush: { slot: 1, move: 'crush1', cooldown: ticks(6) },
  iai: { slot: 2, move: 'iai', cooldown: ticks(8) },
  phantom: { slot: 3, move: 'phantom', cooldown: ticks(20) },
};

/** Skill slots a hero carries; its cooldowns are one per slot, then the dodge's. */
export const SLOTS = 4;
export const DODGE = { slot: SLOTS, move: 'backstep', cooldown: ticks(1) };

/** The skill in each slot when the player has not chosen. */
export const DEFAULT_LOADOUT: readonly SkillId[] = ['triple', 'upper', 'iai', 'phantom'];

/** One skill per slot, each in its own slot: what the server accepts from a client. */
export function validLoadout(l: unknown): l is SkillId[] {
  return Array.isArray(l) && l.length === SLOTS && l.every((id, i) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, id) && SKILLS[id as SkillId].slot === i);
}

export interface Spawn {
  kind: MonsterKind;
  x: number;
  y: number;
}

/** Which wall a door is in: left and right walls, the back edge of the floor (up) or its front (down). */
export type Side = 'left' | 'right' | 'up' | 'down';

export interface Door {
  side: Side;
  /** The room it leads to, by index. */
  to: number;
  /** Where along the room an up or down door is. */
  x?: number;
}

export interface Room {
  width: number;
  spawns: readonly Spawn[];
  /** Open once the room is clear; every door has a twin on the opposite side of the room it leads to. */
  doors: readonly Door[];
  /** A room that never clears (the training ground). */
  endless?: boolean;
}

export interface Dungeon {
  rooms: readonly Room[];
  /** Clearing this room wins the run. */
  boss: number;
}

export type DungeonId = 'trial' | 'training' | 'heifeng';

function room(width: number, spawns: [MonsterKind, number, number][], doors: [Side, number, number?][], endless = false): Room {
  return {
    width: toFp(width),
    spawns: spawns.map(([kind, x, y]) => ({ kind, x: toFp(x), y: toFp(y) })),
    doors: doors.map(([side, to, x]) => (x === undefined ? { side, to } : { side, to, x: toFp(x) })),
    endless,
  };
}

export const DUNGEONS: Record<DungeonId, Dungeon> = {
  trial: {
    rooms: [
      room(2600, [['bandit', 1100, 120], ['bandit', 1300, 260], ['bandit', 1500, 60]], [['right', 1]]),
      room(2200, [['bandit', 900, 200], ['bandit', 1100, 80], ['bandit', 1300, 300], ['bandit', 1500, 160]], [['left', 0]]),
    ],
    boss: 1,
  },
  training: { rooms: [room(2400, [['dummy', 900, 180], ['dummy', 1300, 120]], [], true)], boss: 0 },
  // Black Wind Fort (M2). The layout is final; bandits and archers in the first rooms as planned,
  // shield bearers from the gate on; the side room and the hall are placeholders until the elite
  // and the boss exist:
  //   0 mountain road > 1 mountain road > 2 gate > 3 inner fort > 5 hall (boss)
  //                                         v
  //                                    4 side room (elite, optional)
  heifeng: {
    rooms: [
      room(2400, [['bandit', 1100, 140], ['archer', 1800, 240]], [['right', 1]]),
      room(2400, [['bandit', 1000, 100], ['bandit', 1200, 260], ['archer', 1800, 180], ['archer', 2000, 40]], [['left', 0], ['right', 2]]),
      room(2600, [['bandit', 1000, 200], ['shield', 1400, 120], ['archer', 2000, 280]], [['left', 1], ['right', 3], ['down', 4, 1300]]),
      room(2400, [['bandit', 900, 120], ['shield', 1200, 260], ['archer', 1700, 200], ['archer', 1900, 60]], [['left', 2], ['right', 5]]),
      room(1800, [['bandit', 1100, 180]], [['up', 2, 900]]),
      room(2000, [['bandit', 1200, 180], ['bandit', 1400, 100], ['bandit', 1400, 260]], [['left', 3]]),
    ],
    boss: 5,
  },
};

/** Where heroes stand when they come in through a left-wall door (or start the run). */
export const ENTRY = { x: toFp(160), y: toFp(180) };
/** A hero this close to a door's wall walks through it, once the room is clear. */
export const DOOR_ZONE = toFp(120);
/** Up and down doors: how far either side of the door's x it reaches, how close to the floor's
 * edge a hero must walk to go through, and how far in from the edge one coming through stands. */
export const DOOR_HALF = toFp(110);
export const DOOR_DEPTH = toFp(24);
export const DOOR_STEP = toFp(72);
