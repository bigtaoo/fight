import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DODGE, DUNGEONS, HERO, INK } from './content';
import { hashState } from './hash';
import { BTN } from './input';
import { toFp } from './math/fixed';
import { hittable } from './state';
import { spawnMonster } from './systems/affix';
import { hero, newRun, play } from './testUtil';

// 1-2, the river village: the fisher's hook reels the hero in (the dodge breaks free), the
// washerwoman's ink comes down where the hero stood and stays on the ground, villagers lie in
// wait until the hero comes near, and the bot walks the whole of it to the screen in the hall.

/** A run standing in luobi's blank first room (clear at once), with `kind` put down ahead of the hero. */
function facing(kind: 'fisher' | 'washer', ahead: number) {
  const e = newRun({ dungeon: 'luobi', seed: 1 });
  play(e, 2, () => 0);
  const h = hero(e.state);
  const m = spawnMonster(e.state, kind, h.x + toFp(ahead), h.y, false);
  return { e, h, m };
}

describe('jiangcun (1-2)', () => {
  it("the fisher's hook reels the hero in", () => {
    const { e, h, m } = facing('fisher', 600);
    play(e, 30 * 6, () => 0);
    // stopped short of the fisher, much nearer than it started
    expect(e.state.outcome).toBe('playing');
    expect(m.x - h.x).toBeLessThan(toFp(400));
    expect(m.x - h.x).toBeGreaterThanOrEqual(INK.tow.gap - toFp(30));
  });

  it('pulls toward the fisher while hooked, and a dodge breaks the pull', () => {
    const { e, h, m } = facing('fisher', 600);
    let x0 = 0;
    for (let i = 0; i < 30 * 6 && !(x0 && h.tow === INK.tow.ticks - 3); i++) {
      play(e, 1, () => 0);
      if (h.tow > 0 && !x0) x0 = h.x;
    }
    expect(x0).toBeGreaterThan(0);
    expect(h.x).toBeGreaterThan(x0);
    // the dodge, pressed while hooked: free at once, hopping back away from the fisher
    play(e, 1, () => BTN.DODGE);
    expect(h.tow).toBe(0);
    expect(h.state).toBe('act');
    expect(h.cd[DODGE.slot]).toBeGreaterThan(0);
    const gap = m.x - h.x;
    play(e, 8, () => 0);
    expect(m.x - h.x).toBeGreaterThan(gap);
  });

  it("the washerwoman's ink comes down where the hero stood and leaves a patch", () => {
    const { e, h } = facing('washer', 700);
    let lob = undefined as undefined | { tx: number; ty: number };
    let splash = undefined as undefined | { x: number; y: number };
    let stood = undefined as undefined | { tx: number; ty: number };
    for (let i = 0; i < 30 * 6 && !splash; i++) {
      const ev = play(e, 1, () => 0);
      if (!lob && e.state.lobs.length) {
        lob = { tx: e.state.lobs[0].tx, ty: e.state.lobs[0].ty };
        stood = { tx: h.x, ty: h.y };
      }
      for (const x of ev) if (x.type === 'splash') splash = { x: x.x, y: x.y };
    }
    expect(lob).toEqual(stood);
    expect(splash).toEqual({ x: lob!.tx, y: lob!.ty });
    expect(e.state.patches.length).toBe(1);
    expect(h.hp).toBeLessThan(h.maxHp);
  });

  it('the ink patch slows a walker and wears health down, but never kills', () => {
    const e = newRun({ dungeon: 'luobi', seed: 1 });
    play(e, 2, () => 0);
    const h = hero(e.state);
    e.state.patches.push({ id: e.state.nextId++, team: 1, x: h.x, y: h.y, life: 30 * 60 });
    play(e, 3, () => BTN.RIGHT);
    expect(h.x - h.px).toBe(Math.trunc((HERO.walkX * INK.patch.slowPct) / 100));
    h.hp = 30;
    const ev = play(e, 30 * 10, () => 0);
    expect(ev.some((x) => x.type === 'dot')).toBe(true);
    expect(h.hp).toBe(1);
    expect(h.state).not.toBe('dead');
  });

  it('lurkers cannot be hit until a hero comes near; then they spring out', () => {
    const e = newRun({ dungeon: 'jiangcun', seed: 1 });
    play(e, 1, () => 0);
    const lurkers = e.state.entities.filter((m) => m.lurk > 0);
    expect(lurkers.length).toBe(2);
    expect(lurkers.every((m) => !hittable(m))).toBe(true);
    const first = lurkers[0];
    const ev = play(e, 30 * 60, (s) => (first.lurk > 0 ? botButtons(s, 0) : 0));
    expect(first.lurk).toBe(0);
    expect(hittable(first) || first.state === 'act').toBe(true);
    expect(ev.some((x) => x.type === 'swing' && x.id === first.id && x.move === INK.pounce)).toBe(true);
  });

  it('the goal room ends the run only at the screen', () => {
    const d = DUNGEONS.jiangcun;
    const goal = d.rooms[d.boss];
    expect(goal.spawns.length).toBe(0);
    expect(goal.goal).toBeDefined();
  });

  it('the bot clears it, the same way every time', () => {
    for (const seed of [1, 2, 3]) {
      const run = () => {
        const e = newRun({ dungeon: 'jiangcun', seed });
        let rooms = 0;
        let hooked = false;
        const ev = play(e, 30 * 300, (s) => {
          if (hero(s).tow > 0) hooked = true;
          return botButtons(s, 0);
        });
        for (const x of ev) if (x.type === 'roomEnter') rooms++;
        return { outcome: e.state.outcome, rooms, tick: e.state.tick, hash: hashState(e.state), hooked, x: hero(e.state).x };
      };
      const a = run();
      expect(a.outcome, `seed ${seed}`).toBe('cleared');
      expect(a.rooms).toBe(DUNGEONS.jiangcun.rooms.length - 1);
      expect(a.x).toBeGreaterThanOrEqual(DUNGEONS.jiangcun.rooms[DUNGEONS.jiangcun.boss].goal!);
      expect(a.tick).toBeLessThan(30 * 240);
      expect(run()).toEqual(a);
    }
  });
});
