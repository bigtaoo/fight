import { DEFAULT_LOADOUT, DUNGEONS, SLOTS, validLoadout, type DungeonId } from '@dnf/engine';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../protocol';
import { EventLog, MAX_BODY, parseBatch } from './events';
import { Inventory, validDevice } from './loot';
import { DEFAULT_OPTIONS, Run, type RunOptions } from './Run';

// The M1 server: one WebSocket per player, at most one run per socket (a new join ends the
// old run). Everything else, gateway, matchmaking, verifier pool, database, comes later.
// Plain HTTP on the same port answers GET /health (the deploy's healthcheck) and takes
// POST /events (the drop-off analytics, from any origin); anything else that is not a WebSocket
// upgrade gets a 404.

export interface ServerOptions extends Partial<RunOptions> {
  port: number;
  /** The inventory file; null keeps it in memory (tests). */
  dataFile: string | null;
  log?: (msg: string) => void;
  /** Where the analytics go; defaults to the inventory file's directory (memory when that is null). */
  eventsDir?: string | null;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const runOpts: RunOptions = { ...DEFAULT_OPTIONS, ...opts };
  const log = opts.log ?? ((m: string) => console.log(m));
  const inventory = new Inventory(opts.dataFile);
  const events = new EventLog(opts.eventsDir !== undefined ? opts.eventsDir : opts.dataFile && dirname(opts.dataFile));
  const http = createServer((req, res) => {
    if (req.url === '/events') return void takeEvents(req, res, events, log);
    const ok = req.method === 'GET' && req.url === '/health';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(ok ? '{"ok":true,"service":"dnf"}' : '{"ok":false}');
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4096 });
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
        // a client from before the six-slot bar sends four
        const sent = Array.isArray(msg.loadout) && msg.loadout.length < SLOTS ? [...msg.loadout, ...new Array<null>(SLOTS - msg.loadout.length).fill(null)] : msg.loadout;
        const loadout = validLoadout(sent) ? sent : [...DEFAULT_LOADOUT];
        run = new Run(msg.dungeon as DungeonId, loadout, msg.device, inventory, send, runOpts, log);
      } else run?.handle(msg);
    });
    ws.on('close', () => run?.close());
  });
  return new Promise((resolve) => {
    http.listen(opts.port, () => {
      const addr = http.address();
      resolve({
        port: addr && typeof addr === 'object' ? addr.port : opts.port,
        close: () =>
          new Promise<void>((done) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}

/** The game page is on another origin (the platform's iframe): any origin may post. The client
 * sends text/plain so a beacon needs no preflight; OPTIONS is answered all the same. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

function takeEvents(req: IncomingMessage, res: ServerResponse, log: EventLog, say: (m: string) => void): void {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, CORS).end();
    return;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413, CORS).end();
      req.destroy();
    } else chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_BODY) return;
    log.write(parseBatch(Buffer.concat(chunks).toString('utf8'))).then(
      () => res.writeHead(204, CORS).end(),
      (err: unknown) => {
        say(`events: ${String(err)}`);
        res.writeHead(500, CORS).end();
      },
    );
  });
}
