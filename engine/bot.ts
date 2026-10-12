import { BODIES, DODGE, DUNGEONS, MONSTERS, MOVES, PICKUP, SHOTS, WORLD, type Door } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import type { Entity, SimState } from './state';
import { armored } from './systems/moves';

// A plain bot for tests and headless runs: lines up with the nearest monster in depth (a boss's
// summoned help before the boss), walks up to it and mashes attack, using the skills when they
// are ready (pressing on through a skill of several parts; the ultimate only with no archer
// about and no boss); steps out of every lane something is about to strike down (arrows,
// archers drawing, swings winding up, see laneDodge), cutting a swing short instead when it can
// strike first, and hops back untouchable when too late to step aside; walks round a shield held
// at it unless the slot 2 skill (both of which break guards) is ready; against a boss saves the
// skills for its openings and gets out of the way of its moves (see bossDodge); with the room
// clear it heads for the door on the shortest way to the boss. It only reads the state and
// returns buttons, like a player would, so its runs replay like any other.

const REACH = toFp(130);
const ALIGN = toFp(14);
/** How far behind a shield bearer the bot stands to hit its back. */
const BEHIND = toFp(100);
/** How far out of a shield bearer's lane the bot passes it. */
const SIDESTEP = toFp(80);

/** Walks to the nearest item on the floor when below `pct` percent health; 0: none to go for. */
function toPotion(s: SimState, hero: Entity, pct: number): number {
  if (!s.items.length || hero.hp * 100 >= hero.maxHp * pct) return 0;
  let best = s.items[0];
  for (const it of s.items) if (Math.abs(it.x - hero.x) < Math.abs(best.x - hero.x)) best = it;
  const dx = best.x - hero.x;
  const dy = best.y - hero.y;
  let b = 0;
  if (Math.abs(dx) > PICKUP.x / 2) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
  if (Math.abs(dy) > PICKUP.y / 2) b |= dy > 0 ? BTN.DOWN : BTN.UP;
  return b; // 0 only when already on it, and then it is drunk this tick
}

export function botButtons(s: SimState, owner: number): number {
  const slot = s.players.find((p) => p.owner === owner);
  const hero = slot && s.entities.find((e) => e.id === slot.hero);
  if (!hero || hero.hp <= 0) return 0;
  let target = undefined as (typeof s.entities)[number] | undefined;
  // the nearest monster, a boss's summoned help before the boss
  const rank = (e: Entity) => (e.kind !== 'hero' && MONSTERS[e.kind].boss ? 1 : 0);
  for (const e of s.entities) {
    if (e.team !== 1 || e.hp <= 0) continue;
    if (!target || rank(e) < rank(target) || (rank(e) === rank(target) && Math.abs(e.x - hero.x) < Math.abs(target.x - hero.x))) target = e;
  }
  // a potion on the floor: once the room is clear, if hurt at all; in a fight, if badly hurt
  const potion = toPotion(s, hero, target ? 40 : 100);
  if (!target) return potion || toDoor(s, hero);
  const dodge = laneDodge(s, hero) || bossDodge(s, hero);
  if (dodge) return dodge === HOLD ? 0 : dodge;
  if (potion) return potion;
  let b = 0;
  const dx = target.x - hero.x;
  const dy = target.y - hero.y;
  if (dy > ALIGN) b |= BTN.DOWN;
  else if (dy < -ALIGN) b |= BTN.UP;
  const shieldUp = target.kind !== 'hero' && !!MONSTERS[target.kind].guard && target.facing * dx < 0;
  if (shieldUp && hero.cd[1] !== 0) {
    // its shield is toward us and the guard breaker is not ready: go round behind it, out of
    // its lane while passing it (the bash only reaches along the lane)
    const goal = target.x - target.facing * BEHIND - hero.x;
    const side = target.y > WORLD.depth / 2 ? -SIDESTEP : SIDESTEP;
    const off = target.y + side - hero.y;
    b = Math.abs(off) > ALIGN ? (off > 0 ? BTN.DOWN : BTN.UP) : 0;
    const clear = Math.abs(hero.y - target.y) > SIDESTEP / 2 || Math.abs(dx) > REACH * 2;
    if (clear && Math.abs(goal) > ALIGN) b |= goal > 0 ? BTN.RIGHT : BTN.LEFT;
    return b;
  }
  if (Math.abs(dx) > REACH) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
  else if (Math.abs(dy) <= ALIGN * 2) {
    // face it, then strike; alternate the skills on a slow beat so the buffer sees presses
    if ((dx > 0) !== (hero.facing > 0)) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
    const chain = hero.state === 'act' && MOVES[hero.move].follow;
    const boss = target.kind !== 'hero' && !!MONSTERS[target.kind].boss;
    if (boss && armored(target)) {
      // a boss in its armour: plain cuts while it stands or walks, nothing while it winds up;
      // the skills wait for an opening
      if (target.state !== 'act') b |= BTN.ATTACK;
    } else if (boss && target.state === 'act') {
      // the recovery of a boss's move: quick skills only, the rising slash first to lift it
      if (chain) {
        if (s.tick % 4 === 0) b |= BTN.SKILL1;
      } else if (hero.cd[1] === 0 && s.tick % 6 === 0) b |= BTN.SKILL2;
      else if (hero.cd[0] === 0 && s.tick % 6 === 3) b |= BTN.SKILL1;
      else b |= BTN.ATTACK;
    } else if (shieldUp) {
      // only the slot 2 skill goes through the shield
      if (s.tick % 2 === 0) b |= BTN.SKILL2;
    } else if (chain) {
      if (s.tick % 4 === 0) b |= BTN.SKILL1;
    } else if (hero.cd[3] === 0 && s.tick % 12 === 0 && !boss && !s.entities.some((e) => e.hp > 0 && e.kind !== 'hero' && MONSTERS[e.kind].ranged)) b |= BTN.ULT;
    else if (hero.cd[2] === 0 && s.tick % 12 === 3) b |= BTN.SKILL3;
    else if (hero.cd[1] === 0 && s.tick % 12 === 6) b |= BTN.SKILL2;
    else if (hero.cd[0] === 0 && s.tick % 12 === 9) b |= BTN.SKILL1;
    else b |= BTN.ATTACK;
  }
  return b;
}

