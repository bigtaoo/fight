import { BTN } from '@dnf/engine';

// Keyboard to engine buttons, DNF's default layout: arrows move (double tap to run),
// X attacks, C jumps, A and S are the two skills.

const KEYS: Record<string, number> = {
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  KeyX: BTN.ATTACK,
  KeyC: BTN.JUMP,
  KeyA: BTN.SKILL1,
  KeyS: BTN.SKILL2,
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

  /** The buttons for the next tick: held now, or tapped since the last tick. */
  read(): number {
    const b = this.held | this.tapped;
    this.tapped = 0;
    return b;
  }
}
