import { MOVES, SHOTS } from '../content';
import type { SimEvent } from '../events';
import { hittable, type Entity, type SimState } from '../state';
import { applyHit, overlaps } from './combat';

// Projectiles: fired on a tick of a move, then flying straight along x on their own, regardless
// of what happens to whoever fired them. They are not frozen by hitstop. Each target is hit at
// most once; a projectile is gone when its hits are spent, its life is up, or it reaches a wall.

/** Fires the projectile of a move whose firing tick this is (called after the body's step). */
export function fireSystem(s: SimState, events: SimEvent[]): void {
  for (const e of s.entities) {
    if (e.held || e.state !== 'act') continue;
    const f = MOVES[e.move].fire;
    if (!f || e.st !== f.at) continue;
    fire(s, e, e.facing, f.shot, f.x, f.z, events);
    if (f.twin) fire(s, e, -e.facing, f.shot, f.x, f.z, events);
  }
}

function fire(s: SimState, e: Entity, dir: number, kind: keyof typeof SHOTS, ahead: number, up: number, events: SimEvent[]): void {
  const def = SHOTS[kind];
  const x = e.x + dir * ahead;
  const z = e.z + up;
  const id = s.nextId++;
  s.shots.push({ id, kind, team: e.team, owner: e.id, x, y: e.y, z, px: x, py: e.y, pz: z, vx: dir * def.speed, life: def.life, pierce: def.pierce, hitList: [] });
  events.push({ type: 'fire', id, owner: e.id, shot: kind });
}

export function shotsSystem(s: SimState, events: SimEvent[]): void {
  for (const p of s.shots) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.x += p.vx;
    p.life--;
    const def = SHOTS[p.kind];
    const dir = Math.sign(p.vx);
    for (const t of s.entities) {
      if (p.pierce <= 0) break;
      if (t.team === p.team || !hittable(t) || p.hitList.includes(t.id)) continue;
      if (!overlaps(p, dir, def.box, t)) continue;
      p.hitList.push(t.id);
      p.pierce--;
      applyHit(s, events, { id: p.owner, team: p.team }, dir, t, def);
    }
  }
  s.shots = s.shots.filter((p) => p.pierce > 0 && p.life > 0 && p.x > 0 && p.x < s.roomWidth);
}
