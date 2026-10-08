import { BTN, runConfig } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { OfflineSession } from '../net/Session';
import heroSkeleton from '../../public/art/hero/skeleton.json';
import { BodyView } from './bodyView';
import type { TaoSkeleton } from './tao/types';

// the hit-flash filter compiles a shader at import, which needs a canvas
vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), ColorMatrixFilter: class { matrix: number[] = [] } }));

type World = Map<string, { a: number; b: number; c: number; d: number; tx: number; ty: number }>;

/** Plays the hero at 60 fps, `buttons` choosing what is held each tick, calling `frame` with the
 * rig's bone matrices after every drawn frame. */
function play(dungeon: 'trial' | 'training', seconds: number, buttons: (s: OfflineSession) => number, frame: (world: World) => void): void {
  const sk = heroSkeleton as unknown as TaoSkeleton;
  const textures = new Map(Object.keys(sk.images).map((k) => [k, Texture.EMPTY]));
  const session = new OfflineSession(runConfig({ seed: 3, dungeon }));
  const view = new BodyView(1, null, { skeleton: sk, textures });
  const world = (view as unknown as { actor: { world: World } }).actor.world;
  for (let f = 0; f < seconds * 60 && session.engine.state.outcome === 'playing'; f++) {
    const n = session.ticksFor(1000 / 60);
    for (let i = 0; i < n; i++) session.step(buttons(session));
    view.draw(session.engine.state.entities.find((e) => e.team === 0)!, session.alpha, f, 1 / 60, false);
    frame(world);
  }
}

describe('rigged hero on screen', () => {
  it('never twitches: the blade does not jump one way and straight back between frames', () => {
    const sk = heroSkeleton as unknown as TaoSkeleton;
    const slot = sk.slots.find((s) => s.bone === 'sword')!;
    const im = sk.images[slot.image];
    // the image corner farthest from the bone's pivot: the tip
    const corners = [[slot.x, slot.y], [slot.x + im.w, slot.y], [slot.x, slot.y + im.h], [slot.x + im.w, slot.y + im.h]];
    const [tx, ty] = corners.reduce((a, b) => (Math.hypot(b[0], b[1]) > Math.hypot(a[0], a[1]) ? b : a));

    const tips: { x: number; y: number }[] = [];
    // a minute of the bot playing: combos, cancels, hitstop, walking
    play('trial', 60, (s) => botButtons(s.engine.state, 0), (world) => {
      const w = world.get('sword')!;
      tips.push({ x: w.a * tx + w.c * ty + w.tx, y: w.b * tx + w.d * ty + w.ty });
    });
    let worst = 0;
    for (let i = 1; i + 1 < tips.length; i++) {
      const ax = tips[i].x - tips[i - 1].x;
      const ay = tips[i].y - tips[i - 1].y;
      const bx = tips[i + 1].x - tips[i].x;
      const by = tips[i + 1].y - tips[i].y;
      const back = ax * bx + ay * by < -0.3 * Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (back) worst = Math.max(worst, Math.min(Math.hypot(ax, ay), Math.hypot(bx, by)));
    }
    expect(tips.length).toBeGreaterThan(1000);
    // the windups pull the blade back on purpose (about 55 here); a hit throwing the cut back a
    // tick, or a combo cutting in from a different pose, was 150-230
    expect(worst).toBeLessThan(80);
  });

  it('keeps the free hand quieter than the sword hand when the attack is mashed', () => {
    // walk up to the dummy, then tap ATTACK every other tick: the combo chains a move every 6
    const path = { hand_b: 0, hand_f: 0 };
    const last: Record<string, { x: number; y: number }> = {};
    play('training', 9, (s) => (s.engine.state.tick < 30 ? BTN.RIGHT : s.engine.state.tick % 4 < 2 ? BTN.ATTACK : 0), (world) => {
      for (const b of ['hand_b', 'hand_f'] as const) {
        const w = world.get(b)!;
        if (last[b]) path[b] += Math.hypot(w.tx - last[b].x, w.ty - last[b].y);
        last[b] = { x: w.tx, y: w.ty };
      }
    });
    // flung 130-240 degrees per move, it travelled more than the sword hand (1634 against 1456 a
    // second) and read as flailing; now about half
    expect(path.hand_b).toBeLessThan(path.hand_f * 0.6);
  });
});
