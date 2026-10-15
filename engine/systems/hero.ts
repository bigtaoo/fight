import { DODGE, HERO, MOVES, SKILLS, WORLD, type SkillId } from '../content';
import type { SimEvent } from '../events';
import { BTN, type PlayerCommand } from '../input';
import { MAX_CDR, setState, skillLevel, type Entity, type PlayerSlot, type SimState } from '../state';
import { moveVelocity, startMove } from './moves';

// The hero: buttons in, presses and double taps derived, then the state machine. Recovery is
// cancelled from a move's `cancel` tick on: into any skill but the move's own, or into the dodge;
// a skill of several parts chains into its next part on another press of its button.

/** Which press the buffer keeps when several land on one tick. */
const ACTION_ORDER = [BTN.DODGE, BTN.SKILL6, BTN.SKILL5, BTN.SKILL4, BTN.SKILL3, BTN.SKILL2, BTN.SKILL1, BTN.JUMP, BTN.ATTACK] as const;
/** The button of each skill slot. */
const SLOT_BTN = [BTN.SKILL1, BTN.SKILL2, BTN.SKILL3, BTN.SKILL4, BTN.SKILL5, BTN.SKILL6] as const;

/** Takes this tick's buttons; finds presses, double-tap runs and the buffered press. */
export function applyInput(s: SimState, cmds: readonly PlayerCommand[]): void {
  for (const p of s.players) {
    const cmd = cmds.find((c) => c.owner === p.owner);
    p.prev = p.buttons;
    if (cmd) p.buttons = cmd.buttons;
    const pressed = p.buttons & ~p.prev;
    for (const dir of [BTN.LEFT, BTN.RIGHT]) {
      if (!(pressed & dir)) continue;
      p.running = p.tapDir === dir && s.tick - p.tapTick <= HERO.doubleTap;
      p.tapDir = dir;
      p.tapTick = s.tick;
    }
    if (!(p.buttons & (BTN.LEFT | BTN.RIGHT))) p.running = false;
    for (const b of ACTION_ORDER) {
      if (pressed & b) {
        p.buf = b;
        p.bufLeft = HERO.buffer;
        break;
      }
    }
  }
}

function dirX(p: PlayerSlot): number {
  return (p.buttons & BTN.RIGHT ? 1 : 0) - (p.buttons & BTN.LEFT ? 1 : 0);
}

function dirY(p: PlayerSlot): number {
  return (p.buttons & BTN.DOWN ? 1 : 0) - (p.buttons & BTN.UP ? 1 : 0);
}

/** A buffered ATTACK press, or ATTACK held down (holding mashes, as in DNF). */
function wantsAttack(p: PlayerSlot): boolean {
  return p.buf === BTN.ATTACK || (p.buttons & BTN.ATTACK) !== 0;
}

/** The slot of the skill the buffer asks for, if it holds one that is ready and not the one
 * being performed; -1 otherwise. */
function wantedSlot(p: PlayerSlot, e: Entity): number {
  const slot = SLOT_BTN.indexOf(p.buf as (typeof SLOT_BTN)[number]);
  if (slot < 0 || e.cd[slot] !== 0) return -1;
  const id = p.skills[slot];
  return id === null || (e.state === 'act' && MOVES[e.move].of === id) ? -1 : slot;
}

function wantsDodge(p: PlayerSlot, e: Entity): boolean {
  return p.buf === BTN.DODGE && e.cd[DODGE.slot] === 0;
}

function consume(p: PlayerSlot): void {
  p.buf = 0;
  p.bufLeft = 0;
}

/** Starts the skill in `slot`, its cooldown cut by the hero's and by its perk once its level
 * reaches it; the perk's super armour too. */
function useSkill(s: SimState, p: PlayerSlot, e: Entity, slot: number, events: SimEvent[], dx: number, dy: number): void {
  const id = p.skills[slot] as SkillId;
  const sk = SKILLS[id];
  const perk = skillLevel(s, id) >= sk.perk.lv ? sk.perk : null;
  const cut = Math.min(s.config.hero.cdr, MAX_CDR) + (perk?.cdPct ?? 0);
  e.cd[slot] = sk.cooldown - Math.trunc((sk.cooldown * cut) / 100);
  startMove(e, sk.move, events, dx, dy);
  e.armor = perk?.armor ?? 0;
}

