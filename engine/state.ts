import { BODIES, DEFAULT_LOADOUT, DODGE, DUNGEONS, MAX_SKILL_LV, SKILL_DMG_PCT, TIERS, type DungeonId, type ItemKind, type Kind, type Loadout, type MonsterKind, type ShotKind, type SkillId } from './content';
import { seedRng, type Rng } from './math/prng';

// The simulation state: plain data in ordered arrays, integers only (hash.ts throws on
// anything else). Being plain data is what makes a rollback snapshot a deep copy.

export interface RunConfig {
  seed: number;
  dungeon: DungeonId;
  /** Heroes, one per player. */
  players: number;
  /** Percentage applied to the heroes' damage. Always 100 in a real run; the client's
   * `?cheat=dmg` raises it locally to prove the server catches a tampered client. */
  heroDamagePct: number;
  /** The skill in each slot, for every hero (see validLoadout; the server checks it). */
  loadout: Loadout;
  /** Every hero's level of each skill, 1 when missing (as online, where the server keeps no
   * characters yet): a level adds SKILL_DMG_PCT to the skill's damage and from the skill's
   * perk level on gives it the perk. */
  skillLv: Readonly<Partial<Record<SkillId, number>>>;
  /** Every hero's stats: from the character's level and gear in single player, the base ones
   * online (the server does not keep characters yet). */
  hero: HeroStats;
  /** The difficulty tier, an index into TIERS (0 online: the server knows only the normal one). */
  tier: number;
}

/** What a character's level and gear come to in a fight. The engine knows only these numbers. */
export interface HeroStats {
  /** Health. */
  hp: number;
  /** Damage in percent of the moves' own (100: as written in content.ts). */
  atk: number;
  /** Chance in percent that a hit is critical, and a critical hit's damage in percent. */
  crit: number;
  critDmg: number;
  /** Percent cut from the skills' cooldowns (not the dodge's), at most MAX_CDR. */
  cdr: number;
}

export const BASE_HERO: HeroStats = { hp: BODIES.hero.hp, atk: 100, crit: 0, critDmg: 150, cdr: 0 };
export const MAX_CDR = 40;

export function runConfig(over: Partial<RunConfig> = {}): RunConfig {
  return { seed: 1, dungeon: 'trial', players: 1, heroDamagePct: 100, loadout: DEFAULT_LOADOUT, skillLv: {}, hero: BASE_HERO, tier: 0, ...over };
}

/** The run's tier, 0 .. TIERS.length - 1. */
export function tierOf(s: SimState): number {
  const t = s.config.tier ?? 0;
  return Number.isSafeInteger(t) ? Math.max(0, Math.min(TIERS.length - 1, t)) : 0;
}

/** The heroes' level of skill `id` in this run, 1 .. MAX_SKILL_LV. */
export function skillLevel(s: SimState, id: SkillId): number {
  const lv = s.config.skillLv[id] ?? 1;
  return Number.isSafeInteger(lv) ? Math.max(1, Math.min(MAX_SKILL_LV, lv)) : 1;
}

/** The damage of skill `id` in percent of its moves' own, by its level. */
export function skillDamagePct(s: SimState, id: SkillId): number {
  return 100 + SKILL_DMG_PCT * (skillLevel(s, id) - 1);
}

export type BodyState =
  | 'idle'
  | 'walk'
  | 'run'
  /** Airborne by its own jump. */
  | 'jump'
  /** Performing `move`. */
  | 'act'
  /** Stunned on the ground by a hit. */
  | 'hurt'
  /** Launched by a hit, falling. */
  | 'air'
  | 'down'
  | 'getup'
  | 'dead';

export interface Entity {
  id: number;
  kind: Kind;
  /** 0: heroes, 1: monsters. */
  team: number;
  /** The player steering it, -1 for monsters. */
  owner: number;
  /** Position: x along the room, y depth (0 back), z height above the floor. FP. */
  x: number;
  y: number;
  z: number;
  /** Position at the start of the last tick, so the view interpolates between ticks. */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  /** 1 facing right, -1 facing left. */
  facing: number;
  hp: number;
  maxHp: number;
  state: BodyState;
  /** Ticks spent in the current state (in the current move while acting). */
  st: number;
  /** The move being performed, '' when none. */
  move: string;
  /** Ids already hit by the current move (each target is hit once per move). */
  hitList: number[];
  /** Hitstop ticks left; a body with stop > 0 at the start of a tick is frozen for that tick. */
  stop: number;
  /** Frozen this tick (set at the start of every tick from `stop`). */
  held: boolean;
  /** Stun ticks left in 'hurt', lying ticks left in 'down' / 'getup'. */
  timer: number;
  /** Hits taken in the air since the last launch; each lifts less. */
  juggle: number;
  bounced: boolean;
  /** The air attack is spent until the hero lands. */
  airAtk: boolean;
  /** Cooldown ticks left per skill slot and the dodge (heroes), or until the next attack
   * (monsters, slot 0) and the next hop back (archers, slot 1). */
  cd: number[];
  /** Untouchable ticks left (a dodge, a quick rise). */
  inv: number;
  /** Super armour ticks left from a skill's perk, while the skill's moves last. */
  armor: number;
  /** Where the current move heads, from the stick as it started: aimX 1 forward, 0 not at all;
   * aimY -1 back, 1 front, 0 neither. Plain moves head forward. */
  aimX: number;
  aimY: number;
  /** A boss's phase: 0, then 1 once its second phase has started. */
  phase: number;
  /** A monster's affixes, a bit per AFFIXES entry; its ward left; summons left and the ticks to
   * the next. */
  affixes: number;
  ward: number;
  summons: number;
  summonCd: number;
}

