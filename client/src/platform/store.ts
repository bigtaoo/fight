// Where single-player saves live, and the device's random source for what is drawn outside the
// engine (gear, enhancement).

/** A random integer in [0, n) from the device (crypto), not the engine's seeded streams. */
export const deviceRand = (n: number): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
};

/** A key-value store for saves: localStorage in the browser, the platform's save data when its
 * SDK runs (platform.store), a map in tests. */
export interface BagStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** localStorage, or nothing when it is blocked (a private window): saves then last the visit. */
export const browserStore: BagStore = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // blocked storage: keep it in memory only
    }
  },
};
