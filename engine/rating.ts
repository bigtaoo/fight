import { DUNGEONS } from './content';
import type { SimState } from './state';

// The rating of a cleared run, from what the simulation counted on the way: the time, the
// longest combo and the hits taken, each held to the dungeon's par. A pure function of the
// state, so the server's replay rates the run the same as the client did; the rating it
// computes is the one the loot is drawn on.

export type Grade = 'S' | 'A' | 'B' | 'C';

export interface Rating {
  grade: Grade;
  /** Ticks from the start to the clear (or to now, while the run goes on). */
  ticks: number;
  maxCombo: number;
  hitsTaken: number;
}

export function rateRun(s: SimState): Rating {
  const par = DUNGEONS[s.config.dungeon].par;
  const maxCombo = Math.max(0, ...s.players.map((p) => p.maxCombo));
  const hitsTaken = s.players.reduce((n, p) => n + p.hitsTaken, 0);
  // up to two marks each: at par, or within half again of it (twice it for hits taken)
  const ticks = s.endTick || s.tick;
  const marks =
    (ticks <= par.ticks ? 2 : 2 * ticks <= 3 * par.ticks ? 1 : 0) +
    (maxCombo >= par.combo ? 2 : 2 * maxCombo >= par.combo ? 1 : 0) +
    (hitsTaken <= par.hits ? 2 : hitsTaken <= 2 * par.hits ? 1 : 0);
  const grade: Grade = marks >= 6 ? 'S' : marks >= 4 ? 'A' : marks >= 2 ? 'B' : 'C';
  return { grade, ticks, maxCombo, hitsTaken };
}
