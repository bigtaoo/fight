import { readFileSync } from 'node:fs';
import { cleanEvent, type GameEvent } from '../src/events';
import { funnel, report } from '../src/funnel';

// Prints the drop-off report of event files (events-*.jsonl, from the server's data directory):
//   ssh blightbloom 'cat /home/deploy/fight/data/events-*.jsonl' > events.jsonl
//   npm run funnel -w server -- ../events.jsonl

const events: GameEvent[] = [];
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = cleanEvent(JSON.parse(line));
    if (e) events.push(e);
  }
}
console.log(report(funnel(events)));
