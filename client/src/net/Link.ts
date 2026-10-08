import type { ClientMsg, ServerMsg } from '@dnf/server/protocol';

// The WebSocket to the server, JSON both ways. `lagMs` delays every message in each direction
// by that much, to try the game on a slow line (?lag=150); it can change mid-run, and messages
// still arrive in order, as they would over TCP.

export interface Link {
  send(msg: ClientMsg): void;
  /** Replaces the handler; messages before one is set are dropped. */
  onMessage(handler: (msg: ServerMsg) => void): void;
  readonly open: boolean;
  close(): void;
}

export class WsLink implements Link {
  private handler: (msg: ServerMsg) => void = () => {};
  private closed = false;
  /** Delayed messages per direction, in order; one timer drains each queue. */
  private readonly queues = { out: new LagQueue(), in: new LagQueue() };

  private constructor(private readonly ws: WebSocket, public lagMs: number) {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      this.later('in', () => this.handler(msg));
    };
    ws.onclose = () => (this.closed = true);
  }

  /** Opens a link, or rejects after `timeoutMs` (no server running: the game goes offline). */
  static connect(url: string, lagMs = 0, timeoutMs = 1500): Promise<WsLink> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`no server at ${url}`));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new WsLink(ws, lagMs));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`no server at ${url}`));
      };
    });
  }

  get open(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg): void {
    const data = JSON.stringify(msg);
    this.later('out', () => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    });
  }

  onMessage(handler: (msg: ServerMsg) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.ws.close();
  }

  private later(dir: 'out' | 'in', fn: () => void): void {
    this.queues[dir].push(this.lagMs, fn);
  }
}

class LagQueue {
  private readonly items: { at: number; fn: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(lagMs: number, fn: () => void): void {
    if (lagMs <= 0 && !this.items.length) return fn();
    const last = this.items.length ? this.items[this.items.length - 1].at : 0;
    this.items.push({ at: Math.max(performance.now() + lagMs, last), fn });
    this.arm();
  }

  private arm(): void {
    if (this.timer || !this.items.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.items.length && this.items[0].at <= now) this.items.shift()!.fn();
      this.arm();
    }, Math.max(0, this.items[0].at - performance.now()));
  }
}
