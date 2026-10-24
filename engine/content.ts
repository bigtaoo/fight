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
  /** Ticks lying down after a launch, then getting up (untouchable). */
  downTicks: ticks(0.8),
  getupTicks: ticks(0.33),
  /** A body lying down can be hit this many times from its knockdown to its getup (a relaunch
   * and the landing after it included), then it is untouchable until it is up: no endless lock. */
  downHits: 3,
  /** Each hit on a body lying down keeps it down this much longer, does this percent of the
   * damage, and a launching move lifts it this percent of the launch (before the juggle decay). */
  downHitTicks: ticks(0.2),
  downDmgPct: 70,
  relaunchPct: 70,
  /** How high a body lying down stands, for a hit's box to reach it. */
  lyingHeight: toFp(60),
  /** A dead monster fades for this long before it leaves the state. */
  fadeTicks: ticks(1.5),
  /** A hero's combo lapses this long after its last hit. */
  comboTicks: ticks(1.2),
};

export interface Body {
  /** Half the hurtbox width. */
  halfWidth: number;
  height: number;
  hp: number;
}

/** What drives a monster: `melee` walks up, lines up in depth and swings; `ranged` keeps its
 * distance, lines up in depth and shoots, hopping back when the hero gets close; `guard` walks up
 * and swings like `melee` behind a shield, turning slowly to a hero behind it; `boss` picks one of
 * its moves by the distance to the hero (see Boss); `still` stands there; `flyer` hovers out of
 * reach of ground moves and dives at the hero (see Fly, systems/flyer.ts). */
export type Brain = 'melee' | 'ranged' | 'guard' | 'boss' | 'still' | 'flyer';

/** A flying monster: it hovers at `hover` (FP, above the floor), climbing or sinking `climb` a
 * tick, near the hero; once lined up it shows `windup`, then dives along `dive` onto where the
 * hero stood (`diveTicks` to get there) and, down on the ground, plays `peck`: the opening, when
 * ground moves reach it. Gravity takes it only once it is launched by a hit. */
export interface Fly {
  hover: number;
  climb: number;
  windup: string;
  dive: string;
  diveTicks: number;
  peck: string;
}

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

/** A move a boss may pick, once its cooldown is up and the hero is within `reach` in x and
 * `alignY` in depth: drawn by `weight` for the distance band the hero is in (near, mid, far). */
export interface BossMove {
  move: string;
  /** The quicker version it uses in its second phase. */
  fast: string;
  reach: number;
  alignY: number;
  weight: readonly [number, number, number];
}

/** A boss: its moves, picked from the engine's `ai` stream; and its second phase, which starts
 * with `roar` once its health is down to `phase2Pct` percent, calls in `summon` (each x is from
 * the wall farther from the hero) and shortens its cooldowns to `fastPct` percent. */
export interface Boss {
  moves: readonly BossMove[];
  /** Where the near band ends and the mid band ends, in x. */
  bands: readonly [number, number];
  phase2Pct: number;
  roar: string;
  summon: readonly Spawn[];
  fastPct: number;
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
  /** Super armour while it stands or walks (its moves carry their own windows, which end where
   * the recovery starts: the openings). */
  armor?: boolean;
  /** Each further hit in one juggle lifts this many percent less, down to `floor` percent
   * (the default: 12, 30). */
  juggle?: { decay: number; floor: number };
  boss?: Boss;
  /** An elite: on the harder tiers it rolls the tier's elite affixes (see TIERS), like a boss. */
  elite?: boolean;
  /** A flyer (brain `flyer`). */
  fly?: Fly;
  /** What it may leave behind when it dies: `item`, `pct` percent of the time. */
  drop?: { item: ItemKind; pct: number };
}

export type ItemKind = 'potion' | 'bigPotion';

/** Healing left on the floor by fallen monsters: a hurt hero who walks over one drinks it and
 * gets `heal` percent of their health back (one at full health leaves it lying for later). A
 * room's items are gone once the heroes leave it. */
export const ITEMS: Readonly<Record<ItemKind, { heal: number }>> = {
  potion: { heal: 20 },
  bigPotion: { heal: 50 },
};

/** A difficulty tier (design/CONTENT.md): the monsters' health and damage in percent, the affixes
 * an elite or a boss rolls, and the chance in percent that any other monster rolls one. */
export interface Tier {
  hpPct: number;
  dmgPct: number;
  eliteAffixes: number;
  gruntPct: number;
}

/** Normal, adventure, warrior, king. */
export const TIERS: readonly Tier[] = [
  { hpPct: 100, dmgPct: 100, eliteAffixes: 0, gruntPct: 0 },
  { hpPct: 180, dmgPct: 150, eliteAffixes: 1, gruntPct: 0 },
  { hpPct: 300, dmgPct: 220, eliteAffixes: 2, gruntPct: 15 },
  { hpPct: 500, dmgPct: 300, eliteAffixes: 3, gruntPct: 25 },
];

/** What a monster may roll on the harder tiers, each a bit of Entity.affixes:
 * frenzy walks and attacks sooner, ironclad is never stunned, a ward soaks damage until it
 * breaks, summon calls bandits now and then, miasma leaves a poison cloud where it dies, revive
 * gets up once at half health. */
export const AFFIXES = ['frenzy', 'ironclad', 'ward', 'summon', 'miasma', 'revive'] as const;
export type Affix = (typeof AFFIXES)[number];

export const AFFIX = {
  frenzy: { walkPct: 140, cdPct: 55 },
  /** The ward's strength in percent of the monster's health. */
  ward: { pct: 30 },
  /** Two of `kind` either side of it every `every` ticks, `times` times, while fewer than `max`
   * monsters stand. */
  summon: { kind: 'bandit' as MonsterKind, every: ticks(8), times: 3, max: 8, dx: toFp(160) },
  /** The cloud lasts `life` ticks and every `every` ticks hurts each hero inside by `damage`
   * (scaled by the tier); it never kills. */
  miasma: { life: ticks(6), every: ticks(0.5), damage: 30, x: toFp(140), y: toFp(70) },
} as const;

/** A hero this close to an item in x and depth picks it up. */
export const PICKUP = { x: toFp(60), y: toFp(40) };

