import { DUNGEONS, MONSTERS, MOVES, SHOTS, WORLD, type Door } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import type { Entity, SimState } from './state';

// A plain bot for tests and headless runs: lines up with the nearest monster in depth, walks
// up to it and mashes attack, using the skills when they are ready; steps out of the lane of an
// arrow coming at it (or of an archer drawing on it); walks round a shield held at it unless the
// rising slash can break it; with the room clear it heads for the door
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
  const dodge = dodgeButtons(s, hero);
  if (dodge) return dodge;
  let b = 0;
  const dx = target.x - hero.x;
  const dy = target.y - hero.y;
  if (dy > ALIGN) b |= BTN.DOWN;
  else if (dy < -ALIGN) b |= BTN.UP;
  const shieldUp = target.kind !== 'hero' && !!MONSTERS[target.kind].guard && target.facing * dx < 0;
  if (shieldUp && hero.cd[0] !== 0) {
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
    if (shieldUp) {
      // only the rising slash goes through the shield
      if (s.tick % 2 === 0) b |= BTN.SKILL1;
    } else if (hero.cd[1] === 0 && s.tick % 12 === 0) b |= BTN.SKILL2;
    else if (hero.cd[0] === 0 && s.tick % 12 === 6) b |= BTN.SKILL1;
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
    if (p.team !== hero.team && Math.sign(dx) === Math.sign(p.vx) && Math.abs(dx) < SEEN && Math.abs(p.y - hero.y) < LANE) threat = p.y;
  }
  for (const m of s.entities) {
    if (m.team === hero.team || m.state !== 'act' || m.hp <= 0) continue;
    const f = MOVES[m.move].fire;
    const dx = hero.x - m.x;
    if (f && m.st < f.at && Math.sign(dx) === m.facing && Math.abs(m.y - hero.y) < LANE) threat = m.y;
  }
  if (threat === undefined) return 0;
  // step away from the lane, unless the floor ends that way: then across it
  let up = hero.y < threat || (hero.y === threat && hero.y > WORLD.depth / 2);
  if (up && threat - LANE < 0) up = false;
  else if (!up && threat + LANE > WORLD.depth) up = true;
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
