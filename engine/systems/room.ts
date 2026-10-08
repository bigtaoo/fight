import { BODIES, DOOR_ZONE, DUNGEONS, ENTRY, WORLD, BANDIT } from '../content';
import type { SimEvent } from '../events';
import { toFp } from '../math/fixed';
import { randRange } from '../math/prng';
import { newEntity, setState, type SimState } from '../state';

// The dungeon: rooms open with their monsters, clear when every monster is dead, and a hero at
// the right wall of a cleared room walks into the next one. The last room cleared wins the run;
// every hero dead loses it.

export function enterRoom(s: SimState, index: number, events: SimEvent[]): void {
  const room = DUNGEONS[s.config.dungeon][index];
  s.room = index;
  s.roomWidth = room.width;
  s.roomCleared = false;
  s.entities = s.entities.filter((e) => e.team === 0);
  s.entities.forEach((e, i) => {
    e.x = e.px = ENTRY.x;
    e.y = e.py = ENTRY.y + i * toFp(60);
    e.z = e.pz = 0;
    e.vx = e.vy = e.vz = 0;
    e.facing = 1;
    if (e.hp > 0) setState(e, 'idle');
  });
  for (const sp of room.spawns) {
    const m = newEntity(s, sp.kind, 1, -1, sp.x, sp.y);
    m.cd[0] = randRange(s.rng, 'ai', BANDIT.firstCooldown[0], BANDIT.firstCooldown[1]);
  }
  events.push({ type: 'roomEnter', room: index });
}

export function roomSystem(s: SimState, events: SimEvent[]): void {
  if (s.outcome !== 'playing') return;
  const heroes = s.entities.filter((e) => e.team === 0);
  if (heroes.every((h) => h.state === 'dead')) {
    s.outcome = 'failed';
    return;
  }
  const rooms = DUNGEONS[s.config.dungeon];
  const room = rooms[s.room];
  const last = s.room === rooms.length - 1;
  if (!s.roomCleared && !room.endless && !s.entities.some((e) => e.team === 1 && e.hp > 0)) {
    s.roomCleared = true;
    events.push({ type: 'roomClear', room: s.room });
    if (last) {
      s.outcome = 'cleared';
      events.push({ type: 'dungeonClear', tick: s.tick });
    }
  }
  if (s.roomCleared && !last) {
    const wall = s.roomWidth - BODIES.hero.halfWidth - DOOR_ZONE;
    if (heroes.some((h) => h.hp > 0 && h.x >= wall)) enterRoom(s, s.room + 1, events);
  }
}

/** Dead monsters leave once they have faded. */
export function cleanup(s: SimState): void {
  s.entities = s.entities.filter((e) => !(e.team === 1 && e.state === 'dead' && e.st >= WORLD.fadeTicks));
}
