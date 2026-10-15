import { SFX, type Cue, type SfxGroup, type Track } from './sounds';
import type { BagStore } from '../platform/store';

// The sound player. Effects are decoded once into buffers and played through WebAudio; the music
// streams from <audio> elements routed into the same graph (decoding minutes of music would take
// a hundred megabytes), crossfading when the track changes. Browsers keep audio locked until the
// player touches the page, iOS until a touch: the first pointer or key press unlocks it. The game
// pausing (the page hidden, the window left, a platform's ad) silences everything; muting is
// remembered across visits.

const MUTE_KEY = 'dnf.mute';
const MASTER = 0.8;
const MUSIC_VOL = 0.35;
const FADE_SEC = 1.2;
/** A group plays at most this often (ms): a sweep through a crowd should not stack ten hits. */
const GAP_MS = 45;

export class SoundPlayer {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null = null;
  private readonly musicBus: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly last = new Map<SfxGroup, number>();
  private readonly tracks = new Map<Track, { el: HTMLAudioElement; gain: GainNode }>();
  private track: Track | null = null;
  private unlocked = false;
  private hidden = false;
  /** The player's own switch (M, the pause menu); remembered. */
  muted: boolean;
  /** The platform wants the sound off (its own mute setting); not remembered, it tells us again. */
  private silenced = false;

  /** `base`: where audio/ is (the build's base URL). */
  constructor(private readonly base: string, private readonly store: BagStore) {
    this.muted = store.get(MUTE_KEY) === '1';
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;
    if (!this.ctx) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.quiet ? 0 : MASTER;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = MUSIC_VOL;
    this.musicBus.connect(this.master);
    const unlock = () => {
      this.unlocked = true;
      void this.ctx!.resume();
      this.playTrack();
      for (const t of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(t, unlock, true);
    };
    for (const t of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(t, unlock, true);
  }

  /** Fetches and decodes the effects; a file that fails is left silent. */
  async load(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const names = [...new Set(Object.values(SFX).flat())];
    await Promise.all(
      names.map(async (n) => {
        try {
          const data = await (await fetch(`${this.base}audio/sfx/${n}.mp3`)).arrayBuffer();
          this.buffers.set(n, await ctx.decodeAudioData(data));
        } catch {
          // silent
        }
      }),
    );
  }

  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || this.quiet || this.hidden) return;
    const now = performance.now();
    if (now - (this.last.get(cue.sfx) ?? -Infinity) < GAP_MS) return;
    const group = SFX[cue.sfx];
    const buf = this.buffers.get(group[Math.floor(Math.random() * group.length)]);
    if (!buf) return;
    this.last.set(cue.sfx, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // a little pitch drift so a repeated sound is not the same each time
    src.playbackRate.value = (cue.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const gain = ctx.createGain();
    gain.gain.value = cue.vol;
    src.connect(gain).connect(this.master!);
    src.start();
  }

  /** Switches the music to `track` (null: none), fading across. */
  music(track: Track | null): void {
    if (track === this.track || !this.ctx) return;
    const old = this.track && this.tracks.get(this.track);
    if (old) this.fade(old, 0);
    this.track = track;
    this.playTrack();
  }

  private get quiet(): boolean {
    return this.muted || this.silenced;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.store.set(MUTE_KEY, this.muted ? '1' : '0');
    this.applyVolume();
    return this.muted;
  }

  /** The platform's mute setting, which wins over the player's switch while it is on. */
  silence(on: boolean): void {
    this.silenced = on;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.quiet ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  /** Stops all sound while `paused`. */
  pause(paused: boolean): void {
    this.hidden = paused;
    if (!this.ctx) return;
    if (paused) {
      void this.ctx.suspend();
      for (const t of this.tracks.values()) t.el.pause();
    } else if (this.unlocked) {
      void this.ctx.resume();
      this.playTrack();
    }
  }

  /** Starts the current track, once audio is unlocked. */
  private playTrack(): void {
    if (!this.track || !this.unlocked || this.hidden || !this.ctx) return;
    let t = this.tracks.get(this.track);
    if (!t) {
      const el = new window.Audio(`${this.base}audio/music/${this.track}.mp3`);
      el.loop = true;
      el.preload = 'auto';
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(gain).connect(this.musicBus!);
      t = { el, gain };
      this.tracks.set(this.track, t);
    }
    void t.el.play().catch(() => {});
    this.fade(t, 1);
  }

  private fade(t: { el: HTMLAudioElement; gain: GainNode }, to: number): void {
    const ctx = this.ctx!;
    const g = t.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(to, ctx.currentTime + FADE_SEC);
    if (to === 0) {
      const el = t.el;
      setTimeout(() => {
        if (![...this.tracks.entries()].some(([k, v]) => v === t && k === this.track)) el.pause();
      }, FADE_SEC * 1000 + 50);
    }
  }
}

