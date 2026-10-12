// Bundles the server for the Docker image (deploy/): dist/server.mjs and the verifier's worker,
// dist/verifierWorker.mjs, which server.mjs starts from its own directory (src/Verifier.ts).
// Everything is inside, the engine and ws too, so the image needs nothing but Node.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: { server: at('../src/index.ts'), verifierWorker: at('../src/verifierWorker.ts') },
  outdir: at('../dist'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // ws's optional native speed-ups: it does without them
  external: ['bufferutil', 'utf-8-validate'],
  // ws is CommonJS and requires Node's own modules, which an ESM bundle cannot do on its own
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
