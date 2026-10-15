import type { Affix, ItemKind } from './content';

// Everything the view (and the server's verifier) learns from a step, besides reading the state.

export type SimEvent =
  /** A move started (the view plays its swing sound and trail). */
  | { type: 'swing'; id: number; move: string }
  /** `attacker` is the body that struck, or that fired the projectile; `dir` the way the hit went;
   * `blocked`: it landed on a shield (chip damage, no stun); `armor`: on super armour (full damage, no stun). */
  | { type: 'hit'; attacker: number; target: number; dmg: number; x: number; y: number; z: number; dir: number; stop: number; launch: boolean; blocked: boolean; armor: boolean; crit: boolean }
  /** A projectile was fired (`id` is the projectile's). */
  | { type: 'fire'; id: number; owner: number; shot: string }
  | { type: 'jump'; id: number }
  | { type: 'land'; id: number }
  /** A launched body hit the ground and lies down. */
  | { type: 'down'; id: number }
  /** A hero lying down got straight up (a quick rise). */
  | { type: 'rise'; id: number }
  | { type: 'death'; id: number }
  /** A monster's ward broke; a monster got up from its death (revive); a monster called help
   * (summon); a poison cloud rose where one died (miasma). */
  | { type: 'affix'; id: number; affix: Affix }
  /** Poison from a cloud: `dmg` off hero `target`, no stun. */
  | { type: 'dot'; target: number; dmg: number; x: number; y: number; z: number }
  /** A boss went into its next phase. */
  | { type: 'phase'; id: number; phase: number }
  | { type: 'roomEnter'; room: number }
  /** Every monster of the room is dead; the door to the next room is open (unless it was the last). */
  | { type: 'roomClear'; room: number }
  /** The last room is clear: the run is won. The server grants the loot on this, from its own replay. */
  | { type: 'dungeonClear'; tick: number }
  | { type: 'heroDown'; id: number }
  /** Hero `id` drank an item off the floor and got `heal` health back. */
  | { type: 'pickup'; id: number; item: number; kind: ItemKind; heal: number };
