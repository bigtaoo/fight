import { DODGE, DUNGEONS, MONSTERS, MOVES, SHOTS, WORLD, type Door } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import type { Entity, SimState } from './state';
import { armored } from './systems/moves';

// A plain bot for tests and headless runs: lines up with the nearest monster in depth, walks
// up to it and mashes attack, using the skills when they are ready (pressing on through a skill
// of several parts); steps out of the lane of an arrow coming at it (or of an archer drawing on
// it); walks round a shield held at it unless the slot 2 skill (both of which break guards) is
// ready; against a boss saves the skills for its openings and gets out of the way of its moves
// (see bossDodge); with the room clear it heads for the door
// on the shortest way to the boss. It only reads the state and returns buttons, like
// a player would, so its runs replay like any other.

const REACH = toFp(130);
const ALIGN = toFp(14);
/** How far behind a shield bearer the bot stands to hit its back. */
const BEHIND = toFp(100);
/** How far out of a shield bearer's lane the bot passes it. */
const SIDESTEP = toFp(80);

export function botButtons(s: SimState, owner: number): number {
  const slot = s.players.find((p) => p.owner === owner);
  const hero = slot && s.entities.find((e) => e.id === slot.hero);
  if (!hero || hero.hp <= 0) return 0;
  let target = undefined as (typeof s.entities)[number] | undefined;
  for (const e of s.entities) {
    if (e.team !== 1 || e.hp <= 0) continue;
    if (!target || Math.abs(e.x - hero.x) < Math.abs(target.x - hero.x)) target = e;
  }
  if (!target) return toDoor(s, hero);
  const dodge = dodgeButtons(s, hero) || bossDodge(s, hero);
  if (dodge) return dodge === HOLD ? 0 : dodge;
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
    } else if (hero.cd[3] === 0 && s.tick % 12 === 0) b |= BTN.ULT;
    else if (hero.cd[2] === 0 && s.tick % 12 === 3) b |= BTN.SKILL3;
    else if (hero.cd[1] === 0 && s.tick % 12 === 6) b |= BTN.SKILL2;
    else if (hero.cd[0] === 0 && s.tick % 12 === 9) b |= BTN.SKILL1;
    else b |= BTN.ATTACK;
  }
  return b;
}

/** How far out of a lane the bot steps: past the arrow's reach in depth, with a margin. */
const LANE = SHOTS.arrow.box.depth + toFp(16);
const SEEN = toFp(700);

/** UP or DOWN out of the lane of a shot coming at the hero, or of a monster about to shoot at it. */
function dodgeButtons(s: SimState, hero: Entity): number {
  let threat: number | undefined;
  for (const p of s.shots) {
    const dx = hero.x - p.x;
    if (p.team !== hero.team && p.kind !== 'quake' && Math.sign(dx) === Math.sign(p.vx) && Math.abs(dx) < SEEN && Math.abs(p.y - hero.y) < LANE) threat = p.y;
  }
  for (const m of s.entities) {
    if (m.team === hero.team || m.state !== 'act' || m.hp <= 0) continue;
    const f = MOVES[m.move].fire;
    const dx = hero.x - m.x;
    if (f && f.shot !== 'quake' && m.st < f.at && Math.sign(dx) === m.facing && Math.abs(m.y - hero.y) < LANE) threat = m.y;
  }
  return threat === undefined ? 0 : away(hero, threat, LANE);
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
      for (let z = m.z, vz = m.vz, n = 0; z > 0 && n < 60; n++) {
        vz -= WORLD.gravity;
        z += vz;
        landX += m.vx;
      }
      const off = hero.x - landX;
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
