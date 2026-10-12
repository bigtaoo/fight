import { SHOTS, type MonsterKind } from './content';
import { Engine } from './Engine';
import { LocalInputSource } from './input';
import { toFp } from './math/fixed';
import { newEntity, runConfig, type SimState } from './state';

// The worst case the simulation is held to (M2's performance target): a screen of 12 monsters
// fighting the hero with 10 projectiles in the air. Only the scene; the timing is the caller's
// (engine/perf.test.ts in Node, ?bench in the browser), since the sim has no clock.

const CROWD: readonly MonsterKind[] = ['bandit', 'bandit', 'bandit', 'bandit', 'bandit', 'bandit', 'archer', 'archer', 'archer', 'shield', 'shield', 'shield'];
export const BENCH_SHOTS = 10;

/** A run in the fort's inner room with the crowd round the hero (in the middle of a screen). */
export function benchRun(seed = 1): Engine {
  const e = new Engine(runConfig({ dungeon: 'heifeng', seed }), new LocalInputSource());
  const s = e.state;
  s.entities = s.entities.filter((x) => x.team === 0);
  const hero = s.entities[0];
  hero.x = hero.px = toFp(1200);
  CROWD.forEach((kind, i) => {
    const side = i % 2 ? 1 : -1;
    newEntity(s, kind, 1, -1, hero.x + side * toFp(150 + 70 * (i >> 1)), toFp(40 + ((i * 53) % 280)));
  });
  return e;
}

/** Keeps the scene at its worst before a step: everybody back to full health (nobody dies, so
 * the crowd stays), and arrows topped up to BENCH_SHOTS, flying through the crowd. */
export function benchTopUp(s: SimState): void {
  for (const e of s.entities) if (e.state !== 'dead') e.hp = e.maxHp;
  const def = SHOTS.arrow;
  for (let i = s.shots.length; i < BENCH_SHOTS; i++) {
    const dir = i % 2 ? 1 : -1;
    const x = toFp(1200) - dir * toFp(700);
    const y = toFp(30 + ((s.tick * 37 + i * 61) % 300));
    const z = toFp(150);
    s.shots.push({ id: s.nextId++, kind: 'arrow', team: 1, owner: -1, x, y, z, px: x, py: y, pz: z, vx: dir * def.speed, life: def.life, pierce: def.pierce, hitList: [] });
  }
}
