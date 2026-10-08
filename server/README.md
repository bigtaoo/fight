# @dnf/server: metronome, verifier, loot

The M1 server, one Node process (`npm run server`, ws://localhost:5181). Built after
`D:\funny\server\gameserver` (the metronome relay), with funny's peer judge replaced by a
verifier the server runs itself.

- `protocol.ts`: the JSON messages both sides speak; the client imports it as source.
- `src/Run.ts`: one run. The frame clock is the wall clock; a command lands on the tick the
  client stamped it with unless that frame is already final (then on the next open one, and
  always after the player's previous command). Frames go out every 50 ms.
- `src/replay.ts` on a worker (`verifierWorker.ts`, booted by `verifierBoot.mjs`): replays the
  final frames with the config the server chose and hashes every 30th tick and the last one.
  A client checkpoint that differs flags the run, which then gets nothing.
- `src/loot.ts`: loot is drawn with `crypto.randomInt` only after the replay cleared the
  dungeon and every checkpoint matched; the inventory is `data/inventory.json` (not in git).

The client side is `client/src/net/OnlineSession.ts`: local input applies at once, the session
stays about a round trip ahead of the frame clock, and it rolls back when a frame disagrees.
`test/run.test.ts` plays it end to end over a real socket with the engine's bot.
