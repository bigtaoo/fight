import { describe, expect, it } from 'vitest';
import { Engine, LocalInputSource, runConfig } from '@dnf/engine';
import { botButtons } from '@dnf/engine/bot';
import { Character } from '../rpg/character';
import { OfflineSession } from '../net/Session';
import { AUDIO_FILES, SFX, comboRate, cues, trackFor } from './sounds';

// The sound map: every file it names is there with its licence note, a bot's run through the fort
// makes the sounds it should, and the music turns to the boss's theme in the hall.

const files = Object.keys(import.meta.glob('/public/audio/**/*.{mp3,txt}')).map((k) => k.replace('/public/audio/', ''));

describe('sounds', () => {
  it('has every file it plays, each with its source beside it', () => {
    for (const f of AUDIO_FILES) {
      expect(files).toContain(f);
      expect(files).toContain(f.replace(/\.mp3$/, '.txt'));
    }
  });

  it('sounds a run through the fort, and plays the boss theme in the hall', () => {
    const session = new OfflineSession(runConfig({ seed: 1, dungeon: 'heifeng' }), new Character({ get: () => null, set: () => {} }));
    const e = session.engine;
    const heard = new Set<string>();
    const tracks = new Set<string | null>();
    let bossTrackInHall = true;
    while (e.state.outcome === 'playing' && e.state.tick < 30 * 60 * 12) {
      const events = session.step(botButtons(e.state, 0));
      for (const c of cues(events, e.state)) {
        expect(SFX[c.sfx]).toBeDefined();
        heard.add(c.sfx);
      }
      const t = trackFor(e.state);
      tracks.add(t);
      if ((e.state.room === 5) !== (t === 'boss')) bossTrackInHall = false;
    }
    expect(e.state.outcome).toBe('cleared');
    for (const s of ['swish', 'slash', 'hit', 'heavy', 'die', 'roar', 'clear', 'win']) expect(heard).toContain(s);
    expect(tracks).toEqual(new Set(['road', 'boss']));
    expect(bossTrackInHall).toBe(true);
  });

  it('stops the music when the hero falls', () => {
    const s = new Engine(runConfig({ seed: 1, dungeon: 'trial' }), new LocalInputSource()).state;
    expect(trackFor(s)).toBe('road');
    expect(trackFor({ ...s, outcome: 'failed' })).toBeNull();
  });

  it("raises a hero's blows a step per ten combo hits, up to a limit", () => {
    const s = new Engine(runConfig({ seed: 1, dungeon: 'trial' }), new LocalInputSource()).state;
    const p = s.players[0];
    const rate = (combo: number) => {
      p.combo = combo;
      return comboRate(s, p.hero);
    };
    expect(rate(0)).toBe(1);
    expect(rate(9)).toBe(1);
    expect(rate(10)).toBeCloseTo(1.03);
    expect(rate(35)).toBeCloseTo(1.09);
    expect(rate(500)).toBeCloseTo(1.15);
    // a monster's blow is never raised
    expect(comboRate(s, -1)).toBe(1);
  });
});
