import { BODIES, DOOR_DEPTH, DOOR_HALF, DOOR_STEP, DOOR_ZONE, DUNGEONS, ENTRY, HERO, WORLD, type Door, type Room, type Side } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { setState, type Entity, type SimState } from '../state';
import { spawnMonster } from './affix';

// The dungeon: a graph of rooms joined by doors. A room opens with its monsters and clears when
// every one is dead; then its doors open, and a hero walking into one takes everybody to the room
// behind it, coming in through that room's twin door. A cleared room stays empty when revisited.
// Clearing the boss room wins the run; every hero dead loses it.

const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', up: 'down', down: 'up' };

/** Moves the heroes into room `index`, through its door on side `via` ('left' at the start). */
export function enterRoom(s: SimState, index: number, events: SimEvent[], via: Side = 'left', from = -1): void {
  const room = DUNGEONS[s.config.dungeon].rooms[index];
  s.room = index;
  s.roomWidth = room.width;
  s.roomCleared = s.cleared.includes(index);
  s.entities = s.entities.filter((e) => e.team === 0);
  s.shots = [];
  s.items = [];
  s.clouds = [];
  const twin = room.doors.find((d) => d.side === via && d.to === from);
  s.entities.forEach((e, i) => {
    place(e, room, via, twin, i);
    e.z = e.pz = 0;
    e.vx = e.vy = e.vz = 0;
    if (e.hp > 0) setState(e, 'idle');
  });
  if (!s.roomCleared) {
    for (const sp of room.spawns) spawnMonster(s, sp.kind, sp.x, sp.y, true);
  }
  events.push({ type: 'roomEnter', room: index });
}

/** Where the i-th hero stands coming in through the door on side `via`. */
function place(e: Entity, room: Room, via: Side, twin: Door | undefined, i: number): void {
  const spread = i * toFp(60);
  const doorX = twin?.x ?? Math.trunc(room.width / 2);
  const [x, y, facing] =
    via === 'left' ? [ENTRY.x, ENTRY.y + spread, 1]
    : via === 'right' ? [room.width - ENTRY.x, ENTRY.y + spread, -1]
    : via === 'up' ? [doorX + spread, DOOR_STEP, 1]
    : [doorX + spread, WORLD.depth - DOOR_STEP, 1];
  e.x = e.px = x;
  e.y = e.py = y;
  e.facing = facing;
}

/** The door of `room` this hero stands in, if any. */
function doorAt(s: SimState, room: Room, h: Entity): Door | undefined {
  const hw = BODIES[h.kind].halfWidth;
  return room.doors.find((d) => {
    switch (d.side) {
      case 'left':
        return h.x <= hw + DOOR_ZONE;
      case 'right':
        return h.x >= s.roomWidth - hw - DOOR_ZONE;
      case 'up':
        return h.y <= DOOR_DEPTH && Math.abs(h.x - (d.x ?? 0)) <= DOOR_HALF;
      case 'down':
        return h.y >= WORLD.depth - DOOR_DEPTH && Math.abs(h.x - (d.x ?? 0)) <= DOOR_HALF;
    }
  });
}

export function roomSystem(s: SimState, events: SimEvent[]): void {
  if (s.outcome !== 'playing') return;
  const heroes = s.entities.filter((e) => e.team === 0);
  if (heroes.every((h) => h.state === 'dead')) {
    s.outcome = 'failed';
    s.endTick = s.tick;
    return;
  }
  const dungeon = DUNGEONS[s.config.dungeon];
  const room = dungeon.rooms[s.room];
  if (!s.roomCleared && !room.endless && !s.entities.some((e) => e.team === 1 && e.hp > 0)) {
    s.roomCleared = true;
    s.cleared.push(s.room);
    events.push({ type: 'roomClear', room: s.room });
    if (s.room === dungeon.boss) {
      s.outcome = 'cleared';
      s.endTick = s.tick;
      events.push({ type: 'dungeonClear', tick: s.tick });
      return;
    }
    for (const h of heroes) if (h.hp > 0) h.hp = Math.min(h.maxHp, h.hp + Math.trunc((h.maxHp * HERO.clearHeal) / 100));
  }
  if (!s.roomCleared) return;
  for (const h of heroes) {
    if (h.hp <= 0) continue;
    const door = doorAt(s, room, h);
    if (door) return enterRoom(s, door.to, events, OPPOSITE[door.side], s.room);
  }
}

/** Dead monsters leave once they have faded. */
export function cleanup(s: SimState): void {
  s.entities = s.entities.filter((e) => !(e.team === 1 && e.state === 'dead' && e.st >= WORLD.fadeTicks));
}
