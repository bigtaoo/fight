// Everything the view (and the server's verifier) learns from a step, besides reading the state.

export type SimEvent =
  /** A move started (the view plays its swing sound and trail). */
  | { type: 'swing'; id: number; move: string }
  | { type: 'hit'; attacker: number; target: number; dmg: number; x: number; y: number; z: number; stop: number; launch: boolean }
  | { type: 'jump'; id: number }
  | { type: 'land'; id: number }
  /** A launched body hit the ground and lies down. */
  | { type: 'down'; id: number }
  | { type: 'death'; id: number }
  | { type: 'roomEnter'; room: number }
  /** Every monster of the room is dead; the door to the next room is open (unless it was the last). */
  | { type: 'roomClear'; room: number }
  /** The last room is clear: the run is won. The server grants the loot on this, from its own replay. */
  | { type: 'dungeonClear'; tick: number }
  | { type: 'heroDown'; id: number };
