// Plain JS, so the worker starts the same under tsx, plain node and vitest: registers the
// TypeScript loader in this thread, then loads the real entry.
import { register } from 'tsx/esm/api';

register();
await import('./verifierWorker.ts');
