import { describe, expect, it } from 'vitest';
import { botButtons } from './bot';
import { BODIES, DUNGEONS, TIERS, type HitData } from './content';
import type { SimEvent } from './events';
import { monsterDmgPct, monsterHpPct } from './state';
import { applyHit } from './systems/combat';
import { hero, newRun, play } from './testUtil';

// The crowded practice dungeon: its scale on top of the tier (a third of the health, a third of
// the damage), and that the bot still clears it on the normal tier.

const HIT: HitData = { damage: 100, hitstun: 10, stop: 3, push: 0, launch: 0, lift: 0 };

describe('horde', () => {
  it('scales monster health by the dungeon on top of the tier; other dungeons are untouched', () => {
    const scale = DUNGEONS.horde.scale!;
    for (const t of [0, 2]) {
      const e = newRun({ dungeon: 'horde', tier: t, seed: 1 });
      expect(monsterHpPct(e.state)).toBe(Math.trunc((TIERS[t].hpPct * scale.hpPct) / 100));
      const monsters = e.state.entities.filter((x) => x.team === 1);
      expect(monsters.length).toBeGreaterThanOrEqual(12);
      for (const m of monsters) {
        expect(m.maxHp).toBe(Math.trunc((BODIES[m.kind].hp * monsterHpPct(e.state)) / 100));
        expect(m.hp).toBe(m.maxHp);
      }
      // a third of the health the same kind has in the fort on the same tier
      const fort = newRun({ dungeon: 'heifeng', tier: t, seed: 1 });
      expect(monsterHpPct(fort.state)).toBe(TIERS[t].hpPct);
      const bandit = fort.state.entities.find((x) => x.kind === 'bandit')!;
      expect(bandit.maxHp).toBe(Math.trunc((BODIES.bandit.hp * TIERS[t].hpPct) / 100));
    }
    expect(monsterHpPct(newRun({ dungeon: 'horde', tier: 0 }).state)).toBe(35);
  });

  it('a monster hits about 30% as hard as in the fort, on the same roll', () => {
    const dealt = (dungeon: 'horde' | 'heifeng', tier: number) => {
      const e = newRun({ dungeon, tier, seed: 3 });
      e.state.entities = e.state.entities.filter((x) => x.team === 0);
      const h = hero(e.state);
      const ev: SimEvent[] = [];
      applyHit(e.state, ev, { id: 99, team: 1 }, 1, h, HIT);
      return { dmg: h.maxHp - h.hp, pct: monsterDmgPct(e.state) };
    };
    // the combat stream is untouched by spawning, so every run draws the same 90..110% roll: on
    // the fort's normal tier, where nothing scales, the damage dealt is that roll
    const roll = dealt('heifeng', 0).dmg;
    expect(roll).toBeGreaterThanOrEqual(90);
    expect(roll).toBeLessThanOrEqual(110);
    const expected = (pct: number) => Math.trunc((Math.trunc((HIT.damage * pct) / 100) * roll) / 100);
    for (const t of [0, 2]) {
      const fort = dealt('heifeng', t);
      const horde = dealt('horde', t);
      expect(fort.pct).toBe(TIERS[t].dmgPct);
      expect(horde.pct).toBe(Math.trunc((TIERS[t].dmgPct * DUNGEONS.horde.scale!.dmgPct) / 100));
      expect(fort.dmg).toBe(expected(fort.pct));
      expect(horde.dmg).toBe(expected(horde.pct));
      expect(horde.dmg / fort.dmg).toBeGreaterThan(0.25);
      expect(horde.dmg / fort.dmg).toBeLessThan(0.35);
    }
  });

  it('the bot clears it on the normal tier', () => {
    // seed 3 clears soonest of seeds 1-8 (about 14,200 ticks; most others take 15,500 to 19,700,
    // and two fall in the third room)
    const e = newRun({ dungeon: 'horde', tier: 0, seed: 3 });
    play(e, 30 * 900, (s) => botButtons(s, 0));
    expect(e.state.outcome).toBe('cleared');
    expect(e.state.tick).toBeLessThan(30 * 600);
  });
});
