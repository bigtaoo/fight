import { browserStore, type BagStore } from './store';

// The platform the game is published on: the CrazyGames SDK v3 (its script is in the page of the
// crazygames build only, see vite.config.js). Without it (development, our own site, the script
// blocked, any domain the SDK disables itself on) every call does nothing and saves stay in
// localStorage. The game tells the platform when loading starts and stops, when play starts and
// stops (a menu, the pause panel, the result), and when something worth celebrating happens; it
// asks it for the player's locale, for a store that follows a signed-in player across devices, and
// whether the platform wants the sound off.

interface Sdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings: { muteAudio?: boolean };
    addSettingsChangeListener(cb: (s: { muteAudio?: boolean }) => void): void;
  };
  data: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  user: { systemInfo?: { locale?: string } };
}

/** How long the SDK may take to start before the game goes on without it. */
const INIT_MS = 5000;

let sdk: Sdk | null = null;
let playing = false;

/** Starts the SDK when the page has one; the game runs without it when it does not start. */
export async function initPlatform(): Promise<void> {
  const s = (window as { CrazyGames?: { SDK?: Sdk } }).CrazyGames?.SDK;
  if (!s || s.environment === 'disabled') return;
  try {
    let timer = 0;
    await Promise.race([s.init(), new Promise((_, no) => (timer = window.setTimeout(() => no(new Error('sdk init timed out')), INIT_MS)))]);
    window.clearTimeout(timer);
    sdk = s;
  } catch (e) {
    console.warn('CrazyGames SDK not started:', e);
  }
}

/** Calls into the SDK, never letting one of its errors stop the game. */
function call(f: (s: Sdk) => void): void {
  if (!sdk) return;
  try {
    f(sdk);
  } catch (e) {
    console.warn('CrazyGames SDK:', e);
  }
}

export const platform = {
  /** The player's locale as the platform knows it, else the browser's. */
  get locale(): string {
    return sdk?.user.systemInfo?.locale ?? navigator.language;
  },

  loadingStart: () => call((s) => s.game.loadingStart()),
  loadingStop: () => call((s) => s.game.loadingStop()),

  /** Whether the player is playing now; told to the platform only when it changes. */
  gameplay(on: boolean): void {
    if (on === playing) return;
    playing = on;
    call((s) => (on ? s.game.gameplayStart() : s.game.gameplayStop()));
  },

  /** A moment worth celebrating (sparingly: a first clear, a new best). */
  happytime: () => call((s) => s.game.happytime()),

  /** Calls `cb` with whether the platform wants the sound off, now and whenever that changes. */
  onMute(cb: (muted: boolean) => void): void {
    if (!sdk) return;
    cb(!!sdk.game.settings.muteAudio);
    call((s) => s.game.addSettingsChangeListener((st) => cb(!!st.muteAudio)));
  },

  /** Saves: the platform's (kept with a signed-in player's account), else localStorage. */
  get store(): BagStore {
    return sdk ? sdkStore(sdk) : browserStore;
  },
};

/** The SDK's data module. A key it lacks is taken over once from localStorage, where saves from
 * before the SDK (or from a visit where it did not start) are. */
function sdkStore(s: Sdk): BagStore {
  return {
    get: (key) => {
      try {
        const v = s.data.getItem(key);
        if (v !== null) return v;
        const old = browserStore.get(key);
        if (old !== null) s.data.setItem(key, old);
        return old;
      } catch {
        return browserStore.get(key);
      }
    },
    set: (key, value) => {
      try {
        s.data.setItem(key, value);
      } catch {
        browserStore.set(key, value);
      }
    },
  };
}