export type MonsterKind = 'bandit' | 'elite' | 'archer' | 'shield' | 'chief' | 'dummy' | 'inkling' | 'brute' | 'woodcutter' | 'fisher' | 'washer' | 'hewer' | 'finch' | 'bigfinch' | 'pheasant';
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
    drop: { item: 'potion', pct: 15 },
  },
  // the side room's elite bandit: the bandit's cut, but tougher, quicker on its feet, swinging
  // twice as often and harder to keep in the air
  elite: {
    body: { halfWidth: toFp(50), height: toFp(260), hp: 1800 },
    brain: 'melee',
    walkX: toFp(4.8),
    walkY: toFp(3.4),
    range: toFp(160),
    alignY: toFp(24),
    attack: 'slash',
    cooldown: [ticks(0.6), ticks(1.4)],
    firstCooldown: [ticks(0.4), ticks(0.9)],
    juggle: { decay: 25, floor: 20 },
    elite: true,
    drop: { item: 'bigPotion', pct: 100 },
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
    drop: { item: 'potion', pct: 15 },
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
    drop: { item: 'potion', pct: 30 },
  },
  // the fort's chief: half as big again, in super armour except in the recovery of a move,
  // and quickly out of a juggle
  chief: {
    body: { halfWidth: toFp(62), height: toFp(330), hp: 4800 },
    brain: 'boss',
    walkX: toFp(2.6),
    walkY: toFp(2),
    range: toFp(240),
    alignY: toFp(40),
    attack: '',
    cooldown: [ticks(1), ticks(2)],
    firstCooldown: [ticks(1), ticks(1.5)],
    armor: true,
    juggle: { decay: 35, floor: 0 },
    boss: {
      moves: [
        { move: 'chop', fast: 'chopF', reach: toFp(240), alignY: toFp(45), weight: [6, 0, 0] },
        { move: 'charge', fast: 'chargeF', reach: toFp(3000), alignY: toFp(30), weight: [1, 3, 5] },
        { move: 'slam', fast: 'slamF', reach: toFp(900), alignY: toFp(400), weight: [2, 4, 2] },
      ],
      bands: [toFp(300), toFp(700)],
      phase2Pct: 50,
      roar: 'roar',
      summon: [
        { kind: 'bandit', x: toFp(250), y: toFp(80) },
        { kind: 'bandit', x: toFp(250), y: toFp(280) },
      ],
      fastPct: 60,
    },
  },
  // chapter one (design/CHAPTER1.md): villagers the ink has turned. The inkling is the first
  // thing the player ever hits: slow, soft, a long reach back before a weak claw
  inkling: {
    body: { halfWidth: toFp(40), height: toFp(225), hp: 260 },
    brain: 'melee',
    walkX: toFp(2.6),
    walkY: toFp(2),
    range: toFp(130),
    alignY: toFp(20),
    attack: 'claw',
    cooldown: [ticks(2), ticks(3.4)],
    firstCooldown: [ticks(1.2), ticks(2.4)],
    drop: { item: 'potion', pct: 10 },
  },
  // the one that teaches the dodge: an arm raised high for a second under super armour (no
  // cutting it short), then a blow that knocks down
  brute: {
    body: { halfWidth: toFp(48), height: toFp(250), hp: 900 },
    brain: 'melee',
    walkX: toFp(2.2),
    walkY: toFp(1.8),
    range: toFp(170),
    alignY: toFp(26),
    attack: 'smash',
    cooldown: [ticks(2.2), ticks(3.2)],
    firstCooldown: [ticks(1.5), ticks(2.5)],
  },
  // 1-1's boss, the ink-eaten woodcutter: the chief's pattern made gentler, a hack in front, a
  // sweep for a hero up close, a low rush along its lane and a leap onto the hero, two inklings
  // called in at half health
  woodcutter: {
    body: { halfWidth: toFp(58), height: toFp(300), hp: 2000 },
    brain: 'boss',
    walkX: toFp(2.4),
    walkY: toFp(1.8),
    range: toFp(220),
    alignY: toFp(40),
    attack: '',
    cooldown: [ticks(2.8), ticks(3.8)],
    firstCooldown: [ticks(1.5), ticks(2)],
    armor: true,
    juggle: { decay: 30, floor: 0 },
    boss: {
      moves: [
        { move: 'hack', fast: 'hackF', reach: toFp(230), alignY: toFp(45), weight: [4, 0, 0] },
        { move: 'sweep', fast: 'sweepF', reach: toFp(260), alignY: toFp(80), weight: [3, 1, 0] },
        { move: 'rush', fast: 'rushF', reach: toFp(2400), alignY: toFp(30), weight: [1, 2, 3] },
        { move: 'leap', fast: 'leapF', reach: toFp(900), alignY: toFp(400), weight: [1, 2, 1] },
      ],
      bands: [toFp(280), toFp(650)],
      phase2Pct: 50,
      roar: 'roar',
      summon: [
        { kind: 'inkling', x: toFp(250), y: toFp(90) },
        { kind: 'inkling', x: toFp(250), y: toFp(270) },
      ],
      fastPct: 75,
    },
  },
  // 1-2's ink villagers (see INK): the fisher casts a hook down its lane that reels the hero in;
  // the washerwoman lobs ink over the crowd at where the hero stands, which stains the ground
  fisher: {
    body: { halfWidth: toFp(40), height: toFp(230), hp: 380 },
    brain: 'ranged',
    walkX: toFp(2.4),
    walkY: toFp(2),
    range: toFp(680),
    alignY: toFp(18),
    attack: 'cast',
    cooldown: [ticks(2.4), ticks(3.4)],
    firstCooldown: [ticks(1.2), ticks(2)],
    ranged: { keep: toFp(300), flee: toFp(110), fleeY: toFp(60), backstep: 'hop', backstepCd: ticks(3) },
    drop: { item: 'potion', pct: 15 },
  },
  washer: {
    body: { halfWidth: toFp(40), height: toFp(220), hp: 340 },
    brain: 'ranged',
    walkX: toFp(2.2),
    walkY: toFp(2),
    range: toFp(820),
    // a lob comes down wherever the hero stands: no need to line up
    alignY: toFp(400),
    attack: 'lob',
    cooldown: [ticks(3), ticks(4)],
    firstCooldown: [ticks(1), ticks(2)],
    ranged: { keep: toFp(420), flee: toFp(160), fleeY: toFp(70), backstep: 'hop', backstepCd: ticks(2.5) },
    drop: { item: 'potion', pct: 15 },
  },
  // the threshing floor's woodcutters: the boss's hack without the rest of the boss, under
  // super armour as it winds up; one may leave a big potion
  hewer: {
    body: { halfWidth: toFp(50), height: toFp(260), hp: 1000 },
    brain: 'melee',
    walkX: toFp(2.2),
    walkY: toFp(1.8),
    range: toFp(200),
    alignY: toFp(30),
    attack: 'hack',
    cooldown: [ticks(3), ticks(4)],
    firstCooldown: [ticks(1.5), ticks(2.5)],
    juggle: { decay: 20, floor: 20 },
    drop: { item: 'bigPotion', pct: 50 },
  },
  // 1-3's finch flock (design/CHAPTER1.md): small and frail, hovering above the reach of ground
  // moves; a flash, a dive onto the hero, a moment pecking on the ground, then up again
  finch: {
    body: { halfWidth: toFp(30), height: toFp(70), hp: 80 },
    brain: 'flyer',
    walkX: toFp(4),
    walkY: toFp(2.6),
    range: toFp(150),
    alignY: toFp(40),
    attack: 'dive',
    cooldown: [ticks(1.6), ticks(3.2)],
    firstCooldown: [ticks(1), ticks(3)],
    fly: { hover: toFp(250), climb: toFp(6), windup: 'flash', dive: 'dive', diveTicks: 12, peck: 'peck' },
  },
  // 1-3's big sparrow: on the ground, pecking at the dirt until the hero comes, then a burst of
  // pecks in front; a ground target among the flock, slow to turn from its pecking
  bigfinch: {
    body: { halfWidth: toFp(55), height: toFp(140), hp: 420 },
    brain: 'melee',
    walkX: toFp(3),
    walkY: toFp(2.2),
    range: toFp(140),
    alignY: toFp(30),
    attack: 'pecks',
    cooldown: [ticks(1.8), ticks(2.8)],
    firstCooldown: [ticks(1), ticks(2)],
    juggle: { decay: 15, floor: 25 },
    drop: { item: 'potion', pct: 20 },
  },
  // 1-3's elite, the golden pheasant in the screen's last panel: a tail sweep round itself, a
  // flight up out of the screen that comes down on the hero, and a fan of tail feathers along its
  // lane; quicker once it is down to 40 percent (no help comes: it is alone in the picture)
  pheasant: {
    body: { halfWidth: toFp(70), height: toFp(200), hp: 1800 },
    brain: 'boss',
    walkX: toFp(3.2),
    walkY: toFp(2.2),
    range: toFp(220),
    alignY: toFp(40),
    attack: '',
    cooldown: [ticks(2), ticks(3)],
    firstCooldown: [ticks(1), ticks(1.6)],
    juggle: { decay: 25, floor: 15 },
    elite: true,
    boss: {
      moves: [
        { move: 'tail', fast: 'tailF', reach: toFp(220), alignY: toFp(70), weight: [6, 0, 0] },
        { move: 'soar', fast: 'soarF', reach: toFp(1000), alignY: toFp(400), weight: [2, 4, 3] },
        { move: 'fan', fast: 'fanF', reach: toFp(1400), alignY: toFp(30), weight: [1, 3, 5] },
      ],
      bands: [toFp(260), toFp(650)],
      phase2Pct: 40,
      roar: 'cry',
      summon: [],
      fastPct: 70,
    },
    drop: { item: 'bigPotion', pct: 100 },
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
  hero: { halfWidth: toFp(32), height: toFp(220), hp: 1500 },
  bandit: MONSTERS.bandit.body,
  elite: MONSTERS.elite.body,
  archer: MONSTERS.archer.body,
  shield: MONSTERS.shield.body,
  chief: MONSTERS.chief.body,
  dummy: MONSTERS.dummy.body,
  inkling: MONSTERS.inkling.body,
  brute: MONSTERS.brute.body,
  woodcutter: MONSTERS.woodcutter.body,
  fisher: MONSTERS.fisher.body,
  washer: MONSTERS.washer.body,
  hewer: MONSTERS.hewer.body,
  finch: MONSTERS.finch.body,
  bigfinch: MONSTERS.bigfinch.body,
  pheasant: MONSTERS.pheasant.body,
};

