import { ITEMS, PICKUP } from '../content';
import type { SimEvent } from '../events';
import type { SimState } from '../state';

// Items on the floor (see ITEMS): a hurt hero standing over one drinks it. A hero at full health
// walks over it, so it stays for when it is needed. Two heroes over the same item: the first in
// the entity list gets it.

export function itemsSystem(s: SimState, events: SimEvent[]): void {
  if (!s.items.length) return;
  for (const h of s.entities) {
    if (h.team !== 0 || h.hp <= 0 || h.hp >= h.maxHp) continue;
    const i = s.items.findIndex((it) => Math.abs(it.x - h.x) <= PICKUP.x && Math.abs(it.y - h.y) <= PICKUP.y);
    if (i < 0) continue;
    const it = s.items[i];
    s.items.splice(i, 1);
    const heal = Math.min(h.maxHp - h.hp, Math.trunc((h.maxHp * ITEMS[it.kind].heal) / 100));
    h.hp += heal;
    events.push({ type: 'pickup', id: h.id, item: it.id, kind: it.kind, heal });
  }
}
