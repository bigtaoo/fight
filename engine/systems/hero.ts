import { HERO, MOVES, SKILLS } from '../content';
import type { SimEvent } from '../events';
import { BTN, type PlayerCommand } from '../input';
import { setState, type Entity, type PlayerSlot, type SimState } from '../state';
import { moveVelocity, skillReady, startMove } from './moves';

// The hero: buttons in, presses and double taps derived, then the state machine.

const ACTION_ORDER = [BTN.SKILL2, BTN.SKILL1, BTN.JUMP, BTN.ATTACK] as const;
const SKILL_BTN = [BTN.SKILL1, BTN.SKILL2] as const;

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

/** The skill slot the buffer asks for, if it is ready; -1 otherwise. */
function wantedSkill(p: PlayerSlot, e: Entity): number {
  const slot = SKILL_BTN.indexOf(p.buf as (typeof SKILL_BTN)[number]);
  return slot >= 0 && skillReady(e, slot) && e.move !== SKILLS[slot] ? slot : -1;
}

function consume(p: PlayerSlot): void {
  p.buf = 0;
  p.bufLeft = 0;
}

/** One tick of a hero that is free to act or acting (not stunned, launched or down). */
export function heroControl(s: SimState, e: Entity, events: SimEvent[]): void {
  const p = s.players.find((q) => q.hero === e.id);
  if (!p) return;
  const dx = dirX(p);
  const dy = dirY(p);
  const st = e.state;

  if (st === 'idle' || st === 'walk' || st === 'run') {
    const skill = wantedSkill(p, e);
    if (skill >= 0) {
      consume(p);
      startMove(e, SKILLS[skill], events, dx);
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
    if (m.cancel > 0 && e.st >= m.cancel) {
      const skill = wantedSkill(p, e);
      if (skill >= 0) {
        consume(p);
        startMove(e, SKILLS[skill], events, dx);
        return tickBuffer(p);
      }
      if (m.next && wantsAttack(p)) {
        consume(p);
        startMove(e, m.next, events, dx);
        return tickBuffer(p);
      }
    }
    if (e.st >= m.total) setState(e, m.air && e.z > 0 ? 'jump' : 'idle');
  }
  tickBuffer(p);
}

/** Counts the buffered press down by one unfrozen tick. */
export function tickBuffer(p: PlayerSlot): void {
  if (p.buf !== 0 && --p.bufLeft <= 0) consume(p);
}