/** 1-2's ink (systems/ink.ts). A hook that lands reels its target in for up to `ticks` ticks at
 * `speed`, until it is `gap` from the fisher, then lets go `release` ticks later (a dodge breaks
 * free sooner; see breakTow in hero.ts). A lob flies `flight` ticks in an arc `apex` high to where
 * the hero stood (at most `reach` away), splashes whoever is under it (within x, y, z) and leaves a
 * patch that for `life` ticks hurts each hero inside every `every` ticks by `damage` (scaled by
 * the tier; it never kills) and slows their walking to `slowPct` percent. A lurking monster waits
 * unseen and untouchable until a hero comes within its lurk distance in x, then springs out with
 * `pounce`. */
export const INK = {
  tow: { ticks: ticks(0.8), speed: toFp(22), gap: toFp(130), release: 4 },
  lob: { flight: 26, apex: toFp(200), reach: toFp(820), x: toFp(70), y: toFp(36), z: toFp(80) },
  splash: { damage: 22, hitstun: 14, stop: 3, push: toFp(4), launch: 0, lift: toFp(8) } as HitData,
  patch: { life: ticks(4), every: ticks(0.5), damage: 6, x: toFp(100), y: toFp(44), slowPct: 50 },
  pounce: 'pounce',
};

/** Two monsters closer than this in x and depth push apart. A melee monster lines up on the
 * hero's depth unless one nearer the hero on the same side stands there (within sepY); then it
 * takes the nearest free lane beside it, laneY apart: inside the reach of the hero's cuts, out of
 * its own, and waits there a little farther off than its reach for its turn. */
