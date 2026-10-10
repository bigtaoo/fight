import { DEFAULT_LOADOUT, DUNGEONS, validLoadout, type DungeonId } from '@dnf/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../protocol';
import { Inventory, validDevice } from './loot';
import { DEFAULT_OPTIONS, Run, type RunOptions } from './Run';

// The M1 server: one WebSocket per player, at most one run per socket (a new join ends the
// old run). Everything else, gateway, matchmaking, verifier pool, database, comes later.

export interface ServerOptions extends Partial<RunOptions> {
  port: number;
  /** The inventory file; null keeps it in memory (tests). */
  dataFile: string | null;
  log?: (msg: string) => void;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const runOpts: RunOptions = { ...DEFAULT_OPTIONS, ...opts };
  const log = opts.log ?? ((m: string) => console.log(m));
  const inventory = new Inventory(opts.dataFile);
  const wss = new WebSocketServer({ port: opts.port, maxPayload: 4096 });
  wss.on('connection', (ws: WebSocket) => {
    let run: Run | null = null;
    const send = (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg?.type === 'join') {
        if (!validDevice(msg.device) || !Object.hasOwn(DUNGEONS, msg.dungeon)) return;
        run?.close();
        const loadout = validLoadout(msg.loadout) ? msg.loadout : [...DEFAULT_LOADOUT];
        run = new Run(msg.dungeon as DungeonId, loadout, msg.device, inventory, send, runOpts, log);
      } else run?.handle(msg);
    });
    ws.on('close', () => run?.close());
  });
  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({
        port: addr && typeof addr === 'object' ? addr.port : opts.port,
        close: () =>
          new Promise<void>((done) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