/** How far off in depth the hero's plain cut still lands. */
const CUT_DEPTH = MOVES.atk1.box!.depth - toFp(4);
/** How far out of a lane the bot steps: past the arrow's reach in depth, with a margin. */
const LANE = SHOTS.arrow.box.depth + toFp(16);
const SEEN = toFp(700);

/** UP or DOWN to the nearest depth out of every lane that something is about to strike down:
 * a shot coming at the hero, a monster drawing on it, a monster's swing winding up at it (unless
 * the hero is free and close enough to cut it first: a plain cut lands in 3 ticks and stuns, but
 * not through a shield). All at once, so stepping out of one lane never steps into another. */
function laneDodge(s: SimState, hero: Entity): number {
  const free = hero.state === 'idle' || hero.state === 'walk' || hero.state === 'run';
  const lanes: [number, number][] = [];
  let strike = 0;
  /** Something lands on the hero within three ticks. */
  let soon = false;
  for (const p of s.shots) {
    const dx = hero.x - p.x;
    if (p.team !== hero.team && p.kind !== 'quake' && Math.sign(dx) === Math.sign(p.vx) && Math.abs(dx) < SEEN) {
      lanes.push([p.y, LANE]);
      const box = SHOTS[p.kind].box;
      if (Math.abs(p.y - hero.y) <= box.depth && Math.abs(dx) < box.x1 + BODIES.hero.halfWidth + 3 * Math.abs(p.vx)) soon = true;
    }
  }
  for (const m of s.entities) {
    if (m.team === hero.team || m.state !== 'act' || m.hp <= 0 || m.kind === 'hero') continue;
    const mv = MOVES[m.move];
    const dx = hero.x - m.x;
    if (mv.fire && mv.fire.shot !== 'quake' && m.st < mv.fire.at && Math.sign(dx) === m.facing) lanes.push([m.y, LANE]);
    if (MONSTERS[m.kind].boss || !mv.box || m.st >= mv.active[0]) continue;
    const ahead = dx * m.facing;
    const reach = mv.box.x1 + (mv.advance ? (mv.advance.to - mv.advance.from) * mv.advance.speed : 0) + toFp(50);
    if (ahead < -toFp(40) || ahead > reach) continue;
    if (m.st >= mv.active[0] - 3 && Math.abs(hero.y - m.y) <= mv.box.depth) soon = true;
    if (!free) continue;
    if (!MONSTERS[m.kind].guard && Math.abs(dx) <= REACH && Math.abs(hero.y - m.y) <= CUT_DEPTH && m.st + 5 < mv.active[0]) {
      // facing it, the cut lands first
      strike = BTN.ATTACK | ((dx < 0) === (hero.facing < 0) ? (dx < 0 ? BTN.RIGHT : BTN.LEFT) : 0);
    } else lanes.push([m.y, mv.box.depth + toFp(20)]);
  }
  // too late to step aside: the dodge's untouchable hop, from a stand or out of a move's recovery
  const mv = hero.state === 'act' ? MOVES[hero.move] : undefined;
  const canDodge = hero.cd[DODGE.slot] === 0 && (free || (!!mv && mv.cancel > 0 && hero.st >= mv.cancel));
  if (soon && canDodge) return BTN.DODGE;
  const inside = (y: number) => lanes.some(([ly, w]) => Math.abs(y - ly) < w);
  if (!inside(hero.y)) return strike;
  let best: number | undefined;
  for (const [ly, w] of lanes) {
    for (const y of [ly - w - toFp(4), ly + w + toFp(4)]) {
      if (y < 0 || y > WORLD.depth || inside(y)) continue;
      if (best === undefined || Math.abs(y - hero.y) < Math.abs(best - hero.y)) best = y;
    }
  }
  if (best === undefined) return 0;
  return best < hero.y ? BTN.UP : BTN.DOWN;
}

