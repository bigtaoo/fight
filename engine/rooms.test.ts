import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DUNGEONS, WORLD, type Side } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';
import { enterRoom } from './systems/room';

// The dungeon as a graph of rooms: every door has a twin back, the bot finds its way to the boss,
// a side room is entered and left through its up/down doors (its elite is beatable), and a
// cleared room stays empty.

const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', up: 'down', down: 'up' };
const bot = (s: Parameters<typeof botButtons>[0]) => botButtons(s, 0);

/** Kills the room's monsters, so it clears on the next tick. */
function clearRoom(e: Engine): void {
  for (const m of e.state.entities) if (m.team === 1) m.hp = 0;
  play(e, 1, () => 0);
}

/** Holds `buttons` until the heroes are in room `to` (or 5 seconds pass). */
function walkInto(e: Engine, buttons: number, to: number): void {
  for (let i = 0; i < 30 * 5 && e.state.room !== to; i++) play(e, 1, () => buttons);
}

describe('rooms', () => {
  it('every door has a twin on the opposite side, and every room is reachable', () => {
    for (const [id, d] of Object.entries(DUNGEONS)) {
      d.rooms.forEach((r, i) => {
        for (const door of r.doors) {
          const back = d.rooms[door.to].doors.filter((t) => t.to === i && t.side === OPPOSITE[door.side]);
          expect(back, `${id} room ${i} ${door.side}`).toHaveLength(1);
          if (door.side === 'up' || door.side === 'down') expect(door.x, `${id} room ${i}`).toBeDefined();
        }
      });
      const seen = new Set([0]);
      for (const r of seen) for (const door of d.rooms[r].doors) seen.add(door.to);
      expect(seen.size, id).toBe(d.rooms.length);
    }
  });

  it('the bot takes the shortest way through Black Wind Fort and beats the chief', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 7 });
    const ev = play(e, 30 * 600, bot);
    expect(ev.filter((x) => x.type === 'roomEnter').map((x) => x.type === 'roomEnter' && x.room)).toEqual([1, 2, 3, 5]);
    expect(e.state.cleared).toEqual([0, 1, 2, 3, 5]);
    expect(e.state.outcome).toBe('cleared');
  });

  it('a side room is entered through the down door and left through its up door', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 3 });
    for (const r of [0, 1]) {
      clearRoom(e);
      hero(e.state).x = e.state.roomWidth;
      play(e, 1, () => 0);
      expect(e.state.room).toBe(r + 1);
    }
    clearRoom(e);
    const downDoor = DUNGEONS.heifeng.rooms[2].doors.find((d) => d.side === 'down')!;
    hero(e.state).x = downDoor.x!;
    walkInto(e, BTN.DOWN, 4);
    expect(e.state.room).toBe(4);
    const h = hero(e.state);
    expect(h.x).toBe(DUNGEONS.heifeng.rooms[4].doors[0].x);
    expect(h.y).toBeLessThan(toFp(100));

    clearRoom(e);
    walkInto(e, BTN.UP, 2);
    expect(e.state.room).toBe(2);
    expect(hero(e.state).x).toBe(downDoor.x);
    expect(hero(e.state).y).toBeGreaterThan(WORLD.depth - toFp(100));
    // the gate was cleared before: nobody is waiting there, and its doors are open
    expect(e.state.roomCleared).toBe(true);
    expect(e.state.entities.filter((x) => x.team === 1)).toHaveLength(0);
    expect(e.state.cleared).toEqual([0, 1, 2, 4]);
  });

  // a bandit takes the bot about 7 s on its own and never lands a hit; the elite about 24 s
  it("the side room's elite bandit is a longer fight than a bandit, but the bot wins it", () => {
    for (const seed of [1, 2, 3]) {
      const e = newRun({ dungeon: 'heifeng', seed });
      play(e, 1, () => 0);
      enterRoom(e.state, 4, [], 'up', 2);
      expect(e.state.entities.filter((x) => x.team === 1).map((x) => x.kind)).toEqual(['elite']);
      let t = 0;
      for (; t < 30 * 60 && !e.state.roomCleared && hero(e.state).hp > 0; t++) play(e, 1, bot);
      expect(e.state.roomCleared, `seed ${seed}`).toBe(true);
      expect(t, `seed ${seed}`).toBeGreaterThan(30 * 15);
    }
  });

  it('doors stay shut until the room is clear', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 3 });
    hero(e.state).x = e.state.roomWidth;
    play(e, 30, () => BTN.RIGHT);
    expect(e.state.room).toBe(0);
  });
});