function dodge(e: Entity, events: SimEvent[]): void {
  e.cd[DODGE.slot] = DODGE.cooldown;
  startMove(e, DODGE.move, events);
}

/** One tick of a hero that is free to act or acting (not stunned, launched or down). */
export function heroControl(s: SimState, e: Entity, events: SimEvent[]): void {
  const p = s.players.find((q) => q.hero === e.id);
  if (!p) return;
  const dx = dirX(p);
  const dy = dirY(p);
  const st = e.state;

  if (st === 'idle' || st === 'walk' || st === 'run') {
    const slot = wantedSlot(p, e);
    if (slot >= 0) {
      consume(p);
      useSkill(s, p, e, slot, events, dx, dy);
    } else if (wantsDodge(p, e)) {
      consume(p);
      dodge(e, events);
    } else if (p.buf === BTN.JUMP) {
      consume(p);
      setState(e, 'jump');
      e.vz = HERO.jumpVz;
      e.vx = dx * (p.running ? HERO.runX : HERO.walkX);
      e.vy = dy * HERO.walkY;
      events.push({ type: 'jump', id: e.id });
    } else if (wantsAttack(p)) {
      consume(p);
      startMove(e, 'atk1', events, dx);
    } else {
      if (dx !== 0) e.facing = dx;
      e.vx = dx * (p.running ? HERO.runX : HERO.walkX);
      e.vy = dy * HERO.walkY;
      const next = dx === 0 && dy === 0 ? 'idle' : p.running && dx !== 0 ? 'run' : 'walk';
      if (next !== st) setState(e, next);
    }
  } else if (st === 'jump') {
    if (dx !== 0) e.vx = dx * Math.max(HERO.airX, Math.abs(e.vx));
    e.vy = Math.trunc((dy * HERO.walkY) / 2);
    if (p.buf === BTN.ATTACK && !e.airAtk) {
      consume(p);
      e.airAtk = true;
      startMove(e, 'jumpAtk', events);
    }
  } else if (st === 'act') {
    const m = MOVES[e.move];
    moveVelocity(e, m);
    if (m.early && p.buf === BTN.JUMP && e.st < (m.fire?.at ?? m.total)) {
      consume(p);
      startMove(e, m.early, events);
      return tickBuffer(p);
    }
    if (m.cancel > 0 && e.st >= m.cancel) {
      if (m.follow && m.of && p.buf === SLOT_BTN[p.skills.indexOf(m.of)]) {
        consume(p);
        startMove(e, m.follow, events, dx, dy);
        return tickBuffer(p);
      }
      const slot = wantedSlot(p, e);
      if (slot >= 0) {
        consume(p);
        useSkill(s, p, e, slot, events, dx, dy);
        return tickBuffer(p);
      }
      if (wantsDodge(p, e)) {
        consume(p);
        dodge(e, events);
        return tickBuffer(p);
      }
      if (m.next && wantsAttack(p)) {
        consume(p);
        startMove(e, m.next, events, dx);
        return tickBuffer(p);
      }
    }
    if (e.st >= m.total) {
      if (m.then) startMove(e, m.then, events, dx, dy);
      else setState(e, m.air && e.z > 0 ? 'jump' : 'idle');
    }
  }
  tickBuffer(p);
}

/** A hero lying down gets up at once on a JUMP press (a quick rise), untouchable for a moment
 * past the getup. True when it did. */
export function quickRise(s: SimState, e: Entity, events: SimEvent[]): boolean {
  const p = s.players.find((q) => q.hero === e.id);
  if (!p || e.state !== 'down' || p.buf !== BTN.JUMP) return false;
  consume(p);
  setState(e, 'getup');
  e.timer = WORLD.getupTicks;
  e.inv = WORLD.getupTicks + HERO.riseInv;
  events.push({ type: 'rise', id: e.id });
  return true;
}

/** Counts the buffered press down by one unfrozen tick. */
export function tickBuffer(p: PlayerSlot): void {
  if (p.buf !== 0 && --p.bufLeft <= 0) consume(p);
}
