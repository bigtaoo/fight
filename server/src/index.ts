import { fileURLToPath } from 'node:url';
import { SERVER_PORT } from '../protocol';
import { startServer } from './server';

const port = Number(process.env.PORT ?? SERVER_PORT);
const dataFile = fileURLToPath(new URL('../data/inventory.json', import.meta.url));
const server = await startServer({ port, dataFile });
console.log(`dnf server on ws://localhost:${server.port} (inventory: ${dataFile})`);
