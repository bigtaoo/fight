import { MOVES } from '@dnf/engine';

// The cuts, keyed by hand on top of whatever clip plays: Tripo's preset motions have no sword
// work, so each move is a wind-up pose and a follow-through pose, timed from the engine's own
// move data (wound up by the first active tick, through by the last, back to rest by the end).

/** Degrees. arm: the sword arm raised forward from hanging (180 = straight up, more = behind
 * the head); elbow: the forearm bent forward; lean: the chest pitched forward; twist: the
 * shoulders turned, positive bringing the sword side forward; off: the other arm raised forward. */
export interface Pose {
  arm: number;
  elbow: number;
  lean: number;
  twist: number;
  off: number;
}

export const REST: Pose = { arm: 0, elbow: 0, lean: 0, twist: 0, off: 0 };

type Cut = 'down' | 'side' | 'up' | 'thrust' | 'claw' | 'heavy' | 'ram';

const CUTS: Record<Cut, [wind: Pose, through: Pose]> = {
  // overhead, cutting down to the front
  down: [
    { arm: 200, elbow: 70, lean: -12, twist: -30, off: 40 },
    { arm: -5, elbow: 0, lean: 24, twist: 30, off: 15 },
  ],
  // a flat cut across the body
  side: [
    { arm: 95, elbow: 80, lean: 0, twist: -55, off: 50 },
    { arm: 45, elbow: 0, lean: 12, twist: 50, off: 10 },
  ],
  // low behind, cutting up over the head
  up: [
    { arm: -35, elbow: 15, lean: 18, twist: -25, off: 30 },
    { arm: 195, elbow: 10, lean: -18, twist: 25, off: 60 },
  ],
  // drawn back, then straight out
  thrust: [
    { arm: 70, elbow: 110, lean: -6, twist: -45, off: 60 },
    { arm: 50, elbow: 0, lean: 18, twist: 40, off: 20 },
  ],
  // the ink monsters, bare-handed: both hands reared up and back, then raked down in front
  claw: [
    { arm: 150, elbow: 60, lean: -14, twist: -20, off: 135 },
    { arm: 15, elbow: 10, lean: 28, twist: 25, off: 30 },
  ],
  // both arms high over the head and the chest thrown back, then brought down with the whole body:
  // the wind-up that has to read from across the room
  heavy: [
    { arm: 210, elbow: 45, lean: -24, twist: -10, off: 205 },
    { arm: 5, elbow: 0, lean: 38, twist: 15, off: 10 },
  ],
  // head down and arms swept back, a shoulder first
  ram: [
    { arm: -45, elbow: 25, lean: 34, twist: -20, off: -40 },
    { arm: -35, elbow: 15, lean: 42, twist: -10, off: -30 },
  ],
};

const CUT_OF: Record<string, Cut> = {
  atk1: 'down',
  atk2: 'side',
  atk3: 'down',
  jumpAtk: 'down',
  tri1: 'side',
  tri2: 'down',
  tri3: 'up',
  dragon1: 'side',
  dragon2: 'down',
  dragon3: 'side',
  dragon4: 'up',
  upper: 'up',
  crush1: 'down',
  crush2: 'up',
  iai: 'thrust',
  phantom: 'side',
  slash: 'down',
  bash: 'down',
  claw: 'claw',
  smash: 'heavy',
  hack: 'heavy',
  hackF: 'heavy',
  sweep: 'side',
  sweepF: 'side',
  rush: 'ram',
  rushF: 'ram',
  leapLand: 'heavy',
  leapLandF: 'heavy',
};

/** Moves a body may play from a clip of its own (art/model3d/moves.py, keyed a tick a frame): the
 * clip, its ticks at the move's marks (start, first active tick, end of the active ticks, end; or
 * start and end for a move that hits nothing), and, when given, the move's own ticks to use as the
 * marks instead. Each span of the move is stretched over the clip's, so the quicker second-phase
 * moves play the same clip faster and the strike still lands on the active ticks. */
