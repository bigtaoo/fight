import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// @dnf/engine is consumed as source (no build step); mirrors `paths` in tsconfig.base.json.
const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@dnf\/engine$/, replacement: `${ENGINE}/index.ts` },
      { find: /^@dnf\/engine\//, replacement: `${ENGINE}/` },
    ],
  },
  server: { port: 5180, host: true },
  build: { target: 'es2020', outDir: 'dist' },
});
