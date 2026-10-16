# CLAUDE.md

Context for AI assistants working in this repo. Read this before changing code.

## What this is

connect.io is a real-time word game for **2–8 players**. Each round every player
still in the circle submits one word blind; all words reveal at once; anyone
whose word matches at least one other player **connects** and leaves the circle
as a numbered **Connection** (#1, #2, …). Play continues until everyone is
connected or one player is left alone.

Two results, and they pull against each other on purpose:

- **Placement** is personal — connect early to place high.
- **Room score** is the round the circle closed. Shared by everyone. Lower is better.

A **Perfect Circle** is nobody left over. The player left alone is the
**Wildcard** — framed as a badge, never a failure. Keep that framing in copy.

At two players this is exactly the original two-player game, which is why it was
safe to generalise. Full rules in `GAME.md`.

## Stack

npm workspaces: `client` (React 19, Vite 7, React Router 7) and `server` (Node,
Express 5, Socket.IO 4, Prisma 6 → Postgres 16, Zod 4). 114 vitest tests, server
side only.

Architecture is in `DEVELOPMENT_GUIDE.md`. Open work is in `TASKS.md`.

## Commands

```bash
npm run dev                          # both workspaces, prefixed output
npm test                             # server suite (needs the test DB up)
npm run db:up && npm run db:push     # Postgres on :5433, then the schema
npm run seed:demo --workspace server # demo1..demo8 for local 8-player testing
npm run build                        # typecheck + build both
```

Typecheck individually with `npx tsc --noEmit` in either workspace. Both are
clean; keep them that way.

## Invariants — do not break these

1. **Only a MATCHED game has a score.** `UNMATCHED`, `ABANDONED` and `FORFEITED`
   store `finalScore: null` and never reach the leaderboard. Quitting must never
   outrank connecting. There are regression tests; do not loosen them.

2. **`game:state` is per-socket and never carries another player's pending
   word.** It exposes `hasSubmitted: boolean` per player and nothing more. With
   eight players there are seven ways to leak instead of one. Build views with
   `broadcastState()` / `stateFor(game, viewerId)` in `server/src/game/engine.ts`.

   *Resolved* rounds are the opposite and are deliberately public: every word
   from a finished round stays on screen while the next one is played, because
   aiming at the middle of what the group just said is the whole skill. The line
   is round boundaries, not words in general.

   Those words are also deliberately **prominent** — 18px on the circle, 20px in
   the panel under the input, full-brightness text. They were once styled as
   subordinate to a live reveal and that was wrong: reading them is the task, so
   they win. The dashed border is the only "this is last round" signal needed.

3. **An image for an unrevealed word *is* that word.** Word images follow the
   same boundary as words: the server prefetches on submit (safe — nothing
   leaves the server), but an image only enters a client payload once its round
   has revealed. `attachImageUpdates()` uses `game.bannedWords.has(word)` as the
   "revealed" test, because a word lands there only when its round resolved.
   There is a test that holds a round open and asserts zero image elements and
   zero `/api/images` requests while the server already has them cached.

4. **Nothing in the game loop may await an image.** `requestImage()` is
   fire-and-forget. If Pixabay is slow, down, throttled or unconfigured, play is
   identical minus the pictures — there is a test for that too.

5. **The no-repeat rule is load-bearing, not a nicety.** Every normalised word
   ever submitted in a game is banned for the rest of it. Without it the
   dominant strategy is "copy the plurality word from last round" and every game
   resolves at round 2. The ban set must survive a restart — `restoreLiveGames()`
   rebuilds it from `Submission.normalized`.

6. **Placement order must be deterministic.** `groupSubmissions()` sorts groups
   by normalised word so that when several form in one round their placements do
   not depend on packet arrival order.

7. **`JWT_SECRET` has no fallback.** The server exits if it is missing or under
   32 characters. Never add a default.

8. **The session is an httpOnly cookie.** No token in localStorage, no
   `Authorization: Bearer` path. Socket.IO authenticates from the same cookie.

9. **Friendship does not gate play.** Anyone can be invited to a room. Friends
   only drive the invite list and presence. Do not reintroduce `areFriends()` as
   a precondition for playing.

10. **A room's existence is not disclosed.** A wrong password and an unknown code
   both return the same 404. Non-members get 404 from `GET /api/rooms/:id`.

11. **Friendships are stored ordered** (`user1Id < user2Id`). Always use
   `orderPair()` from `server/src/lib/friends.ts`.

12. **Never return another user's email.** `/api/users/search` returns id and
    username only.

13. **`resolveRound()` must never run twice for one round.** Two players can
    submit in the same tick: each awaits its persist, each then sees a full
    round, and both call it. The `resolving` flag is set **synchronously before
    any await** for exactly that reason — moving it after one reopens the race,
    which double-counts idle players before the unique index on
    `(gameId, roundNumber)` rejects the duplicate. Covered by "resolves a round
    exactly once when everyone submits at the same instant".

14. **Every timer must be cleared when a game ends.** `clearTimers()` covers
    `roundTimer`, `nextRoundTimer`, `startGraceTimer`, `graceTimers` and
    `announceTimers`.

## Conventions

- TypeScript strict everywhere, including `noUncheckedIndexedAccess`.
- Server imports use explicit `.js` extensions (ESM + bundler resolution).
- Validate every input with Zod — bodies, queries, params, socket payloads.
- Throw the helpers from `lib/errors.ts` rather than inline status codes.
- Route order in `games.routes.ts` / `rooms.routes.ts`: literal paths before `/:id`.
- Comments explain **why**. The engine and security-relevant code are commented;
  plain CRUD is not.
- Colour language: cyan is you, violet is other players, and each Connection
  takes its own hue from `--c1`…`--c8` via `placementColor()`.

## Known traps

- **React StrictMode double-mounts effects in dev.** `GamePage` queues its
  `game:leave` behind a cancellable 150ms timer. Removing it makes the server
  think a player left and broadcast a half-started state to everyone else.
- **Do not store countdown seconds in state.** Derive them during render from
  `roundDeadline` and a ticking `now`, clamped to the round length.
- **Do not refetch on every socket event.** The dashboard coalesces
  `rooms:changed` / `games:changed` / `friend:changed` into one refetch behind a
  350ms timer; eight players on one network otherwise generate hundreds of
  requests in seconds.
- **Round length is per room, not global.** The host sets it in the lobby;
  `Room.roundDurationMs` is copied to `Game.roundDurationMs` at start, and the
  engine reads it off `LiveGame`. `ROUND_DURATION_MS` is now only the default
  for a newly created room. A restored game must keep the length it was played
  at.
- **Other round timings are env-driven** (`REVEAL_PAUSE_MS`,
  `RECONNECT_GRACE_MS`, `PRESENCE_ANNOUNCE_DELAY_MS`, `START_GRACE_MS`,
  `MAX_ROUNDS`, `MAX_MISSED_ROUNDS`). Tests set them low. Never hardcode them back.
- **`PRESENCE_ANNOUNCE_DELAY_MS` must stay below `RECONNECT_GRACE_MS`**, or a
  drop is abandoned before the partner is told.
- **Test words must be letters only.** `validateWord()` rejects digits, so
  `alpha1` silently submits nothing — which once made a test pass for entirely
  the wrong reason.
- **Avatars are a fixed set, never uploads.** `server/src/lib/avatars.ts` is the
  source of truth and the client has a matching drawing per id in
  `AnimalAvatar.tsx`. No uploads means nothing to moderate, nothing to store,
  and nothing unpleasant can end up beside a name. An unknown id falls back to
  initials rather than rendering a hole.
- **Serve image bytes by measuring the file, not the stored byte count.** The
  two can drift — a word re-fetched to the same path picks a different photo —
  and a `Content-Length` that disagrees with the body fails the whole response
  with a 500.
- **The dev proxy must tolerate aborted requests.** A browser closing a tab
  mid-stream makes http-proxy emit an unhandled `error`, which takes the whole
  Vite dev server down. `vite.config.ts` swallows `ECONNRESET` / `EPIPE` /
  `ERR_STREAM_WRITE_AFTER_END`; do not remove that handler.
- **`/api/images` is mounted ahead of `apiLimiter` on purpose.** Eight players
  loading image tags is a burst of cheap cached file reads; counting them
  against the API budget would throttle actual gameplay. Do not move it below
  the limiter.
- **Never hotlink Pixabay.** Their terms forbid it and their URLs expire after
  24 hours, so bytes are downloaded to `IMAGE_STORE_DIR` and served by us.
  Attribution (photographer + link back) must stay visible wherever images show.
- **The dashboard is deliberate columns, not auto-fit.** Its cards differ wildly
  in height and a plain grid sized every row to its tallest card, leaving holes.
  `.dash-col` groups them by purpose — actions, people, you — with the
  leaderboard full width beneath.
- **Seat image size scales with player count** (2× at 2–4 players, 1.5× at 5,
  1× at 6–8) via CSS variables set in `Circle.tsx`. Bigger pictures make seats
  taller, so the ring radius tightens to match — otherwise the top seat
  overflows the card and the bottom one lands on the word box. The browser
  harness checks containment as well as collisions at every player count.
- **Seat width and word size are coupled.** `.seat` width, `.seat-word`
  `font-size` and its `max-width` must move together: a bigger font without a
  wider seat silently truncates words, and a wider seat risks seats colliding at
  eight players. There is a browser check that measures every seat pair for
  overlap with long words — run it after touching either.
- **Prisma reformats the schema**, so column alignment shifts. A whitespace-exact
  find-and-replace against `schema.prisma` can silently match nothing — anchor on
  the field name and check the result before pushing.
- Tests share one database (`connectio_test`) and truncate between cases, so
  `fileParallelism: false`.

## Dependencies

`npm audit` is at **0 vulnerabilities**. Root `package.json` has `overrides`
pinning patched transitive versions (`ws`, `engine.io`, `socket.io-parser`,
`socket.io-adapter`, `deepmerge-ts`). Re-run `npm audit` after any bump and
extend the overrides rather than leaving an advisory open.

`concurrently` was removed deliberately in favour of `scripts/dev.mjs` because it
pulls in `shell-quote`, which carries open advisories. Do not add it back.

## Working style here

- The user reviews before anything is committed or pushed. **Do not commit or
  push unless asked.**
- Verify by running it — `npm test`, and the app at http://localhost:5173 —
  rather than reasoning about whether it works. An eight-player browser harness
  lives in the session scratchpad and is worth rebuilding when touching the arena.
