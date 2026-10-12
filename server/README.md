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
  dungeon and every checkpoint matched: each monster the replay saw killed rolls its kind's
  table, and the clear draws from the table of the replay's rating (`rateRun`); the inventory is
  `data/inventory.json` (not in git).

The client side is `client/src/net/OnlineSession.ts`: local input applies at once, the session
stays about a round trip ahead of the frame clock, and it rolls back when a frame disagrees.
`test/run.test.ts` plays it end to end over a real socket with the engine's bot.

## Deploy

The deployed page (https://f.gamestao.com) plays against **wss://fs.gamestao.com**
(`PUBLIC_SERVER_URL` in `protocol.ts`; a page served over plain http still uses
`ws://<its host>:5181`, and `?server=` overrides both).

It runs on the box daydayup owns (Hetzner `blightbloom`, 62.238.1.182; ssh alias `blightbloom`),
next to Holy Kicker (D:\standing) and sharing nothing with either but the machine: its own
compose project in `/home/deploy/fight` (`deploy/`), its own network. Two containers:
`fight-server` (256 MB, no published port, the inventory in `/home/deploy/fight/data`) and
`fight-tunnel` (cloudflared). The box's ports 80/443 are daydayup's Caddy, so the way in is a
Cloudflare Tunnel: `fight-tunnel` dials out to Cloudflare, which serves fs.gamestao.com and
passes requests (the WebSocket and `GET /health`) down to `http://server:5181`.

The image runs the bundle, not the source: `npm run build -w server` (`scripts/build.mjs`) puts
the server and the verifier's worker, engine and ws included, into `dist/server.mjs` and
`dist/verifierWorker.mjs`. To try the bundle locally:

```bash
npm run build -w server && PORT=5299 node server/dist/server.mjs
DNF_SERVER_URL=ws://localhost:5299 npx vitest run test/remote.test.ts   # in server/
```

`test/remote.test.ts` is skipped unless `DNF_SERVER_URL` is set: the bot clears the trial
online against that server in real time (about 35 s). Run it against `wss://fs.gamestao.com`
after a deploy.

### Deploy from CI

Every green push to `main` deploys it (`.github/workflows/ci.yml`, job `deploy-server`, before
the web build goes out; switched on by the repo Variable `SERVER_DEPLOY_ENABLED=true`); a push
that leaves the bundle unchanged restarts nothing.

CI holds an ssh key (`D:\cloud\fight_ci_ed25519`, the only readable copy; the private half is
the repo Secret `SERVER_DEPLOY_KEY`) that can do one thing on the box: it is registered in
`/home/deploy/.ssh/authorized_keys` as
`command="/home/deploy/fight-ci-deploy.sh",restrict ssh-ed25519 AAAA... fight-ci`, so whatever
it asks for, sshd runs `deploy/ci-deploy.sh` as `deploy`. Repo Variable
`SERVER_SSH_KNOWN_HOSTS` is the box's ed25519 host key line.

The live script sits outside the deploy target so a deploy cannot replace it; after editing
`deploy/ci-deploy.sh`, install it again:

```bash
tr -d '\r' < server/deploy/ci-deploy.sh | ssh blightbloom 'install -o deploy -g deploy -m 700 /dev/stdin /home/deploy/fight-ci-deploy.sh'
```

The box keeps one secret, `FIGHT_TUNNEL_TOKEN` (the tunnel's connector token), in
`/home/deploy/fight/.env`, which the deploy never touches. The tunnel `fight` is remotely
managed (Cloudflare Zero Trust → Networks → Tunnels, account of the f.gamestao.com Worker): its
one public hostname is `fs.gamestao.com` → `http://server:5181`, with a proxied CNAME to
`<tunnel id>.cfargotunnel.com`.
