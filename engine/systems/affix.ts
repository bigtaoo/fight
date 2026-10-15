import { AFFIX, AFFIXES, BODIES, MONSTERS, TIERS, type Affix, type MonsterKind } from '../content';
import type { SimEvent } from '../events';
import { randInt, randRange } from '../math/prng';
import { newEntity, tierOf, type Entity, type SimState } from '../state';

// Difficulty tiers and the affixes monsters roll on them (design/CONTENT.md). A tier scales every
// monster's health as it spawns and its damage as it lands (combat.ts); an elite or a boss rolls
// the tier's count of distinct affixes, any other monster one by the tier's chance. Help a monster
// calls (a boss's second phase, the summon affix) rolls none. Nothing is drawn on the normal tier.

const bit = (a: Affix) => 1 << AFFIXES.indexOf(a);

export function hasAffix(e: Entity, a: Affix): boolean {
  return (e.affixes & bit(a)) !== 0;
}

export function dropAffix(e: Entity, a: Affix): void {
  e.affixes &= ~bit(a);
}

/** A monster of `kind` at x, y, scaled by the tier; `roll`: it rolls the tier's affixes. */
export function spawnMonster(s: SimState, kind: MonsterKind, x: number, y: number, roll: boolean): Entity {
  const m = newEntity(s, kind, 1, -1, x, y);
  const def = MONSTERS[kind];
  const tier = tierOf(s);
  if (!def.immortal) m.hp = m.maxHp = Math.trunc((m.maxHp * TIERS[tier].hpPct) / 100);
  if (roll && tier > 0 && !def.immortal) {
    const t = TIERS[tier];
    const n = def.elite || def.boss ? t.eliteAffixes : t.gruntPct > 0 && randInt(s.rng, 'affix', 100) < t.gruntPct ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const free = AFFIXES.filter((a) => !hasAffix(m, a));
      m.affixes |= bit(free[randInt(s.rng, 'affix', free.length)]);
    }
    if (hasAffix(m, 'ward')) m.ward = Math.trunc((m.maxHp * AFFIX.ward.pct) / 100);
    if (hasAffix(m, 'summon')) {
      m.summons = AFFIX.summon.times;
      m.summonCd = AFFIX.summon.every;
    }
  }
  if (def.firstCooldown) m.cd[0] = randRange(s.rng, 'ai', def.firstCooldown[0], def.firstCooldown[1]);
  return m;
}

/** A monster's walking speed or attack cooldown, quickened by frenzy. */
export function pace(m: Entity, v: number): number {
  return hasAffix(m, 'frenzy') ? Math.trunc((v * AFFIX.frenzy.walkPct) / 100) : v;
}

export function rest(m: Entity, ticks: number): number {
  return hasAffix(m, 'frenzy') ? Math.trunc((ticks * AFFIX.frenzy.cdPct) / 100) : ticks;
}

/** Summons and poison clouds, once a tick after the bodies have moved. */
export function affixSystem(s: SimState, events: SimEvent[]): void {
  const sm = AFFIX.summon;
  for (const m of s.entities) {
    if (m.team !== 1 || m.summons === 0 || m.held || m.hp <= 0 || m.state === 'dead') continue;
    if (m.summonCd > 0 && --m.summonCd > 0) continue;
    const standing = s.entities.filter((e) => e.team === 1 && e.hp > 0).length;
    if (standing + 2 > sm.max) continue;
    m.summons--;
    m.summonCd = sm.every;
    const hw = BODIES[sm.kind].halfWidth;
    for (const dir of [-1, 1]) {
      const x = Math.max(hw, Math.min(s.roomWidth - hw, m.x + dir * sm.dx));
      spawnMonster(s, sm.kind, x, m.y, false);
    }
    events.push({ type: 'affix', id: m.id, affix: 'summon' });
  }

  const mi = AFFIX.miasma;
  const dmg = Math.max(1, Math.trunc((mi.damage * TIERS[tierOf(s)].dmgPct) / 100));
  for (const c of s.clouds) {
    c.life--;
    if (c.life % mi.every !== 0) continue;
    for (const h of s.entities) {
      if (h.team !== 0 || h.hp <= 1 || h.state === 'dead') continue;
      if (Math.abs(h.x - c.x) > mi.x || Math.abs(h.y - c.y) > mi.y) continue;
      const d = Math.min(dmg, h.hp - 1);
      h.hp -= d;
      events.push({ type: 'dot', target: h.id, dmg: d, x: h.x, y: h.y, z: h.z });
    }
  }
  s.clouds = s.clouds.filter((c) => c.life > 0);
}