export const CROWD = {
  sepX: toFp(60),
  sepY: toFp(24),
  push: toFp(2),
  laneY: toFp(36),
  lanes: 2,
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
  /** Clearing a room (not the last) gives this many percent of the hero's health back. */
  clearHeal: 30,
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
  /** Slams an airborne target down at this speed instead of lifting it; it bounces off the floor
   * (once more, however it was launched), so the juggle can go on. */
  spike?: number;
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
  /** Fires projectile `shot` on tick `at`, from `x` ahead of the body and `z` above its feet;
   * `twin`: one each way. */
  fire?: { at: number; shot: ShotKind; x: number; z: number; twin?: boolean };
  /** The body turns around as the move ends. */
  turn?: boolean;
  /** With `hop`: the forward speed is set as it starts to land on the hero, up to this (monsters). */
  leap?: number;
  /** With `air`: the move that starts as it lands. */
  land?: string;
  /** Lobs a ball of ink (INK.lob) on tick `at`, from `x` ahead of the body and `z` above its feet. */
  lob?: { at: number; x: number; z: number };
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
    cancel: 0, air: true, next: 'jumpSlam',
  },
  // a second ATTACK press in the air: a dive cutting down that slams what it hits into the floor
  {
    id: 'jumpSlam', total: 90, active: [2, 89], box: box(-20, 150, 45, -140, 120),
    damage: 42, hitstun: 16, stop: 4, push: toFp(4), launch: 0, lift: toFp(10), spike: toFp(28),
    cancel: 0, air: true, hop: { back: -toFp(6), up: -toFp(18) },
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
    damage: 30, hitstun: 16, stop: 4, push: toFp(8), launch: 0, lift: toFp(8),
    cancel: 0, advance: { from: 15, to: 18, speed: toFp(4) },
  },
  // the shield bearer: a short step in behind the shield and a shove that throws the hero back;
  // and turning round, slowly, which is when it is open from both sides
  {
    id: 'bash', total: 34, active: [15, 17], box: box(0, 150, 35, 20, 220),
    damage: 25, hitstun: 18, stop: 5, push: toFp(20), launch: 0, lift: toFp(10),
    cancel: 0, advance: { from: 12, to: 16, speed: toFp(7) },
  },
  {
    id: 'turn', total: 16, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, turn: true,
  },
  // chapter one's ink monsters: the inkling's reach back and claw; the brute's raised arm and smash
  {
    id: 'claw', total: 38, active: [17, 19], box: box(0, 140, 35, 20, 200),
    damage: 18, hitstun: 14, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
    cancel: 0, advance: { from: 14, to: 18, speed: toFp(3) },
  },
  {
    id: 'smash', total: 56, active: [31, 34], box: box(0, 200, 45, 0, 240),
    damage: 55, hitstun: 22, stop: 6, push: toFp(14), launch: toFp(16), lift: toFp(14),
    cancel: 0, advance: { from: 28, to: 32, speed: toFp(5) }, armor: [6, 34],
  },
  // 1-2: the fisher's cast and the washerwoman's lob, each a long wind-up; a lurker's pounce
  {
    id: 'cast', total: 40, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, fire: { at: 24, shot: 'hook', x: toFp(50), z: toFp(140) },
  },
  {
    id: 'lob', total: 40, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, lob: { at: 22, x: toFp(30), z: toFp(170) },
  },
  {
    id: 'pounce', total: 40, active: [2, 40], box: box(0, 120, 35, 0, 200),
    damage: 20, hitstun: 14, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
    cancel: 0, air: true, hop: { back: -toFp(14), up: toFp(16) },
  },
  // the finch: a flash as it hovers, the dive (the brain steers it; it hits whatever it passes
  // through on the way down) and the peck on the ground after it, its opening
  {
    id: 'flash', total: 12, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0,
  },
  {
    id: 'dive', total: 40, active: [1, 40], box: box(-20, 60, 30, -40, 70),
    damage: 12, hitstun: 12, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
    cancel: 0,
  },
  {
    id: 'peck', total: 20, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0,
  },
  // the big sparrow's burst of pecks, each a light blow
  {
    id: 'pecks', total: 44, active: [16, 25], box: box(0, 140, 35, 0, 120),
    damage: 12, hitstun: 10, stop: 2, push: toFp(3), launch: 0, lift: toFp(6),
    cancel: 0, rehit: 4,
  },
  ...pheasantMoves('', 100),
  ...pheasantMoves('F', 70),
  // the pheasant's cry as it turns quick, under super armour
  {
    id: 'cry', total: 36, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, armor: [1, 36],
  },
  ...woodMoves('', 100),
  ...woodMoves('F', 70),
  // the chief, each move in two speeds (the second phase's is quicker to start and to recover)
  ...chiefMoves('', 100),
  ...chiefMoves('F', 65),
  // the second phase starts: a roar under super armour that calls in help
  {
    id: 'roar', total: 40, active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, armor: [1, 40],
  },
];

/** The chief's moves, their windups and recoveries at `pct` percent, ids suffixed with `sfx`: a
 * heavy chop wide in front that knocks down; a charge across half the room along its lane, low
 * enough to jump; and a slam: a crouch, a leap that lands on the hero, a shockwave both ways
 * along the floor. Under super armour until the recovery. */
function chiefMoves(sfx: string, pct: number): Move[] {
  const t = (n: number) => Math.trunc((n * pct) / 100);
  const chopW = t(28);
  const chargeW = t(24);
  const dash = 30;
  return [
    {
      id: `chop${sfx}`, total: chopW + 4 + t(28), active: [chopW + 1, chopW + 4], box: box(0, 260, 60, 0, 280),
      damage: 75, hitstun: 22, stop: 6, push: toFp(14), launch: toFp(16), lift: toFp(14),
      cancel: 0, advance: { from: chopW - 2, to: chopW + 2, speed: toFp(6) }, armor: [1, chopW + 4],
    },
    {
      id: `charge${sfx}`, total: chargeW + dash + t(26), active: [chargeW + 1, chargeW + dash], box: box(-20, 120, 40, 0, 80),
      damage: 55, hitstun: 20, stop: 4, push: toFp(20), launch: toFp(18), lift: toFp(14),
      cancel: 0, advance: { from: chargeW + 1, to: chargeW + dash, speed: toFp(30) }, armor: [1, chargeW + dash],
    },
    {
      id: `slam${sfx}`, total: t(20), active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, then: `slamAir${sfx}`, armor: [1, t(20)],
    },
    {
      id: `slamAir${sfx}`, total: 90, active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, air: true, hop: { back: 0, up: toFp(36) }, leap: toFp(30), land: `slamLand${sfx}`, armor: [1, 90],
    },
    {
      id: `slamLand${sfx}`, total: t(30), active: [1, 2], box: box(-140, 140, 70, 0, 180),
      damage: 60, hitstun: 20, stop: 5, push: toFp(16), launch: toFp(18), lift: toFp(14),
      cancel: 0, armor: [1, 2], fire: { at: 1, shot: 'quake', x: toFp(60), z: 0, twin: true },
    },
  ];
}

