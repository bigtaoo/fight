import { INK, MOVES } from '../content';
import type { SimEvent } from '../events';
import { entityById, hittable, monsterDmgPct, type Entity, type Lob, type SimState } from '../state';
import { applyHit } from './combat';

// 1-2's ink (INK in content.ts), once a tick after the projectiles are fired and before the bodies
// move: the fisher's hook reeling its catch in; the washerwoman's lobs, thrown at where the hero
// stands, flying their arc and coming down in a splash that leaves ink on the ground; and that ink,
// which hurts and slows a hero standing in it.

/** A hook hit `t`, now stunned: it is reeled in toward `by` (see INK.tow). */
export function reel(t: Entity, by: number): void {
  t.tow = INK.tow.ticks;
  t.towBy = by;
  t.timer = Math.max(t.timer, INK.tow.ticks + INK.tow.release);
}

export function inkSystem(s: SimState, events: SimEvent[]): void {
  for (const e of s.entities) {
    if (e.held || e.state !== 'act') continue;
    const l = MOVES[e.move].lob;
    if (l && e.st === l.at) throwLob(s, e, l.x, l.z, events);
  }
  flyLobs(s, events);
  patches(s, events);
  for (const e of s.entities) if (e.tow > 0 && !e.held) tow(s, e);
}

function nearestFoe(s: SimState, m: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = 0;
  for (const e of s.entities) {
    if (e.team === m.team || e.hp <= 0) continue;
    const d = Math.abs(e.x - m.x) + Math.abs(e.y - m.y);
    if (!best || d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** A lob from `ahead` in front of `e` and `up` above its feet, at where the nearest foe stands now. */
function throwLob(s: SimState, e: Entity, ahead: number, up: number, events: SimEvent[]): void {
  const t = nearestFoe(s, e);
  const x0 = e.x + e.facing * ahead;
  const z0 = e.z + up;
  const r = INK.lob.reach;
  const tx = t ? Math.max(0, Math.min(s.roomWidth, Math.max(x0 - r, Math.min(x0 + r, t.x)))) : x0 + e.facing * r;
  const ty = t ? t.y : e.y;
  const id = s.nextId++;
  s.lobs.push({ id, team: e.team, owner: e.id, x0, y0: e.y, z0, tx, ty, t: 0, x: x0, y: e.y, z: z0, px: x0, py: e.y, pz: z0 });
  events.push({ type: 'fire', id, owner: e.id, shot: 'lob' });
}

/** Where a lob is `t` ticks into its flight: straight across the floor, and up in a parabola from
 * its height at the throw (falling to 0 at the end) with `apex` added at the middle. */
function place(l: Lob): void {
  const T = INK.lob.flight;
  l.x = l.x0 + Math.trunc(((l.tx - l.x0) * l.t) / T);
  l.y = l.y0 + Math.trunc(((l.ty - l.y0) * l.t) / T);
  l.z = Math.trunc((l.z0 * (T - l.t)) / T) + Math.trunc((4 * INK.lob.apex * l.t * (T - l.t)) / (T * T));
}

function flyLobs(s: SimState, events: SimEvent[]): void {
  const lob = INK.lob;
  for (const l of s.lobs) {
    l.px = l.x;
    l.py = l.y;
    l.pz = l.z;
    l.t++;
    place(l);
    if (l.t < lob.flight) continue;
    // down: a splash on whoever is under it, then the ink on the ground
    const dir = l.tx >= l.x0 ? 1 : -1;
    for (const h of s.entities) {
      if (h.team === l.team || !hittable(h)) continue;
      if (Math.abs(h.x - l.tx) > lob.x || Math.abs(h.y - l.ty) > lob.y || h.z > lob.z) continue;
      applyHit(s, events, { id: l.owner, team: l.team }, dir, h, INK.splash);
    }
    s.patches.push({ id: s.nextId++, team: l.team, x: l.tx, y: l.ty, life: INK.patch.life });
    events.push({ type: 'splash', id: l.id, x: l.tx, y: l.ty });
  }
  s.lobs = s.lobs.filter((l) => l.t < lob.flight);
}

/** Ink on the ground: every so often it hurts each foe standing in it (never to death), and it
 * slows the walking of each one on its feet in it. */
function patches(s: SimState, events: SimEvent[]): void {
  const pa = INK.patch;
  const dmg = Math.max(1, Math.trunc((pa.damage * monsterDmgPct(s)) / 100));
  for (const c of s.patches) {
    c.life--;
    for (const h of s.entities) {
      if (h.team === c.team || h.hp <= 0 || h.state === 'dead' || h.z > 0) continue;
      if (Math.abs(h.x - c.x) > pa.x || Math.abs(h.y - c.y) > pa.y) continue;
      if (h.state === 'walk' || h.state === 'run') {
        h.vx = Math.trunc((h.vx * pa.slowPct) / 100);
        h.vy = Math.trunc((h.vy * pa.slowPct) / 100);
      }
      if (c.life % pa.every !== 0 || h.hp <= 1) continue;
      const d = Math.min(dmg, h.hp - 1);
      h.hp -= d;
      events.push({ type: 'dot', target: h.id, dmg: d, x: h.x, y: h.y, z: h.z });
    }
  }
  s.patches = s.patches.filter((c) => c.life > 0);
}

/** One tick of being reeled in: toward the one reeling, until close, or until either is knocked
 * out of it; the last tick lets go, and the stun ends shortly after. */
function tow(s: SimState, e: Entity): void {
  const t = INK.tow;
  const by = entityById(s, e.towBy);
  const reeling = !!by && by.hp > 0 && (by.state === 'act' || by.state === 'idle' || by.state === 'walk');
  const dx = by ? by.x - e.x : 0;
  if (e.state !== 'hurt' || !reeling || Math.abs(dx) <= t.gap || e.tow === 1) {
    e.tow = 0;
    if (e.state === 'hurt') {
      e.vx = 0;
      e.vy = 0;
      e.timer = Math.min(e.timer, t.release);
    }
    return;
  }
  e.tow--;
  e.vx = Math.sign(dx) * Math.min(t.speed, Math.abs(dx) - t.gap);
  const half = Math.trunc(t.speed / 2);
  e.vy = Math.max(-half, Math.min(half, by!.y - e.y));
}