const CLIP_OF: Record<string, [clip: string, ticks: number[], at?: number[]]> = {
  hack: ['chop', [0, 27, 31, 56]],
  hackF: ['chop', [0, 27, 31, 56]],
  sweep: ['sweep', [0, 23, 49, 74]],
  sweepF: ['sweep', [0, 23, 49, 74]],
  rush: ['rush', [0, 23, 49, 74]],
  rushF: ['rush', [0, 23, 49, 74]],
  leap: ['leap', [0, 22]],
  leapF: ['leap', [0, 22]],
  // the axe lifts as it rises, then is held overhead however long the fall
  leapAir: ['leap', [22, 32], [0, 10]],
  leapAirF: ['leap', [22, 32], [0, 10]],
  // lands with the chop's stroke
  leapLand: ['chop', [27, 29, 31, 56]],
  leapLandF: ['chop', [27, 29, 31, 56]],
  roar: ['roar', [0, 40]],
};

/** The clip of a body's own for `move` and the tick in it `st` ticks (fractional) in, or null. */
export function moveClip(move: string, st: number): { clip: string; tick: number } | null {
  const m = MOVES[move];
  const own = CLIP_OF[move];
  if (!m || !own) return null;
  const [clip, ticks, at] = own;
  const marks = at ?? (ticks.length === 4 ? [0, m.active[0], m.active[1] + 1, m.total] : [0, m.total]);
  if (st <= marks[0]) return { clip, tick: ticks[0] };
  for (let i = 1; i < marks.length; i++) {
    if (st < marks[i]) return { clip, tick: ticks[i - 1] + ((ticks[i] - ticks[i - 1]) * (st - marks[i - 1])) / (marks[i] - marks[i - 1]) };
  }
  return { clip, tick: ticks[ticks.length - 1] };
}

/** A wind-up held this many ticks or more trembles while it waits (the brute's raised arm). */
const TREMBLE = 8;

/** Smoothstep 0..1. */
function ease(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/** A fast start that settles: how a cut moves through its active ticks. */
function snap(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - (1 - k) * (1 - k) * (1 - k);
}

function mix(a: Pose, b: Pose, k: number, out: Pose): Pose {
  out.arm = a.arm + (b.arm - a.arm) * k;
  out.elbow = a.elbow + (b.elbow - a.elbow) * k;
  out.lean = a.lean + (b.lean - a.lean) * k;
  out.twist = a.twist + (b.twist - a.twist) * k;
  out.off = a.off + (b.off - a.off) * k;
  return out;
}

const _out: Pose = { ...REST };

/** Whether `st` is in or about `move`'s active ticks: when the blade leaves a trail. */
export function cutting(move: string, st: number): boolean {
  const m = MOVES[move];
  return !!m && !!CUT_OF[move] && m.active[1] >= m.active[0] && st >= m.active[0] && st <= m.active[1] + 1.5;
}

/** The pose `st` ticks (fractional) into `move`, or null for a move with no cut (a hop, a roar). */
export function cutPose(move: string, st: number): Pose | null {
  const m = MOVES[move];
  const cut = CUT_OF[move];
  if (!m || !cut || m.active[1] < m.active[0]) return null;
  const [wind, through] = CUTS[cut];
  const [a0, a1] = m.active;
  const end = a1 + 1;
  if (st < a0) {
    const reach = Math.max(1, a0 * 0.75);
    mix(REST, wind, ease(st / reach), _out);
    if (a0 - reach >= TREMBLE && st > reach) {
      const k = Math.sin(st * 2.6) * Math.min(1, (st - reach) / 4);
      _out.arm += k * 5;
      _out.off += k * 5;
      _out.lean -= Math.abs(k) * 3;
    }
    return _out;
  }
  if (st < end) {
    const span = end - a0;
    // a long active window is many cuts: back and forth every few ticks
    if (span > 8) {
      const per = 5;
      const i = Math.floor((st - a0) / per);
      const k = snap(((st - a0) % per) / (per * 0.6));
      return i % 2 === 0 ? mix(wind, through, k, _out) : mix(through, wind, k, _out);
    }
    return mix(wind, through, snap((st - a0) / span), _out);
  }
  // hold the follow-through a moment, then ease back to rest
  const rest = m.total - end;
  const k = ease((st - end - rest * 0.25) / Math.max(1, rest * 0.75));
  return mix(through, REST, k, _out);
}
