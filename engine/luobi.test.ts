import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { DUNGEONS } from './content';
import { hashState } from './hash';
import { BTN } from './input';
import { openSlots } from './state';
import { hero, newRun, play } from './testUtil';

// 1-1, the tutorial: the blank first room opens at once, the gate room has its potion on the
// floor, skills open only for the boss, and the bot clears it the same way every time.

describe('luobi (1-1)', () => {
  it('opens on blank paper that is clear at once, with no skill to use yet', () => {
    const e = newRun({ dungeon: 'luobi', seed: 1 });
    play(e, 2, () => 0);
    expect(e.state.roomCleared).toBe(true);
    expect(openSlots(e.state)).toBe(0);
    // a skill press does nothing while the slots are shut
    play(e, 5, (_s, t) => (t % 2 ? BTN.SKILL1 : 0));
    expect(hero(e.state).state).toBe('idle');
  });

  it('the bot clears it, using the first skill only, and only at the boss', () => {
    // about two minutes on seeds 1-12, never near dying
    for (const seed of [1, 2, 3]) {
      const e = newRun({ dungeon: 'luobi', seed });
      const used = new Set<string>();
      let rooms = 0;
      const ev = play(e, 30 * 300, (s) => {
        const h = hero(s);
        if (h.state === 'act') used.add(`${s.room}:${h.move}`);
        return botButtons(s, 0);
      });
      for (const x of ev) if (x.type === 'roomEnter') rooms++;
      expect(e.state.outcome).toBe('cleared');
      expect(rooms).toBe(DUNGEONS.luobi.rooms.length - 1);
      expect(e.state.tick).toBeLessThan(30 * 180);
      expect(ev.some((x) => x.type === 'phase')).toBe(true);
      const skillRooms = [...used].filter((k) => /:(tri|upper|iai|phantom)/.test(k)).map((k) => Number(k.split(':')[0]));
      expect(skillRooms.every((r) => r === DUNGEONS.luobi.boss)).toBe(true);
      expect([...used].some((k) => k.startsWith('3:tri'))).toBe(true);
      expect([...used].some((k) => /:(upper|iai|phantom)/.test(k))).toBe(false);
    }
  });

  it('puts the potion on the gate room floor as it opens', () => {
    const e = newRun({ dungeon: 'luobi', seed: 1 });
    play(e, 30 * 120, (s) => (s.room === 2 ? 0 : botButtons(s, 0)));
    expect(e.state.room).toBe(2);
    expect(e.state.items.some((it) => it.kind === 'potion')).toBe(true);
  });

  it('runs the same twice from the same seed', () => {
    const run = () => {
      const e = newRun({ dungeon: 'luobi', seed: 7 });
      play(e, 30 * 300, (s) => botButtons(s, 0));
      return { tick: e.state.tick, hash: hashState(e.state), outcome: e.state.outcome };
    };
    expect(run()).toEqual(run());
  });
});
