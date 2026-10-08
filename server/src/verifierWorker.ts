import { parentPort } from 'node:worker_threads';
import type { RunConfig } from '@dnf/engine';
import type { Frame } from '../protocol';
import { Replayer } from './replay';

// Worker thread entry (booted through verifierBoot.mjs): one shadow simulation per run, off the
// relay's thread so a slow replay never delays the frame clock.

export type VerifierIn = { type: 'init'; config: RunConfig } | { type: 'advance'; to: number; frames: Frame[] };

let replayer: Replayer | null = null;

parentPort!.on('message', (msg: VerifierIn) => {
  if (msg.type === 'init') replayer = new Replayer(msg.config);
  else if (replayer) {
    const out = replayer.advance(msg.to, msg.frames);
    if (out.length) parentPort!.postMessage(out);
  }
});
