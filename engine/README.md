# @dnf/engine: the simulation

All game logic: a deterministic simulation stepped at a fixed **30 Hz**, fed only by player
commands. The client draws it; the server's verifier (`server/src/replay.ts`) replays the same commands through
the same code and trusts nothing else. Built after `D:\standing\engine` (math, hash, lint) and
`D:\funny\server\engine` (lockstep, replay verification).

## Shape

- `Engine.step` runs `STEP_ORDER`: prologue (interpolation bookkeeping, hitstop freeze), input,
  bodies (timers, reaction states, hero controls, monster brains), physics, separate, combat,
  cleanup, room. The order is part of the contract.
- 2.5D: `x` along the room, `y` depth (0 back, `WORLD.depth` front), `z` height. A hit needs the
  attack box and the target to overlap in x, be within the box's depth in y, and overlap in z
  (`systems/combat.ts`).
- Moves are data (`content.ts`): length, active ticks, box, damage, hitstun, hitstop, push,
  launch and juggle lift, cancel tick and follow-up, forward advance, cooldown.
- `PlayerCommand` is `{ owner, tick, buttons }`: the BTN bits held. Presses, double-tap runs and
  the input buffer are derived inside the sim (`systems/hero.ts`), so every machine agrees.
- Hitstop is per body: `stop` ticks left, and a body with `stop > 0` at the start of a tick is
  `held` (skips its logic and physics) for that tick.
- `SimState` is plain data, PRNG streams included (`math/prng.ts`), so `snapshot()` / `restore()`
  are deep copies: what rollback and reconnects need.
- `SimEvent`s go to the view; `dungeonClear` is what the server grants loot on (from its own replay).
- `bot.ts` plays through ordinary buttons, for tests and headless runs.

## Rules (enforced by `determinismLint.test.ts` and `Engine.test.ts`)

- Integers only in the state: positions in FP (`FP = 1000` per world unit), times in ticks,
  divide with `Math.trunc`. `hashState` throws on a non-integer.
- No `Math.random`, no clocks, no transcendental maths (`isqrt`, `sinB/cosB/atan2B` instead).
- No imports from outside the engine; the tsconfig has no DOM lib.
- Iterate arrays in order wherever the order could affect the state.
- A rules or content change changes the golden hash in `Engine.test.ts`: bump `ENGINE_VERSION`
  and record the new value on purpose.
