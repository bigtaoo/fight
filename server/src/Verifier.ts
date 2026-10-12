import { Worker } from 'node:worker_threads';
import type { RunConfig } from '@dnf/engine';
import type { Frame } from '../protocol';
import type { ReplayOut } from './replay';
import type { VerifierIn } from './verifierWorker';

// One run's shadow simulation on a worker thread. The design calls for a pool shared by all
// runs; at M1 scale one worker per run is the same thing with less code.

// From source (tsx, vitest) the worker boots through the TypeScript loader; in the deployed
// bundle (scripts/build.mjs) it is its own bundled file next to server.mjs.
const WORKER = import.meta.url.endsWith('.ts') ? './verifierBoot.mjs' : './verifierWorker.mjs';

export class Verifier {
  private readonly worker = new Worker(new URL(WORKER, import.meta.url));

  constructor(config: RunConfig, onOut: (out: ReplayOut[]) => void, onError: (err: Error) => void) {
    this.worker.on('message', onOut);
    this.worker.on('error', onError);
    this.post({ type: 'init', config });
  }

  advance(to: number, frames: Frame[]): void {
    this.post({ type: 'advance', to, frames });
  }

  close(): void {
    void this.worker.terminate();
  }

  private post(msg: VerifierIn): void {
    this.worker.postMessage(msg);
  }
}