/** The pheasant's moves, windups and recoveries at `pct` percent, ids suffixed with `sfx`: a tail
 * sweep round itself that reaches behind it as far as in front (step away, not aside); a crouch,
 * a flight high out of reach that comes down on the hero and knocks down (dodge it as it lands);
 * and three tail feathers thrown one after another along its lane (step out of the lane). Under
 * super armour as it winds up, open as it recovers. */
function pheasantMoves(sfx: string, pct: number): Move[] {
  const t = (n: number) => Math.trunc((n * pct) / 100);
  const tailW = t(20);
  const fan = (id: string, then?: string): Move => ({
    id, total: t(14), active: [0, -1],
    damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
    cancel: 0, fire: { at: t(8), shot: 'feather', x: toFp(70), z: toFp(90) }, armor: [1, t(10)], ...(then ? { then } : {}),
  });
  return [
    {
      id: `tail${sfx}`, total: tailW + 6 + t(24), active: [tailW + 1, tailW + 6], box: box(-170, 170, 70, 0, 160),
      damage: 28, hitstun: 18, stop: 5, push: toFp(14), launch: toFp(12), lift: toFp(12),
      cancel: 0, armor: [1, tailW + 6],
    },
    {
      id: `soar${sfx}`, total: t(18), active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, then: `soarAir${sfx}`, armor: [1, t(18)],
    },
    {
      id: `soarAir${sfx}`, total: 90, active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, air: true, hop: { back: 0, up: toFp(50) }, leap: toFp(36), land: `soarLand${sfx}`, armor: [1, 90],
    },
    {
      id: `soarLand${sfx}`, total: t(46), active: [1, 3], box: box(-120, 120, 60, 0, 160),
      damage: 40, hitstun: 20, stop: 5, push: toFp(14), launch: toFp(18), lift: toFp(12),
      cancel: 0, armor: [1, 3],
    },
    { ...fan(`fan${sfx}`, `fan2${sfx}`), total: t(26), fire: { at: t(20), shot: 'feather', x: toFp(70), z: toFp(90) }, armor: [1, t(20)] },
    fan(`fan2${sfx}`, `fan3${sfx}`),
    { ...fan(`fan3${sfx}`), total: t(40) },
  ];
}

/** The woodcutter's moves, windups and recoveries at `pct` percent: an axe hack in front that
 * knocks down; a sweep, the axe swung flat back and forth three times as it wades in, wide in
 * depth and behind it too (backing off or dodging out of it is the answer, not a step aside); a rush along its lane, low enough to jump; and a crouch and a leap that comes down
 * axe first on the hero (no shockwave: that is the chief's). */
function woodMoves(sfx: string, pct: number): Move[] {
  const t = (n: number) => Math.trunc((n * pct) / 100);
  const hackW = t(26);
  const sweepW = t(22);
  const swings = 26;
  const rushW = t(22);
  const dash = 26;
  return [
    {
      id: `hack${sfx}`, total: hackW + 4 + t(26), active: [hackW + 1, hackW + 4], box: box(0, 240, 55, 0, 260),
      damage: 55, hitstun: 22, stop: 6, push: toFp(12), launch: toFp(14), lift: toFp(12),
      cancel: 0, advance: { from: hackW - 2, to: hackW + 2, speed: toFp(5) }, armor: [1, hackW + 4],
    },
    {
      id: `sweep${sfx}`, total: sweepW + swings + t(26), active: [sweepW + 1, sweepW + swings], box: box(-90, 220, 80, 0, 200),
      damage: 15, hitstun: 12, stop: 4, push: toFp(10), launch: 0, lift: toFp(8),
      cancel: 0, rehit: 9, advance: { from: sweepW + 1, to: sweepW + swings, speed: toFp(5) }, armor: [1, sweepW + swings],
    },
    {
      id: `rush${sfx}`, total: rushW + dash + t(26), active: [rushW + 1, rushW + dash], box: box(-20, 110, 40, 0, 80),
      damage: 40, hitstun: 20, stop: 4, push: toFp(18), launch: toFp(16), lift: toFp(12),
      cancel: 0, advance: { from: rushW + 1, to: rushW + dash, speed: toFp(26) }, armor: [1, rushW + dash],
    },
    {
      id: `leap${sfx}`, total: t(22), active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, then: `leapAir${sfx}`, armor: [1, t(22)],
    },
    {
      id: `leapAir${sfx}`, total: 90, active: [0, -1],
      damage: 0, hitstun: 0, stop: 0, push: 0, launch: 0, lift: 0,
      cancel: 0, air: true, hop: { back: 0, up: toFp(32) }, leap: toFp(26), land: `leapLand${sfx}`, armor: [1, 90],
    },
    {
      id: `leapLand${sfx}`, total: t(30), active: [1, 2], box: box(-130, 130, 65, 0, 180),
      damage: 45, hitstun: 20, stop: 5, push: toFp(14), launch: toFp(16), lift: toFp(12),
      cancel: 0, armor: [1, 2],
    },
  ];
}

export const MOVES: Readonly<Record<string, Move>> = Object.fromEntries(MOVE_LIST.map((m) => [m.id, m]));

export type ShotKind = 'arrow' | 'wave' | 'quake' | 'hook' | 'feather';

/** A projectile: flies straight along x at `speed`, hits what its box touches (`box` is around
 * its own position, x forward of its flight), and is gone after `life` ticks, `pierce` hits or
 * the room's wall. */
export interface Shot extends HitData {
  speed: number;
  life: number;
  pierce: number;
  box: HitBox;
  /** Reels in what it hits (see INK.tow). */
  tow?: boolean;
}

