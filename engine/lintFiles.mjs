import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The engine's own source files, read for determinismLint.test.ts. Plain JS so the engine's
// tsconfig needs no Node types (the sim must not see them).
const ROOT = fileURLToPath(new URL('.', import.meta.url));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') && name !== 'vitest.config.ts') yield p;
  }
}

/** Every sim source as { rel, text }, rel with forward slashes. */
export function engineSources() {
  return [...walk(ROOT)].map((p) => ({ rel: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
}
