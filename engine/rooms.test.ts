import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DUNGEONS, WORLD, type Side } from './content';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';

// The dungeon as a graph of rooms: every door has a twin back, the bot finds its way to the boss,
// a side room is entered and left through its up/down doors, and a cleared room stays empty.

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

  // (the bot does not beat the chief yet: its upgrade is M2 step 6)
  it('the bot takes the shortest way through Black Wind Fort to the boss', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 7 });
    const ev = play(e, 30 * 400, (s) => (s.room === 5 ? 0 : bot(s)));
    expect(ev.filter((x) => x.type === 'roomEnter').map((x) => x.type === 'roomEnter' && x.room)).toEqual([1, 2, 3, 5]);
    expect(e.state.cleared).toEqual([0, 1, 2, 3]);
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

  it('doors stay shut until the room is clear', () => {
    const e = newRun({ dungeon: 'heifeng', seed: 3 });
    hero(e.state).x = e.state.roomWidth;
    play(e, 30, () => BTN.RIGHT);
    expect(e.state.room).toBe(0);
  });
});
