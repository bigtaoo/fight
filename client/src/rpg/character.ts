import { BASE_HERO, MAX_CDR, MAX_SKILL_LV, validLoadout, type HeroStats, type SkillId } from '@dnf/engine';
import type { BagStore } from '../platform/store';
import { MAX_LEVEL, SLOTS, STATS, gearStats, parseGear, type Gear, type Slot, type Stats } from './gear';
import { defaultBar, isSkill } from './skills';

// The single-player character: level and experience, the gear worn in each slot, the bag, the
// purse (gold, enhancement stones, protection tickets), and the skills' levels and bar (skills.ts).
// Its stats are the level's plus the gear's; they go into the run's config (RunConfig.hero), the
// only way they reach the engine. Saved in the platform's store under a version number, so a
// later change of shape can take an old save over.

const KEY = 'dnf.char';
const VERSION = 1;
export const BAG_SIZE = 60;

/** Experience from level `lv` to the next. */
export function xpToNext(lv: number): number {
  return Math.round((100 * Math.pow(lv, 1.6)) / 10) * 10;
}

/** The stats of level `lv` with nothing worn: level 1 is the hero as the engine has it, plus a
 * little crit. */
export function levelStats(lv: number): Stats {
  return { atk: BASE_HERO.atk + 4 * (lv - 1), hp: BASE_HERO.hp + 50 * (lv - 1), crit: 5, critDmg: BASE_HERO.critDmg, cdr: 0 };
}

interface Save {
  v: number;
  level: number;
  xp: number;
  nextId: number;
  gold: number;
  stones: number;
  tickets: number;
  bag: Gear[];
  worn: Partial<Record<Slot, Gear>>;
  skillLv: Partial<Record<SkillId, number>>;
  bar: (SkillId | null)[];
}

export class Character {
  level = 1;
  xp = 0;
  private nextId = 1;
  gold = 0;
  stones = 0;
  tickets = 0;
  bag: Gear[] = [];
  worn: Partial<Record<Slot, Gear>> = {};
  /** Each skill's level past 1 (a missing one is at 1 once unlocked; see skills.ts). */
  skillLv: Partial<Record<SkillId, number>> = {};
  /** The skill in each slot of the bar. */
  bar: (SkillId | null)[] = defaultBar();

  constructor(private readonly store: BagStore) {
    this.load(store.get(KEY));
  }

  /** A fresh id for a new piece. */
  newId(): number {
    return this.nextId++;
  }

  stats(): Stats {
    const s = levelStats(this.level);
    for (const g of Object.values(this.worn)) {
      const add = gearStats(g);
      for (const k of STATS) s[k] += add[k] ?? 0;
    }
    return s;
  }

  /** The stats as the engine takes them. */
  heroStats(): HeroStats {
    const s = this.stats();
    return { hp: s.hp, atk: s.atk, crit: Math.min(100, s.crit), critDmg: s.critDmg, cdr: Math.min(MAX_CDR, s.cdr) };
  }

  /** Adds experience; the levels gained. */
  gainXp(n: number): number {
    const from = this.level;
    this.xp += n;
    while (this.level < MAX_LEVEL && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
    }
    if (this.level === MAX_LEVEL) this.xp = 0;
    return this.level - from;
  }

  /** Puts pieces in the bag as far as it has room; the ones that did not fit. */
  give(items: readonly Gear[]): Gear[] {
    const room = Math.max(0, BAG_SIZE - this.bag.length);
    this.bag.push(...items.slice(0, room));
    return items.slice(room);
  }

  /** Whether the piece in the bag with `id` can be put on now. */
  canWear(g: Gear): boolean {
    return g.lv <= this.level;
  }

  /** Puts the piece from the bag on, the one it replaces going into its place in the bag. */
  wear(id: number): boolean {
    const i = this.bag.findIndex((g) => g.id === id);
    if (i < 0 || !this.canWear(this.bag[i])) return false;
    const g = this.bag[i];
    const old = this.worn[g.slot];
    if (old) this.bag[i] = old;
    else this.bag.splice(i, 1);
    this.worn[g.slot] = g;
    return true;
  }

  /** Takes the piece in `slot` off into the bag, when the bag has room. */
  takeOff(slot: Slot): boolean {
    const g = this.worn[slot];
    if (!g || this.bag.length >= BAG_SIZE) return false;
    delete this.worn[slot];
    this.bag.push(g);
    return true;
  }

  /** Throws a piece in the bag away. */
  discard(id: number): boolean {
    const i = this.bag.findIndex((g) => g.id === id);
    if (i < 0) return false;
    this.bag.splice(i, 1);
    return true;
  }

  /** Takes a piece away wherever it is, worn or in the bag (it broke). */
  remove(id: number): boolean {
    if (this.discard(id)) return true;
    const slot = SLOTS.find((s) => this.worn[s]?.id === id);
    if (!slot) return false;
    delete this.worn[slot];
    return true;
  }

  save(): void {
    const s: Save = {
      v: VERSION,
      level: this.level,
      xp: this.xp,
      nextId: this.nextId,
      gold: this.gold,
      stones: this.stones,
      tickets: this.tickets,
      bag: this.bag,
      worn: this.worn,
      skillLv: this.skillLv,
      bar: this.bar,
    };
    this.store.set(KEY, JSON.stringify(s));
  }

  /** Reads a save; a missing or broken one leaves a fresh character. */
  private load(raw: string | null): void {
    let v: Partial<Save>;
    try {
      v = raw ? (JSON.parse(raw) as Partial<Save>) : {};
    } catch {
      return;
    }
    if (!v || v.v !== VERSION) return;
    const int = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;
    if (int(v.level, 1, MAX_LEVEL)) this.level = v.level!;
    if (int(v.xp, 0, Number.MAX_SAFE_INTEGER)) this.xp = v.xp!;
    for (const k of ['gold', 'stones', 'tickets'] as const) if (int(v[k], 0, Number.MAX_SAFE_INTEGER)) this[k] = v[k]!;
    const bag = Array.isArray(v.bag) ? v.bag.map(parseGear).filter((g): g is Gear => !!g) : [];
    this.bag = bag.slice(0, BAG_SIZE);
    for (const slot of SLOTS) {
      const g = parseGear(v.worn?.[slot]);
      if (g && g.slot === slot) this.worn[slot] = g;
    }
    if (v.skillLv && typeof v.skillLv === 'object') {
      for (const [id, lv] of Object.entries(v.skillLv)) if (isSkill(id) && int(lv, 1, MAX_SKILL_LV)) this.skillLv[id] = lv;
    }
    if (validLoadout(v.bar)) this.bar = [...v.bar];
    const top = Math.max(0, ...this.bag.map((g) => g.id), ...Object.values(this.worn).map((g) => g.id));
    this.nextId = Math.max(top + 1, int(v.nextId, 1, Number.MAX_SAFE_INTEGER) ? v.nextId! : 1);
  }
}
