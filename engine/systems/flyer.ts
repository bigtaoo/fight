import { MOVES, WORLD, type Fly, type Monster } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { randRange } from '../math/prng';
import { setState, type Entity, type SimState } from '../state';
import { pace, rest } from './affix';
import { groundOf } from './ground';
import { startMove } from './moves';

// The flyer brain (Monster.fly): a flock hovering at its height near the hero, each bird at its
// own spot beside it (spread by its id), out of reach of ground moves (their boxes top out below
// the hover; a launcher, a jump attack or a hero up on a platform reaches it). Once its cooldown is
// up and the hero is near, a bird flashes (windup), dives onto where the hero stood, and pecks on
// the ground for a moment: the opening for ground moves. Then it climbs again. At most
// FLOCK.divers of them dive at once. A hit in the air launches it like any airborne body, and
// gravity has it until it is up again (physics.ts, ground.ts: `flying`).

const FLOCK = {
  /** Birds diving (or flashing before it) at the same time, at most. */
  divers: 2,
  /** Each bird's spot: this far beside the hero in x (on its own side), scattered by its id. */
  side: toFp(110),
  scatterX: toFp(35),
  scatterY: toFp(40),
};

function nearestHero(s: SimState, m: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = 0;
  for (const e of s.entities) {
    if (e.team !== 0 || e.hp <= 0) continue;
    const d = Math.abs(e.x - m.x) + Math.abs(e.y - m.y);
    if (!best || d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** `d` stepped toward zero by at most `v`: the speed that closes a gap of `d` at `v` a tick. */
function toward(d: number, v: number): number {
  return Math.max(-v, Math.min(v, d));
}

function diving(s: SimState, def: Monster): number {
  const f = def.fly!;
  return s.entities.filter((e) => e.team === 1 && e.state === 'act' && (e.move === f.windup || e.move === f.dive)).length;
}

export function flyerControl(s: SimState, m: Entity, def: Monster, events: SimEvent[]): void {
  const f = def.fly!;
  if (m.state === 'act') return act(s, m, f, events);
  const t = nearestHero(s, m);
  if (!t) {
    m.vx = m.vy = 0;
    m.vz = toward(f.hover - m.z, f.climb);
    if (m.state !== 'idle') setState(m, 'idle');
    return;
  }
  const dx = t.x - m.x;
  if (dx !== 0) m.facing = Math.sign(dx);
  const near = Math.abs(dx) <= def.range && Math.abs(t.y - m.y) <= def.alignY;
  if (m.cd[0] === 0 && near && m.z >= f.hover - f.climb && diving(s, def) < FLOCK.divers) {
    m.vx = m.vy = m.vz = 0;
    startMove(m, f.windup, events);
    m.cd[0] = rest(m, randRange(s.rng, 'ai', def.cooldown[0], def.cooldown[1]));
    return;
  }
  const side = m.x >= t.x ? 1 : -1;
  const tx = t.x + side * FLOCK.side + (((m.id * 7) % 5) - 2) * FLOCK.scatterX;
  const ty = Math.min(Math.max(t.y + (((m.id * 3) % 5) - 2) * FLOCK.scatterY, 0), WORLD.depth);
  m.vx = toward(tx - m.x, pace(m, def.walkX));
  m.vy = toward(ty - m.y, def.walkY);
  m.vz = toward(f.hover - m.z, f.climb);
  const next = m.vx === 0 && m.vy === 0 ? 'idle' : 'walk';
  if (m.state !== next) setState(m, next);
}

/** A tick of the windup, the dive or the peck. */
function act(s: SimState, m: Entity, f: Fly, events: SimEvent[]): void {
  const total = MOVES[m.move].total;
  if (m.move === f.windup) {
    m.vx = m.vy = m.vz = 0;
    if (m.st < total) return;
    // aimed now, at where the hero stands (or the floor under it): there in diveTicks
    const t = nearestHero(s, m);
    startMove(m, f.dive, events);
    if (!t) return;
    const n = f.diveTicks;
    m.vx = Math.trunc((t.x - m.x) / n);
    m.vy = Math.trunc((t.y - m.y) / n);
    m.vz = -Math.max(f.climb, Math.trunc((m.z - groundOf(s, t)) / n) + 1);
    if (m.vx !== 0) m.facing = Math.sign(m.vx);
  } else if (m.move === f.dive) {
    if (m.z === groundOf(s, m)) {
      m.vx = m.vy = m.vz = 0;
      startMove(m, f.peck, events);
    } else if (m.st >= total) {
      setState(m, 'idle');
    } else if (m.st > f.diveTicks) {
      // overshot what it aimed at (the hero was on a platform it missed): straight down
      m.vx = m.vy = 0;
    }
  } else {
    m.vx = m.vy = m.vz = 0;
    if (m.st >= total) setState(m, 'idle');
  }
}
