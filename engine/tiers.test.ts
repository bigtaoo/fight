import { describe, expect, it } from 'vitest';
import { AFFIX, AFFIXES, BODIES, MONSTERS, TIERS, type Affix, type HitData } from './content';
import type { SimEvent } from './events';
import { toFp } from './math/fixed';
import { newEntity, type Entity } from './state';
import { affixSystem, hasAffix, spawnMonster } from './systems/affix';
import { applyHit } from './systems/combat';
import { armored } from './systems/moves';
import { hero, newRun, play } from './testUtil';
import type { Engine } from './Engine';

// Difficulty tiers and elite affixes: health and damage scaling, how many affixes who rolls, and
// what each affix does.

const HIT: HitData = { damage: 100, hitstun: 10, stop: 3, push: 0, launch: 0, lift: 0 };
const HERO_SIDE = { id: 1, team: 0 };

/** A run of the trial at `tier`, with its first room's monsters gone. */
function bare(tier: number): Engine {
  const e = newRun({ dungeon: 'trial', tier });
  e.state.entities = e.state.entities.filter((x) => x.team === 0);
  return e;
}

/** A bandit with exactly `affixes`, standing in the room. */
function bandit(e: Engine, ...affixes: Affix[]): Entity {
  const m = spawnMonster(e.state, 'bandit', toFp(1200), toFp(180), false);
  for (const a of affixes) m.affixes |= 1 << AFFIXES.indexOf(a);
  if (affixes.includes('ward')) m.ward = Math.trunc((m.maxHp * AFFIX.ward.pct) / 100);
  if (affixes.includes('summon')) {
    m.summons = AFFIX.summon.times;
    m.summonCd = AFFIX.summon.every;
  }
  return m;
}

function count(m: Entity): number {
  return AFFIXES.filter((a) => hasAffix(m, a)).length;
}

