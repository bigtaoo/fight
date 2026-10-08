import { BODIES, DUNGEONS, type DungeonId, type Kind, type ShotKind } from './content';
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
}

export function runConfig(over: Partial<RunConfig> = {}): RunConfig {
  return { seed: 1, dungeon: 'trial', players: 1, heroDamagePct: 100, ...over };
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
  /** Cooldown ticks left per skill slot (heroes) or until the next attack (monsters, slot 0). */
  cd: number[];
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
  players: PlayerSlot[];
  outcome: Outcome;
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
    players: [],
    outcome: 'playing',
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
    cd: [0, 0],
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

/** Alive and not lying down: something a hit can land on. */
export function hittable(e: Entity): boolean {
  return e.hp > 0 && e.state !== 'down' && e.state !== 'getup' && e.state !== 'dead';
}
