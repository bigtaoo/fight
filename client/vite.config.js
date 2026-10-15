import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// @dnf/engine, the server's protocol types and its loot tables are consumed as source (no build step); mirrors
// `paths` in tsconfig.base.json.
const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));
const PROTOCOL = fileURLToPath(new URL('../server/protocol.ts', import.meta.url));
const LOOT = fileURLToPath(new URL('../server/lootTables.ts', import.meta.url));

/** The CrazyGames SDK v3, loaded before the game's code (client/src/platform). */
const CG_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

// `--mode crazygames` builds the single-player page for the platform: relative paths (it is served
// from a folder of theirs), no game server (see Game.connect), the platform's SDK, into dist-cg.
export default defineConfig(({ mode }) => ({
  base: mode === 'crazygames' ? './' : '/',
  plugins: [
    {
      name: 'crazygames-sdk',
      transformIndexHtml: () => (mode === 'crazygames' ? [{ tag: 'script', attrs: { src: CG_SDK }, injectTo: 'head-prepend' }] : []),
    },
  ],
  resolve: {
    alias: [
      { find: /^@dnf\/engine$/, replacement: `${ENGINE}/index.ts` },
      { find: /^@dnf\/engine\//, replacement: `${ENGINE}/` },
      { find: /^@dnf\/server\/protocol$/, replacement: PROTOCOL },
      { find: /^@dnf\/server\/lootTables$/, replacement: LOOT },
    ],
  },
  server: { port: 5180, host: true },
  build: { target: 'es2020', outDir: mode === 'crazygames' ? 'dist-cg' : 'dist' },
}));