/** Out of the way of a boss's move: out of the lane of a chop or a charge winding up (a hop back
 * as a chop comes down on it, a jump as a charge reaches it), well away from a slam, and over a
 * shockwave. */
function bossDodge(s: SimState, hero: Entity): number {
  for (const p of s.shots) {
    const dx = hero.x - p.x;
    if (p.kind === 'quake' && Math.sign(dx) === Math.sign(p.vx) && Math.abs(dx) < QUAKE_SEEN && Math.abs(p.y - hero.y) <= SHOTS.quake.box.depth + toFp(30)) return BTN.JUMP;
  }
  for (const m of s.entities) {
    if (m.kind === 'hero' || !MONSTERS[m.kind].boss || m.state !== 'act' || m.hp <= 0) continue;
    const mv = MOVES[m.move];
    const dx = hero.x - m.x;
    const ay = Math.abs(hero.y - m.y);
    const ahead = dx * m.facing;
    if (mv.box && mv.advance && m.st <= mv.active[1]) {
      // a chop or a charge: get out of its lane, which runs ahead of it
      const lane = mv.box.depth + toFp(24);
      const reach = mv.box.x1 + (mv.advance.to - Math.max(mv.advance.from, m.st)) * mv.advance.speed + toFp(40);
      if (ahead < -toFp(40) || ahead > reach || ay > lane) continue;
      const near = ahead < mv.box.x1 + toFp(60);
      if (near && m.st >= mv.active[0] - 4 && m.st < mv.active[0] && mv.advance.speed < toFp(10) && hero.cd[DODGE.slot] === 0 && (dx > 0) === (hero.facing < 0)) return BTN.DODGE;
      // (the jump clears a charge's height a few ticks after the press: go some five ticks early)
      if (m.st >= mv.active[0] && mv.advance.speed >= toFp(10) && ahead < mv.box.x1 + 6 * mv.advance.speed) return hero.z === 0 ? BTN.JUMP : HOLD;
      return away(hero, m.y, lane);
    }
    if (mv.then || mv.land) {
      // a slam on its way: far off in depth, and away from where it lands once it is in the air
      // (and once there, stands still rather than walk back in)
      const b = ay > SLAM_LANE ? HOLD : away(hero, m.y, SLAM_LANE);
      if (!mv.land) return b;
      let landX = m.x;
      let n = 0;
      for (let z = m.z, vz = m.vz; z > 0 && n < 60; n++) {
        vz -= WORLD.gravity;
        z += vz;
        landX += m.vx;
      }
      const off = hero.x - landX;
      // still under it as it comes down: the dodge's untouchable hop takes the blow and the shockwave
      const box = MOVES[mv.land].box;
      const under = box && Math.abs(off) < box.x1 + toFp(60) && ay < box.depth + toFp(30);
      if (under && n <= 1 && m.z > 0 && hero.cd[DODGE.slot] === 0) return BTN.DODGE;
      return Math.abs(off) > SLAM_ZONE ? b : b | (off >= 0 ? BTN.RIGHT : BTN.LEFT);
    }
  }
  return 0;
}

const QUAKE_SEEN = toFp(140);
const SLAM_LANE = SHOTS.quake.box.depth + toFp(20);
const SLAM_ZONE = toFp(260);
/** bossDodge's answer for standing still (and the bot's other plans waiting): no buttons. */
const HOLD = -1;

/** UP or DOWN, away from the lane at depth `y` (across it when the floor ends that way). */
function away(hero: Entity, y: number, lane: number): number {
  let up = hero.y < y || (hero.y === y && hero.y > WORLD.depth / 2);
  if (up && y - lane < 0) up = false;
  else if (!up && y + lane > WORLD.depth) up = true;
  return up ? BTN.UP : BTN.DOWN;
}

/** The first door on the shortest way from the current room to the boss room. */
function nextDoor(s: SimState): Door | undefined {
  const { rooms, boss } = DUNGEONS[s.config.dungeon];
  const firstDoor = new Map<number, Door>();
  const queue = [s.room];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    if (r === boss) return firstDoor.get(r);
    for (const d of rooms[r].doors) {
      if (seen.has(d.to)) continue;
      seen.add(d.to);
      firstDoor.set(d.to, firstDoor.get(r) ?? d);
      queue.push(d.to);
    }
  }
  return undefined;
}

function toDoor(s: SimState, hero: Entity): number {
  const d = nextDoor(s);
  if (!d || d.side === 'right') return BTN.RIGHT;
  if (d.side === 'left') return BTN.LEFT;
  const dx = (d.x ?? 0) - hero.x;
  const b = Math.abs(dx) > REACH / 2 ? (dx > 0 ? BTN.RIGHT : BTN.LEFT) : 0;
  return b | (d.side === 'up' ? BTN.UP : BTN.DOWN);
}