export const SHOTS: Readonly<Record<ShotKind, Shot>> = {
  // thin in depth and height: stepping out of its lane, or jumping, dodges it
  arrow: {
    speed: toFp(24), life: ticks(2.2), pierce: 1, box: box(-30, 30, 18, -8, 8),
    damage: 20, hitstun: 14, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
  },
  // the phantom dance's sword wave: tall and wide, through everything in its way
  wave: {
    speed: toFp(32), life: ticks(0.9), pierce: 20, box: box(-50, 50, 60, 0, 240),
    damage: 160, hitstun: 26, stop: 5, push: toFp(18), launch: toFp(24), lift: toFp(22), breaks: true,
  },
  // the chief's shockwave, running along the floor from where it lands: low, so a jump clears it
  quake: {
    speed: toFp(20), life: ticks(0.6), pierce: 1, box: box(-40, 40, 100, 0, 45),
    damage: 45, hitstun: 18, stop: 4, push: toFp(12), launch: toFp(14), lift: toFp(10),
  },
  // the fisher's hook: thin like the arrow, a light blow, no push away (it pulls)
  hook: {
    speed: toFp(26), life: ticks(1.1), pierce: 1, box: box(-30, 30, 18, -10, 10),
    damage: 12, hitstun: 12, stop: 3, push: 0, launch: 0, lift: toFp(6), tow: true,
  },
  // the pheasant's tail feather: an arrow's lane, a bit wider and taller, so a jump does not clear it
  feather: {
    speed: toFp(22), life: ticks(1.6), pierce: 1, box: box(-40, 40, 24, -90, 40),
    damage: 18, hitstun: 12, stop: 3, push: toFp(6), launch: 0, lift: toFp(8),
  },
};

export type SkillId = 'triple' | 'dragon' | 'upper' | 'crush' | 'iai' | 'phantom';

/** What a skill gains from level `lv` on: a cut from its cooldown in percent, or super armour
 * for its first `armor` ticks. */
export interface Perk {
  lv: number;
  cdPct?: number;
  armor?: number;
}

/** A skill the hero can carry in any slot: the move it starts with, its cooldown from that
 * start, and what it gains at a level. */
export interface Skill {
  move: string;
  cooldown: number;
  perk: Perk;
}

export const SKILLS: Readonly<Record<SkillId, Skill>> = {
  triple: { move: 'tri1', cooldown: ticks(4), perk: { lv: 6, cdPct: 20 } },
  // through all four dashes
  dragon: { move: 'dragon1', cooldown: ticks(7), perk: { lv: 6, armor: 47 } },
  upper: { move: 'upper', cooldown: ticks(2.5), perk: { lv: 6, cdPct: 30 } },
  crush: { move: 'crush1', cooldown: ticks(6), perk: { lv: 6, cdPct: 25 } },
  // while gathering, up to the cut
  iai: { move: 'iai', cooldown: ticks(8), perk: { lv: 6, armor: 16 } },
  phantom: { move: 'phantom', cooldown: ticks(20), perk: { lv: 6, cdPct: 25 } },
};

/** The highest level of a skill; each level past the first adds SKILL_DMG_PCT to its damage. */
export const MAX_SKILL_LV = 10;
export const SKILL_DMG_PCT = 8;

/** Skill slots a hero carries (the buttons SKILL1 .. SKILL6); its cooldowns are one per slot,
 * then the dodge's. */
export const SLOTS = 6;
export const DODGE = { slot: SLOTS, move: 'backstep', cooldown: ticks(1) };

/** The skill in each slot, null for an empty one. */
export type Loadout = readonly (SkillId | null)[];

/** The skill in each slot when the player has not chosen. */
export const DEFAULT_LOADOUT: Loadout = ['triple', 'upper', 'iai', 'phantom', null, null];

/** SLOTS entries, each a skill or empty, no skill twice: what the server accepts from a client. */
export function validLoadout(l: unknown): l is (SkillId | null)[] {
  if (!Array.isArray(l) || l.length !== SLOTS) return false;
  const ids = l.filter((id) => id !== null);
  return ids.every((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, id)) && new Set(ids).size === ids.length;
}

export interface Spawn {
  kind: MonsterKind;
  x: number;
  y: number;
  /** Lurks (behind a door, a fence) until a hero is this close in x (see INK); a flyer hides
   * (in the flowers) until then, or until its flock is startled. Negative: it is there to see and
   * to hit, perched or pecking at the ground, until a hero is -lurk close in x or it, or another of
   * the room's perched ones, is hit: that startles them all (see startle in mob.ts). */
  lurk?: number;
  /** Height it appears at (none: on the floor, or a flyer at its hover). */
  z?: number;
}

/** A raised floor: the top of a wall, a rock, a branch. Bodies stand on it over x0..x1 and depth
 * y0..y1 at height z (FP); they come up through it from below and land on it from above, walk off
 * its edges and fall, and a hero drops through it with DOWN + JUMP (systems/ground.ts). */
export interface Platform {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
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
  /** Lying on the floor as the room opens (until it is cleared). */
  items?: readonly { kind: ItemKind; x: number; y: number }[];
  /** The room clears only once a hero has walked this far along it (and its monsters are dead). */
  goal?: number;
  platforms?: readonly Platform[];
}

export interface Dungeon {
  rooms: readonly Room[];
  /** Clearing this room wins the run. */
  boss: number;
  /** For practice: the server gives no loot for clearing it. */
  practice?: boolean;
  /** Its monsters' health and damage in percent, on top of the tier (a crowded room plays fair
   * with weaker monsters). */
  scale?: { hpPct: number; dmgPct: number };
  /** What a clear is rated against (see rateRun): the time in ticks, the longest combo and the
   * hits taken that earn the top marks. */
  par: Par;
  /** For a tutorial: how many skill slots are open in each room, by index (none: all of them). */
  slots?: readonly number[];
}

export interface Par {
  ticks: number;
  combo: number;
  hits: number;
}

export type DungeonId = 'luobi' | 'jiangcun' | 'trial' | 'training' | 'heifeng' | 'hall' | 'horde' | 'screen' | 'pingfeng';

/** A room `width` wide; each spawn is a kind, x, y and, for a lurker, its lurk distance. */
function room(width: number, spawns: [MonsterKind, number, number, number?][], doors: [Side, number, number?][], endless = false): Room {
  return {
    width: toFp(width),
    spawns: spawns.map(([kind, x, y, lurk]) => (lurk === undefined ? { kind, x: toFp(x), y: toFp(y) } : { kind, x: toFp(x), y: toFp(y), lurk: toFp(lurk) })),
    doors: doors.map(([side, to, x]) => (x === undefined ? { side, to } : { side, to, x: toFp(x) })),
    endless,
  };
}

