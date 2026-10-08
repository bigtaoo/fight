import { BTN } from './input';
import { toFp } from './math/fixed';
import type { SimState } from './state';

// A plain bot for tests and headless runs: lines up with the nearest monster in depth, walks
// up to it and mashes attack, using the skills when they are ready. It only reads the state and
// returns buttons, like a player would, so its runs replay like any other.

const REACH = toFp(130);
const ALIGN = toFp(14);

export function botButtons(s: SimState, owner: number): number {
  const slot = s.players.find((p) => p.owner === owner);
  const hero = slot && s.entities.find((e) => e.id === slot.hero);
  if (!hero || hero.hp <= 0) return 0;
  let target = undefined as (typeof s.entities)[number] | undefined;
  for (const e of s.entities) {
    if (e.team !== 1 || e.hp <= 0) continue;
    if (!target || Math.abs(e.x - hero.x) < Math.abs(target.x - hero.x)) target = e;
  }
  // nothing left: walk to the door
  if (!target) return BTN.RIGHT;
  let b = 0;
  const dx = target.x - hero.x;
  const dy = target.y - hero.y;
  if (dy > ALIGN) b |= BTN.DOWN;
  else if (dy < -ALIGN) b |= BTN.UP;
  if (Math.abs(dx) > REACH) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
  else if (Math.abs(dy) <= ALIGN * 2) {
    // face it, then strike; alternate the skills on a slow beat so the buffer sees presses
    if ((dx > 0) !== (hero.facing > 0)) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
    if (hero.cd[1] === 0 && s.tick % 12 === 0) b |= BTN.SKILL2;
    else if (hero.cd[0] === 0 && s.tick % 12 === 6) b |= BTN.SKILL1;
    else b |= BTN.ATTACK;
  }
  return b;
}
