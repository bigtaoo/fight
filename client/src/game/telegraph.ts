import { MOVES } from '@dnf/engine';

// Which monster moves are telegraphed: a slow wind-up (20 ticks or more before the blow, the shot
// or the lob), or one under super armour or leading into a second move. Quick jabs (the claw,
// the pecks) are read off the body alone, and so are the moves that follow on from another.

const cache = new Map<string, boolean>();
/** Moves that only follow another (a landing, a second swing): the first one already warned. */
const followUps = new Set(Object.values(MOVES).flatMap((m) => [m.then, m.land, m.next, m.follow].filter((x): x is string => !!x)));

/** True when a monster starting `move` should flash its warning. */
export function telegraphed(move: string): boolean {
  let t = cache.get(move);
  if (t === undefined) {
    const m = MOVES[move];
    if (!m || followUps.has(move)) t = false;
    else {
      const strikes = m.active[1] >= m.active[0] && m.damage > 0;
      const windup = m.fire?.at ?? m.lob?.at ?? (strikes ? m.active[0] : 0);
      t = (strikes || !!m.fire || !!m.lob || !!m.then) && (windup >= 20 || !!m.armor || !!m.then);
    }
    cache.set(move, t);
  }
  return t;
}