// pars for the rating: an S wants a clean, quick run with long combos. The bot, which plays
// safe, takes the fort in about 6 to 7 minutes with a longest combo of 15 to 35 and gets a B or an A
const PAR_TRIAL: Par = { ticks: ticks(60), combo: 20, hits: 3 };
const PAR_FORT: Par = { ticks: ticks(240), combo: 30, hits: 10 };
const PAR_HALL: Par = { ticks: ticks(90), combo: 20, hits: 4 };
const PAR_LUOBI: Par = { ticks: ticks(150), combo: 15, hits: 4 };
const PAR_JIANGCUN: Par = { ticks: ticks(180), combo: 18, hits: 6 };
const PAR_PINGFENG: Par = { ticks: ticks(210), combo: 18, hits: 8 };

export const DUNGEONS: Record<DungeonId, Dungeon> = {
  // 1-1 "落笔", the tutorial (design/CHAPTER1.md), one thing taught a room:
  //   0 blank paper (move, jump) > 1 river village (attack, combo) > 2 village gate (dodge, potion)
  //   > 3 threshing floor (the first skill; the woodcutter)
  luobi: {
    rooms: [
      room(2000, [], [['right', 1]]),
      room(2400, [['inkling', 1000, 120], ['inkling', 1250, 260], ['inkling', 1500, 170]], [['left', 0], ['right', 2]]),
      {
        ...room(2600, [['inkling', 1000, 90], ['inkling', 1200, 270], ['brute', 1600, 180], ['inkling', 1950, 60], ['inkling', 2100, 250]], [['left', 1], ['right', 3]]),
        items: [{ kind: 'potion', x: toFp(700), y: toFp(250) }],
      },
      room(2200, [['woodcutter', 1500, 180]], [['left', 2]]),
    ],
    boss: 3,
    slots: [0, 0, 0, 1],
    par: PAR_LUOBI,
  },
  // 1-2 "江村", the ink villagers mixed: 0 village road (two lurk behind doors) > 1 stream bridge
  // (the fisher's hook) > 2 river bank (the washerwoman's ink) > 3 threshing floor (two woodcutters
  // and a washerwoman) > 4 the hall, no fight: walking up to the folding screen ends the section
  jiangcun: {
    rooms: [
      room(2400, [['inkling', 1000, 110], ['inkling', 1250, 270], ['inkling', 1750, 50, 320], ['inkling', 2050, 300, 320]], [['right', 1]]),
      room(2400, [['inkling', 950, 200], ['inkling', 1150, 80], ['inkling', 1350, 300], ['fisher', 1900, 120]], [['left', 0], ['right', 2]]),
      room(2400, [['inkling', 950, 110], ['inkling', 1150, 280], ['inkling', 1400, 180], ['washer', 1950, 200]], [['left', 1], ['right', 3]]),
      room(2600, [['hewer', 1200, 110], ['hewer', 1600, 270], ['washer', 2200, 180]], [['left', 2], ['right', 4]]),
      { ...room(1800, [], [['left', 3]]), goal: toFp(1400) },
    ],
    boss: 4,
    slots: [1, 1, 1, 1, 1],
    par: PAR_JIANGCUN,
  },
  // 1-3 "屏风里", inside the painted screen, birds and flowers: 0 flowering branch (the branch to
  // stand on, six finches start out of the blossom) > 1 lotus pond (pads to stand on; a flock, and
  // a lone finch perched on a pad: hit it, or come near, and the rest of the pond flies up)
  // > 2 bamboo and rock (eight finches, two big sparrows pecking at the ground; potions behind the
  // rocks) > 3 the golden pheasant, the elite. Clearing it is where the way out of the screen starts
  pingfeng: {
    rooms: [
      {
        ...room(2400, [], [['right', 1]]),
        spawns: [
          bird('finch', 900, 120, 160, 260), bird('finch', 1000, 230, 200, 260),
          bird('finch', 1400, 160, 260, 280), bird('finch', 1500, 260, 240, 280),
          bird('finch', 1900, 80, 200, 300), bird('finch', 2050, 200, 180, 300),
        ],
        platforms: [platform(600, 1250, 60, 200, 110), platform(1100, 1700, 140, 280, 210), platform(1650, 2150, 40, 180, 130)],
      },
      {
        ...room(2600, [], [['left', 0], ['right', 2]]),
        spawns: [
          bird('finch', 900, 120), bird('finch', 1050, 260), bird('finch', 1200, 80), bird('finch', 1350, 220),
          bird('finch', 1950, 230, 125, -260),
          // the rest of the pond, down among the lotus until the perched one is startled
          ...[1500, 1700, 2100, 2300, 2450].map((x, i) => bird('finch', x, [60, 300, 90, 280, 160][i], 30, 0.001)),
        ],
        // the leaves stand up out of the pond on their stems, as painted (lotus_perch), low enough
        // to jump onto from the floor
        platforms: [platform(480, 780, 40, 160, 95), platform(920, 1220, 190, 310, 120), platform(1380, 1680, 50, 190, 105), platform(1820, 2120, 170, 300, 125)],
      },
      {
        ...room(2600, [], [['left', 1], ['right', 3]]),
        spawns: [
          bird('finch', 900, 100), bird('finch', 1050, 240), bird('finch', 1200, 160), bird('finch', 1350, 300),
          bird('bigfinch', 1500, 120, 0, -420), bird('bigfinch', 1750, 260, 0, -420),
          bird('finch', 1900, 80, 120, 380), bird('finch', 2050, 220, 180, 380), bird('finch', 2250, 140, 140, 420), bird('finch', 2400, 280, 160, 420),
        ],
        platforms: [platform(650, 1000, 40, 140, 130), platform(1550, 1900, 30, 150, 150), platform(2150, 2450, 200, 320, 100)],
        items: [{ kind: 'potion', x: toFp(820), y: toFp(15) }, { kind: 'potion', x: toFp(1720), y: toFp(10) }],
      },
      {
        ...room(2200, [['pheasant', 1500, 180]], [['left', 2]]),
        platforms: [platform(500, 800, 30, 140, 110), platform(1700, 2000, 220, 320, 90)],
      },
    ],
    boss: 3,
    par: PAR_PINGFENG,
  },
  trial: {
    rooms: [
      room(2600, [['bandit', 1100, 120], ['bandit', 1300, 260], ['bandit', 1500, 60]], [['right', 1]]),
      room(2200, [['bandit', 900, 200], ['bandit', 1100, 80], ['bandit', 1300, 300], ['bandit', 1500, 160]], [['left', 0]]),
    ],
    boss: 1,
    par: PAR_TRIAL,
  },
  training: { rooms: [room(2400, [['dummy', 900, 180], ['dummy', 1300, 120]], [], true)], boss: 0, par: PAR_TRIAL },
  // Black Wind Fort (M2). The layout is final; bandits and archers in the first rooms as planned,
  // shield bearers from the gate on, the chief in the hall, an elite bandit alone in the side room:
  //   0 mountain road > 1 mountain road > 2 gate > 3 inner fort > 5 hall (boss)
  //                                         v
  //                                    4 side room (elite, optional)
  heifeng: {
    rooms: [
      room(2400, [['bandit', 1100, 140], ['archer', 1800, 240]], [['right', 1]]),
      room(2400, [['bandit', 1000, 100], ['bandit', 1200, 260], ['archer', 1800, 180], ['archer', 2000, 40]], [['left', 0], ['right', 2]]),
      room(2600, [['bandit', 1000, 200], ['shield', 1400, 120], ['archer', 2000, 280]], [['left', 1], ['right', 3], ['down', 4, 1300]]),
      room(2400, [['bandit', 900, 120], ['shield', 1200, 260], ['archer', 1700, 200], ['archer', 1900, 60]], [['left', 2], ['right', 5]]),
      room(1800, [['elite', 1100, 180]], [['up', 2, 900]]),
      room(2200, [['chief', 1500, 180]], [['left', 3]]),
    ],
    boss: 5,
    par: PAR_FORT,
  },
  // the fort's hall on its own, to practise on the chief (?dungeon=hall)
  hall: { rooms: [room(2200, [['chief', 1500, 180]], [])], boss: 0, practice: true, par: PAR_HALL },
  // the fort crowded (?dungeon=horde): a dozen and more to a room, a third of them archers, to see
  // how a full screen looks and runs; practice, so it gives nothing
  horde: {
    rooms: [
      room(2400, crowd(2400, [['bandit', 8], ['archer', 4]]), [['right', 1]]),
      room(2400, crowd(2400, [['bandit', 8], ['archer', 6]]), [['left', 0], ['right', 2]]),
      room(2600, crowd(2600, [['bandit', 6], ['shield', 3], ['archer', 5]]), [['left', 1], ['right', 3], ['down', 4, 1300]]),
      room(2400, crowd(2400, [['bandit', 6], ['shield', 4], ['archer', 6]]), [['left', 2], ['right', 5]]),
      room(1800, crowd(1800, [['elite', 1], ['bandit', 6]]), [['up', 2, 900]]),
      room(2200, crowd(2200, [['chief', 1], ['bandit', 4], ['archer', 4]]), [['left', 3]]),
    ],
    boss: 5,
    practice: true,
    // three to four times the fort's monsters to a room: each has a third of the health and hits a
    // third as hard; the bot then clears it on the normal tier with most of its health left
    scale: { hpPct: 35, dmgPct: 30 },
    par: PAR_FORT,
  },
  // inside the folding screen (1-3's mechanics, ?dungeon=screen): a low wall and a rock above it to
  // stand on, an inkling up on the wall, a finch flock overhead; practice, so it gives nothing
  screen: {
    rooms: [
      {
        ...room(2400, [], []),
        spawns: [
          { kind: 'inkling', x: toFp(1250), y: toFp(150), z: toFp(110) },
          ...[900, 1100, 1300, 1500, 1700, 1900].map((x, i) => ({ kind: 'finch' as const, x: toFp(x), y: toFp([120, 240, 160, 80, 280, 200][i]) })),
        ],
        platforms: [platform(700, 1500, 90, 210, 110), platform(1050, 1350, 110, 190, 220), platform(1800, 2100, 200, 320, 90)],
      },
    ],
    boss: 0,
    practice: true,
    par: PAR_TRIAL,
  },
};

