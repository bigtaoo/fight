import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// @dnf/engine and the server's protocol types are consumed as source (no build step); mirrors
// `paths` in tsconfig.base.json.
const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));
const PROTOCOL = fileURLToPath(new URL('../server/protocol.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@dnf\/engine$/, replacement: `${ENGINE}/index.ts` },
      { find: /^@dnf\/engine\//, replacement: `${ENGINE}/` },
      { find: /^@dnf\/server\/protocol$/, replacement: PROTOCOL },
    ],
  },
  server: { port: 5180, host: true },
  build: { target: 'es2020', outDir: 'dist' },
});
