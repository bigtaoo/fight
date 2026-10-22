import { DUNGEONS, HERO, MONSTERS, type Monster, type Platform } from '../content';
import { toFp } from '../math/fixed';
import { setState, type Entity, type SimState } from '../state';
import { pace } from './affix';

// Raised floors (Room.platforms). They are one-way: a body comes up through one from below and
// lands on it from above, so the floor under a body is the highest platform top at or below its
// feet that it stands over, else the floor itself (0). The state holds no "standing on" field:
// where a body stands follows from where it is, and a hero dropping through one steps just below
// its top. Rooms without platforms play exactly as before.

const NONE: readonly Platform[] = [];

export function platforms(s: SimState): readonly Platform[] {
  return s.room < 0 ? NONE : (DUNGEONS[s.config.dungeon].rooms[s.room].platforms ?? NONE);
}

/** The height of the floor under something at x, y with its feet at z. */
export function surfaceUnder(s: SimState, x: number, y: number, z: number): number {
  let top = 0;
  for (const p of platforms(s)) {
    if (p.z > top && p.z <= z && x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) top = p.z;
  }
  return top;
}

/** The height of the floor under `e`. */
export function groundOf(s: SimState, e: Entity): number {
  return surfaceUnder(s, e.x, e.y, e.z);
}

/** Whether `e` is off the floor under it (jumping, falling, launched, hovering). */
export function aloft(s: SimState, e: Entity): boolean {
  return e.z > groundOf(s, e);
}

/** A flyer under its own power: no gravity (a hit that launches it hands it back to gravity). */
export function flying(e: Entity): boolean {
  return e.kind !== 'hero' && MONSTERS[e.kind].fly !== undefined && (e.state === 'idle' || e.state === 'walk' || e.state === 'act');
}

/** A ground monster's hop up onto a platform: as high as the hero's jump, landing `inset` short
 * of the hero after `air` ticks (about the time the jump's arc takes). */
const HOP = { vz: HERO.jumpVz, reach: toFp(130), air: 18, inset: toFp(60) };

/** A melee or guard monster's way between floors, before its brain lines up a swing (a swing
 * from another floor would land on nothing): in the air, it keeps its speed; the hero standing on
 * a platform within reach above it and close by, it hops up; the hero below it, it walks off the
 * nearer edge toward the hero. True when this took the monster's tick. */
export function climb(s: SimState, m: Entity, def: Monster, t: Entity): boolean {
  if (def.brain !== 'melee' && def.brain !== 'guard') return false;
  const mg = groundOf(s, m);
  if (m.z > mg) return true;
  const tg = groundOf(s, t);
  if (t.z !== tg || tg === mg) return false;
  const dx = t.x - m.x;
  if (tg > mg) {
    if (tg - mg > HOP.reach || Math.abs(dx) > def.range * 2 || Math.abs(t.y - m.y) > def.alignY * 4) return false;
    const land = t.x - Math.sign(dx) * HOP.inset;
    m.vx = Math.trunc((land - m.x) / HOP.air);
    m.vy = Math.trunc((t.y - m.y) / HOP.air);
    m.vz = HOP.vz;
    if (dx !== 0) m.facing = Math.sign(dx);
    if (m.state !== 'walk') setState(m, 'walk');
    return true;
  }
  // the hero below: off the edge on its side (over the platform it stands on, the nearer edge)
  const p = platforms(s).find((q) => q.z === mg && m.x >= q.x0 && m.x <= q.x1 && m.y >= q.y0 && m.y <= q.y1);
  if (!p) return false;
  const under = t.x >= p.x0 && t.x <= p.x1 && t.y >= p.y0 && t.y <= p.y1;
  const dir = !under ? Math.sign(dx) || 1 : m.x - p.x0 < p.x1 - m.x ? -1 : 1;
  m.vx = dir * pace(m, def.walkX);
  m.vy = under || (t.y >= p.y0 && t.y <= p.y1) ? 0 : Math.sign(t.y - m.y) * def.walkY;
  if (dir !== 0) m.facing = dir;
  if (m.state !== 'walk') setState(m, 'walk');
  return true;
}
