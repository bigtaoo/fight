import { Worker } from 'node:worker_threads';
import type { RunConfig } from '@dnf/engine';
import type { Frame } from '../protocol';
import type { ReplayOut } from './replay';
import type { VerifierIn } from './verifierWorker';

// One run's shadow simulation on a worker thread. The design calls for a pool shared by all
// runs; at M1 scale one worker per run is the same thing with less code.

export class Verifier {
  private readonly worker = new Worker(new URL('./verifierBoot.mjs', import.meta.url));

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
