import { BTN } from '@dnf/engine';

// Keyboard to engine buttons, DNF's default layout where it has one: arrows move (double tap to
// run), X attacks, C jumps, Z dodges, A S D are the three skill slots and F the ultimate.

const KEYS: Record<string, number> = {
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  KeyX: BTN.ATTACK,
  KeyC: BTN.JUMP,
  KeyA: BTN.SKILL1,
  KeyS: BTN.SKILL2,
  KeyD: BTN.SKILL3,
  KeyF: BTN.ULT,
  KeyZ: BTN.DODGE,
};

export class Keyboard {
  private held = 0;
  /** Bits pressed and already released since the last read, so a tap shorter than a tick still counts. */
  private tapped = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (ev) => {
      const b = KEYS[ev.code];
      if (b === undefined) return;
      ev.preventDefault();
      this.held |= b;
    });
    target.addEventListener('keyup', (ev) => {
      const b = KEYS[ev.code];
      if (b === undefined) return;
      this.tapped |= b & this.held;
      this.held &= ~b;
    });
    target.addEventListener('blur', () => (this.held = 0));
  }

  /** The buttons held right now. */
  get down(): number {
    return this.held;
  }

  /** The buttons for the next tick: held now, or tapped since the last tick. */
  read(): number {
    const b = this.held | this.tapped;
    this.tapped = 0;
    return b;
  }
}