/** A poison cloud left where a monster with miasma died. */
export interface Cloud {
  id: number;
  x: number;
  y: number;
  /** Ticks left. */
  life: number;
}

/** A projectile in flight (its definition is SHOTS[kind]). */
export interface Projectile {
  id: number;
  kind: ShotKind;
  team: number;
  /** The entity that fired it (it may be dead by now). */
  owner: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  /** Speed along x, FP per tick; its sign is the direction of flight. */
  vx: number;
  /** The skill whose move fired it, '' for none (its damage grows with the skill's level). */
  of: SkillId | '';
  /** Ticks to live, and hits left before it is spent. */
  life: number;
  pierce: number;
  hitList: number[];
}

/** Per-player input bookkeeping: the engine derives presses, double taps and the buffer. */
export interface PlayerSlot {
  owner: number;
  /** The hero entity's id. */
  hero: number;
  /** Buttons held this tick and on the previous one. */
  buttons: number;
  prev: number;
  /** Last direction tapped (BTN.LEFT / BTN.RIGHT) and on which tick, for double-tap runs. */
  tapDir: number;
  tapTick: number;
  running: boolean;
  /** The buffered press (one BTN bit, 0: none) and its unfrozen ticks left. */
  buf: number;
  bufLeft: number;
  /** The skill in each slot, null for an empty one. */
  skills: (SkillId | null)[];
  /** Hits landed in a row, each within WORLD.comboTicks of the last, and ticks before it lapses. */
  combo: number;
  comboLeft: number;
  /** The run's longest combo, and the hits the hero has taken (for the rating). */
  maxCombo: number;
  hitsTaken: number;
}

/** An item on the floor (see ITEMS), dropped on `tick`. */
export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  tick: number;
}

export type Outcome = 'playing' | 'cleared' | 'failed';

export interface SimState {
  config: RunConfig;
  tick: number;
  nextId: number;
  rng: Rng;
  /** The room the heroes are in, by index into the dungeon's rooms. */
  room: number;
  roomWidth: number;
  roomCleared: boolean;
  /** Rooms cleared so far, in the order they were; going back into one finds it empty. */
  cleared: number[];
  entities: Entity[];
  shots: Projectile[];
  /** Items lying on the floor of this room. */
  items: Item[];
  /** Poison clouds in this room. */
  clouds: Cloud[];
  players: PlayerSlot[];
  /** Monsters killed, by kind (the server draws their loot once the run is cleared). */
  kills: Partial<Record<MonsterKind, number>>;
  outcome: Outcome;
  /** The tick the run was won or lost on, 0 while it is being played (the simulation steps on
   * after it, for the view). */
  endTick: number;
}

export function createState(config: RunConfig): SimState {
  return {
    config,
    tick: 0,
    nextId: 1,
    rng: seedRng(config.seed),
    room: -1,
    roomWidth: DUNGEONS[config.dungeon].rooms[0].width,
    roomCleared: false,
    cleared: [],
    entities: [],
    shots: [],
    items: [],
    clouds: [],
    players: [],
    kills: {},
    outcome: 'playing',
    endTick: 0,
  };
}

export function newEntity(s: SimState, kind: Kind, team: number, owner: number, x: number, y: number): Entity {
  const body = BODIES[kind];
  const e: Entity = {
    id: s.nextId++, kind, team, owner,
    x, y, z: 0, px: x, py: y, pz: 0, vx: 0, vy: 0, vz: 0,
    facing: team === 0 ? 1 : -1,
    hp: body.hp, maxHp: body.hp,
    state: 'idle', st: 0, move: '', hitList: [],
    stop: 0, held: false, timer: 0, juggle: 0, bounced: false, airAtk: false,
    cd: team === 0 ? new Array<number>(DODGE.slot + 1).fill(0) : [0, 0],
    inv: 0, armor: 0, aimX: 1, aimY: 0, phase: 0, affixes: 0, ward: 0, summons: 0, summonCd: 0,
  };
  s.entities.push(e);
  return e;
}

export function entityById(s: SimState, id: number): Entity | undefined {
  return s.entities.find((e) => e.id === id);
}

export function setState(e: Entity, state: BodyState): void {
  e.state = state;
  e.st = 0;
  if (state !== 'act') e.move = '';
}

/** Alive, not lying down and not untouchable: something a hit can land on. */
export function hittable(e: Entity): boolean {
  return e.hp > 0 && e.inv === 0 && e.state !== 'down' && e.state !== 'getup' && e.state !== 'dead';
}