/** A spawn at x, y, z (none: on the floor, or a flyer at its hover) with lurk distance `lurk`, in
 * world units. */
function bird(kind: MonsterKind, x: number, y: number, z?: number, lurk?: number): Spawn {
  return { kind, x: toFp(x), y: toFp(y), ...(z === undefined || z === 0 ? {} : { z: toFp(z) }), ...(lurk === undefined ? {} : { lurk: toFp(lurk) }) };
}

/** A platform over x0..x1 and depth y0..y1 at height z, in world units. */
function platform(x0: number, x1: number, y0: number, y1: number, z: number): Platform {
  return { x0: toFp(x0), x1: toFp(x1), y0: toFp(y0), y1: toFp(y1), z: toFp(z) };
}

/** `groups` of monsters spread over a room `width` wide, clear of the entry on the left: the first
 * in the middle, the rest in a scatter that steps through the depth so no two stand together. */
function crowd(width: number, groups: [MonsterKind, number][]): [MonsterKind, number, number][] {
  const out: [MonsterKind, number, number][] = [];
  const span = width - 900;
  let i = 0;
  for (const [kind, n] of groups) {
    for (let k = 0; k < n; k++, i++) {
      // archers keep to the back half of the room, where they shoot from
      const from = kind === 'archer' ? Math.floor(span / 2) : 0;
      const x = i === 0 ? 700 + Math.floor(span / 2) : 700 + from + ((i * 389) % (span - from));
      const y = 30 + ((i * 113) % 300);
      out.push([kind, x, y]);
    }
  }
  return out;
}

/** Where heroes stand when they come in through a left-wall door (or start the run). */
export const ENTRY = { x: toFp(160), y: toFp(180) };
/** A hero this close to a door's wall walks through it, once the room is clear. */
export const DOOR_ZONE = toFp(120);
/** Up and down doors: how far either side of the door's x it reaches, how close to the floor's
 * edge a hero must walk to go through, and how far in from the edge one coming through stands. */
export const DOOR_HALF = toFp(110);
export const DOOR_DEPTH = toFp(24);
export const DOOR_STEP = toFp(72);
