# CLAUDE.md

Context for AI assistants working in this repo. Read this before changing code.

## What this is

connect.io is a two-player word-association game. Both players submit one word
per 15-second round, blind; the words reveal simultaneously; an exact
(normalised) match ends the game. **The score is the round number they matched
on, and lower is better.**

The score belongs to the **pair**, not the player. That is why the leaderboard
ranks `alice + bob` rather than individuals, and why games are friends-only. Keep
this framing in any copy you write: there is no winner between the two players —
they are playing against the gap between them.

## Stack

npm workspaces: `client` (React 19, Vite 7, React Router 7) and `server` (Node,
Express 5, Socket.IO 4, Prisma 6 → Postgres 16, Zod 4). Tests are vitest, server
side only, 68 of them.

Full architecture is in `DEVELOPMENT_GUIDE.md`. Open tasks are in `TASKS.md`.

## Commands

```bash
npm run dev          # both workspaces, prefixed output
npm test             # server suite (needs the test DB up)
npm run db:up        # Postgres on :5433
npm run db:push      # apply schema
npm run build        # typecheck + build both
```

Typecheck individually with `npx tsc --noEmit` in either workspace. Both are
currently clean; keep them that way.

## Invariants — do not break these

1. **Only a MATCHED game has a score.** `UNMATCHED`, `ABANDONED` and `FORFEITED`
   store `finalScore: null`, and the leaderboard filters on `MATCHED`. A previous
   version let an abandoned game inherit the round it died on, so quitting early
   outranked genuinely connecting. There is a regression test; do not loosen it.

2. **`game:state` is per-socket and never carries the opponent's pending word.**
   It exposes `opponentSubmitted: boolean` only. Broadcasting one shared state
   object to the room would leak the answer before the reveal. Build views with
   `broadcastState()` / `stateFor(game, viewerId)`.

3. **`JWT_SECRET` has no fallback.** The server exits if it is missing or under
   32 characters. Never add a default.

4. **The session is an httpOnly cookie.** There is no token in localStorage and
   no `Authorization: Bearer` path. Socket.IO authenticates from the same cookie.
   Do not introduce a JS-readable token.

5. **Friendships are stored ordered** (`user1Id < user2Id`). Always use
   `orderPair()` from `server/src/lib/friends.ts`.

6. **Never return another user's email.** `/api/users/search` returns id and
   username only.

7. **Every timer must be cleared when a game ends.** `clearTimers()` handles
   `roundTimer`, `nextRoundTimer`, `graceTimers` and `announceTimers`.

## Conventions

- TypeScript strict everywhere, including `noUncheckedIndexedAccess`. Expect to
  handle `undefined` on array access.
- Server imports use explicit `.js` extensions (ESM + `moduleResolution:
  bundler`).
- Validate every input with Zod — bodies, queries, params, and socket payloads.
- Throw the helpers from `lib/errors.ts` (`badRequest`, `forbidden`, `notFound`,
  `conflict`) rather than writing status codes inline. The central handler
  formats them.
- Route order in `games.routes.ts`: literal paths before `/:id`.
- Comments explain **why**, not what. Match the existing density — the engine and
  the security-relevant code are commented; plain CRUD is not.
- Client colour language: cyan is always *you*, violet is always *them*, green is
  a match. Keep it consistent.

## Known traps

- **React StrictMode double-mounts effects in dev.** `GamePage` queues its
  `game:leave` behind a 150ms timer that a remount cancels. Removing that makes
  the server think a player left and broadcast a half-started state to their
  partner.
- **Do not store countdown seconds in state.** Derive them during render from
  `roundDeadline` and a ticking `now`; storing them caused a 0-second red ring to
  flash at the start of every round.
- **Round timings are env-driven** (`ROUND_DURATION_MS`, `REVEAL_PAUSE_MS`,
  `RECONNECT_GRACE_MS`, `PRESENCE_ANNOUNCE_DELAY_MS`, `MAX_ROUNDS`). The test
  suite sets them low. Do not hardcode them back.
- **`PRESENCE_ANNOUNCE_DELAY_MS` must stay below `RECONNECT_GRACE_MS`**, or a
  drop is abandoned before the partner is ever told.
- Tests use a separate database (`connectio_test`) and truncate between cases;
  they cannot run in parallel across files (`fileParallelism: false`).

## Dependencies

`npm audit` is at **0 vulnerabilities**. The root `package.json` has `overrides`
pinning patched transitive versions (`ws`, `engine.io`, `socket.io-parser`,
`socket.io-adapter`, `deepmerge-ts`). If you add or bump a dependency, re-run
`npm audit` and extend the overrides rather than leaving an advisory open.

`concurrently` was deliberately removed in favour of `scripts/dev.mjs` because it
pulls in `shell-quote`, which carries open advisories. Do not add it back.

## Working style here

- The user reviews before anything is committed or pushed. **Do not commit or
  push unless asked.**
- Verify changes by actually running them — `npm test`, and the app at
  http://localhost:5173 — rather than reasoning about whether they work.