describe('tiers', () => {
  it('scales monster health as they spawn and their damage as it lands', () => {
    for (let t = 0; t < TIERS.length; t++) {
      const e = newRun({ dungeon: 'trial', tier: t });
      const b = e.state.entities.find((x) => x.kind === 'bandit')!;
      expect(b.maxHp).toBe(Math.trunc((BODIES.bandit.hp * TIERS[t].hpPct) / 100));
    }
    const dealt = (tier: number) => {
      const e = bare(tier);
      const h = hero(e.state);
      const ev: SimEvent[] = [];
      applyHit(e.state, ev, { id: 99, team: 1 }, 1, h, HIT);
      return h.maxHp - h.hp;
    };
    // the same combat roll on every tier (the stream is untouched by spawning without affixes)
    expect(dealt(0)).toBeGreaterThanOrEqual(90);
    expect(dealt(0)).toBeLessThanOrEqual(110);
    expect(dealt(3)).toBeGreaterThanOrEqual(270);
    expect(dealt(3)).toBeLessThanOrEqual(330);
  });

  it('elites and bosses roll the tier\'s count of distinct affixes; grunts by its chance', () => {
    for (let t = 0; t < TIERS.length; t++) {
      for (let seed = 1; seed <= 20; seed++) {
        const e = newRun({ dungeon: 'hall', tier: t, seed });
        const chief = e.state.entities.find((x) => x.kind === 'chief')!;
        expect(count(chief)).toBe(TIERS[t].eliteAffixes);
        expect(count(spawnMonster(e.state, 'elite', toFp(900), toFp(180), true))).toBe(TIERS[t].eliteAffixes);
      }
    }
    let rolled = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const e = newRun({ dungeon: 'trial', tier: 3, seed });
      for (const b of e.state.entities.filter((x) => x.kind === 'bandit')) {
        expect(count(b)).toBeLessThanOrEqual(1);
        rolled += count(b);
      }
    }
    // 600 bandits at 25%
    expect(rolled).toBeGreaterThan(100);
    expect(rolled).toBeLessThan(200);
    for (let seed = 1; seed <= 50; seed++) {
      const e = newRun({ dungeon: 'trial', tier: 1, seed });
      expect(e.state.entities.every((x) => x.affixes === 0)).toBe(true);
    }
  });

  it('the normal tier draws nothing from the affix stream', () => {
    const e = newRun({ dungeon: 'hall', tier: 0 });
    const before = e.state.rng.affix;
    play(e, 300, () => 0);
    expect(e.state.rng.affix).toBe(before);
  });

  it('a ward takes the hits without a stun, then breaks', () => {
    const e = bare(1);
    const m = bandit(e, 'ward');
    const ev: SimEvent[] = [];
    let hits = 0;
    while (m.ward > 0) {
      applyHit(e.state, ev, HERO_SIDE, -1, m, HIT);
      hits++;
      expect(m.hp).toBe(m.maxHp);
      expect(m.state).not.toBe('hurt');
    }
    expect(hits).toBeGreaterThan(1);
    expect(ev.filter((x) => x.type === 'affix' && x.affix === 'ward')).toHaveLength(1);
    applyHit(e.state, ev, HERO_SIDE, -1, m, HIT);
    expect(m.hp).toBeLessThan(m.maxHp);
    expect(m.state).toBe('hurt');
  });

  it('revive: up once at half health from the blow that would kill', () => {
    const e = bare(1);
    const m = bandit(e, 'revive');
    const ev: SimEvent[] = [];
    m.hp = 1;
    applyHit(e.state, ev, HERO_SIDE, -1, m, HIT);
    expect(m.hp).toBe(Math.trunc(m.maxHp / 2));
    expect(hasAffix(m, 'revive')).toBe(false);
    expect(ev.some((x) => x.type === 'death')).toBe(false);
    m.hp = 1;
    applyHit(e.state, ev, HERO_SIDE, -1, m, HIT);
    expect(m.hp).toBeLessThanOrEqual(0);
    expect(ev.some((x) => x.type === 'death')).toBe(true);
  });

  it('miasma leaves a cloud that hurts heroes in it but never kills, and fades', () => {
    const e = bare(2);
    const s = e.state;
    const m = bandit(e, 'miasma');
    const h = hero(s);
    h.x = m.x;
    h.y = m.y;
    m.hp = 1;
    const ev: SimEvent[] = [];
    applyHit(s, ev, HERO_SIDE, -1, m, HIT);
    expect(s.clouds).toHaveLength(1);
    h.hp = 50;
    for (let i = 0; i < AFFIX.miasma.life; i++) affixSystem(s, ev);
    const dots = ev.filter((x) => x.type === 'dot');
    expect(dots.length).toBeGreaterThan(0);
    expect(h.hp).toBe(1);
    expect(s.clouds).toHaveLength(0);
  });

  it('summon calls two bandits on its timer, a limited number of times and never past the cap', () => {
    const e = bare(1);
    const s = e.state;
    const m = bandit(e, 'summon');
    const ev: SimEvent[] = [];
    for (let i = 0; i < AFFIX.summon.every - 1; i++) affixSystem(s, ev);
    expect(s.entities.filter((x) => x.team === 1)).toHaveLength(1);
    affixSystem(s, ev);
    const called = s.entities.filter((x) => x.team === 1 && x !== m);
    expect(called).toHaveLength(2);
    expect(called.every((x) => x.affixes === 0)).toBe(true);
    for (let i = 0; i < AFFIX.summon.every * 10; i++) affixSystem(s, ev);
    const standing = s.entities.filter((x) => x.team === 1).length;
    expect(standing).toBeLessThanOrEqual(AFFIX.summon.max);
    expect(ev.filter((x) => x.type === 'affix' && x.affix === 'summon').length).toBeLessThanOrEqual(AFFIX.summon.times);
  });

  it('ironclad: armoured on its feet; frenzy: quicker on its feet', () => {
    const e = bare(1);
    const iron = bandit(e, 'ironclad');
    expect(armored(iron)).toBe(true);
    const plain = newEntity(e.state, 'bandit', 1, -1, toFp(1000), toFp(180));
    expect(armored(plain)).toBe(MONSTERS.bandit.armor === true);
    const ev: SimEvent[] = [];
    applyHit(e.state, ev, HERO_SIDE, -1, iron, HIT);
    expect(iron.state).not.toBe('hurt');

    // a frenzied bandit closes on the hero sooner than a plain one
    const reach = (frenzy: boolean) => {
      const r = bare(1);
      const b = frenzy ? bandit(r, 'frenzy') : bandit(r);
      b.cd[0] = 1000;
      const x0 = b.x;
      play(r, 20, () => 0);
      return Math.abs(b.x - x0);
    };
    expect(reach(true)).toBeGreaterThan(reach(false));
  });
});
