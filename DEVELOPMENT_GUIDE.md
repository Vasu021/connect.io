# Development guide

Everything you need to work on connect.io: how it is put together, why it is put
together that way, and how to change it safely.

---

## 1. Setup

**Prerequisites:** Node 20+ (developed on 26), Docker, npm 10+.

```bash
npm install                 # installs root + both workspaces
npm run db:up               # Postgres 16 on :5433 (docker compose)
cp server/.env.example server/.env
echo "JWT_SECRET=\"$(openssl rand -hex 32)\"" >> server/.env
npm run db:push             # applies the Prisma schema
npm run dev                 # server :4000 + client :5173
```

If npm blocks install scripts, approve the ones Prisma and esbuild need:

```bash
npm install-scripts approve prisma @prisma/client @prisma/engines esbuild
npm install
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs both workspaces with prefixed output (`scripts/dev.mjs`) |
| `npm run build` | Typechecks and builds server then client |
| `npm test` | Server test suite (vitest) |
| `npm run db:up` / `db:down` | Start/stop the Postgres container |
| `npm run db:push` | Push the Prisma schema (dev; no migration files) |
| `npm run db:studio` | Prisma Studio |
| `npm run seed:import --workspace server` | One-off import of the legacy `server/data/db.json` |

---

## 2. Layout

```
connect.io/
├─ docker-compose.yml          Postgres 16 for local dev (port 5433)
├─ scripts/dev.mjs             Dependency-free parallel dev runner
├─ server/
│  ├─ prisma/schema.prisma     Data model
│  ├─ scripts/                 export-legacy-games, backfill-multiplayer,
│  │                           import-json, seed-demo
│  ├─ src/
│  │  ├─ index.ts              Bootstrap: http + socket.io, restore, sweeps
│  │  ├─ app.ts                Express app: helmet, cors, routers
│  │  ├─ env.ts                Zod-validated environment (exits on failure)
│  │  ├─ db.ts                 Prisma client singleton
│  │  ├─ game/
│  │  │  ├─ engine.ts          The round state machine — the heart
│  │  │  ├─ grouping.ts        Pure: submissions → Connections, deterministic
│  │  │  ├─ words.ts           normalize / validate / compare
│  │  │  ├─ constants.ts       Timings and limits (env-driven)
│  │  │  └─ types.ts           Player-facing view types
│  │  ├─ room/rooms.ts         Lobbies: create, join, invite, start, sweep
│  │  ├─ realtime/
│  │  │  ├─ sockets.ts         Handshake auth + event handlers
│  │  │  ├─ presence.ts        Reference-counted online tracking
│  │  │  └─ hub.ts             Holds io; emit helpers (avoids import cycles)
│  │  ├─ modules/*.routes.ts   auth / users / friends / rooms / games
│  │  └─ lib/                  auth, errors, limits, validation, friends, codes
│  └─ tests/                   91 tests: unit + API + socket end-to-end
└─ client/
   ├─ src/
   │  ├─ lib/                  api, auth, socket, types, format, placement
   │  ├─ components/           Circle, Standings, PlayedWords, CountdownRing,
   │  │                        Avatar, Brand, Confetti
   │  ├─ pages/                Login, Register, Dashboard, Room, Game,
   │  │                        History, Profile
   │  └─ styles/app.css        The whole design system
   └─ vite.config.ts           Proxies /api and /socket.io in dev
```

---

## 3. The game engine

`server/src/game/engine.ts` owns every in-progress game.

**Memory is the source of truth while a game runs; Postgres is the durable
mirror.** Rounds last 15 seconds and resolve on a `setTimeout`, which is a
terrible fit for a database poll — so live state lives in a `Map<gameId,
LiveGame>` and is written through on every transition.

### Lifecycle

```
host starts room  → WAITING game + GamePlayer rows, everyone notified
all players join  → ACTIVE (or after START_GRACE_MS, so one straggler
                    cannot hold the rest hostage)
startRound        → currentRound++, deadline = now + 15s, timer armed
  all active submit → timer cleared, resolve immediately
  timer fires       → resolve with whatever arrived
resolveRound      → group words, form Connections, burn the words
  ≤1 active left    → endGame(MATCHED, score = this round)
  round cap         → endGame(UNMATCHED, no score)
  otherwise         → pause, startRound again
endGame           → COMPLETED + outcome, room CLOSED, timers cleared,
                    dropped from memory
```

### resolveRound, step by step

1. Collect submissions from players whose status is `ACTIVE`.
2. Bump `missedRounds` for anyone silent; three in a row marks them `LEFT`, so
   one idle tab cannot stall seven people. **This is persisted** — a restart
   must not resurrect someone already nudged out.
3. `groupSubmissions()` (in `grouping.ts`, a pure function with its own unit
   tests) buckets by `normalizeWord` and returns groups of two or more, **sorted
   by normalised word**. That ordering is what makes placement deterministic
   when several groups form in the same round.
4. Each group becomes a `Connection` at the next placement; its members go
   `CONNECTED` with that placement and round.
5. Every word submitted is added to the ban set, matched or not.
6. If one or zero players remain active, the circle has closed.

### The scoring rule

Only `outcome: MATCHED` carries a `finalScore`. `UNMATCHED`, `ABANDONED` and
`FORFEITED` all store `null`, and the leaderboard filters on `MATCHED`.

This is load-bearing. An earlier version defaulted an abandoned game's score to
the round it died on, which meant quitting at round 2 outranked genuinely
connecting at round 3. There are regression tests — do not loosen them.

`perfectCircle` is true only when **every** player who started ended up
`CONNECTED`: nobody left over, nobody dropped out.

### The no-repeat rule

Every normalised word submitted in a game is banned for the rest of it. This is
not a nicety — without it the dominant strategy is "copy the plurality word from
last round" and every game resolves at round two. A rejected repeat **does not
consume the round**: the player can try again before the clock runs out.

The ban set must survive a restart; `restoreLiveGames()` rebuilds it from
`Submission.normalized`.

### Timers on a LiveGame

| Timer | Purpose |
|---|---|
| `roundTimer` | Ends the current round at the deadline |
| `nextRoundTimer` | The pause after a reveal |
| `startGraceTimer` | Begins play even if someone never opens the room |
| `graceTimers` | Per-player 30s reconnect window; firing removes them |
| `announceTimers` | Per-player debounce before telling the room they dropped |

`clearTimers()` clears all five. Anything that ends a game must call it.

### Disconnects at N players

A drop no longer kills the game. After the grace window the player is marked
`LEFT` and removed from the circle; play continues while two or more remain.
If the field falls to one, the game ends — `MATCHED` if at least two people had
actually connected, `ABANDONED` otherwise. At two players that collapses to the
original behaviour exactly.

### Presence has two layers

- **`presence.ts`** — reference-counted global online/offline. One user may hold
  several sockets, so transitions fire only on the first and last.
- **The announcement debounce** — a drop is not announced for
  `PRESENCE_ANNOUNCE_DELAY_MS`. Most drops resolve inside that window, and
  announcing them produces a flickering "dropped / back" toast.

`game:presence` carries `announced: boolean`. The client always updates the
online dot; it only raises a toast when `announced` is true.

---

## 4. Rooms

`server/src/room/rooms.ts`. Rooms are **DB-backed with no in-memory mirror** —
lobby changes are rare, unlike 15-second rounds, so the extra state is not worth
keeping in sync. Lobby broadcasts go to a `room:<id>` socket room.

- **Password vs invite.** An explicit invite authorises the user, so they join
  without the password. Anyone else joining by code must supply it. A wrong
  password and an unknown code fail **identically**, so the endpoint cannot be
  used to discover which rooms exist.
- **Host transfer.** The host leaving passes the role to the next member; the
  last person out closes the room.
- **Rooms are single-use.** `endGame()` sets the room `CLOSED`, so its code stops
  working the moment the game ends. The result lives on in history.
- `sweepStaleRooms()` retires lobbies nobody started within two hours.

---

## 5. Data model

See `server/prisma/schema.prisma`.

- **User** — `usernameLower` is a unique lowercase mirror, so lookups are
  case-insensitive without a Postgres-specific `citext` column.
- **Room / RoomMember / RoomInvite** — the lobby. `passwordHash` is bcrypt;
  null means open to anyone with the code. `roundDurationMs` is host-set and
  copied onto the Game at start, so a finished or restored game keeps the length
  it was actually played at.
- **Game** — result (`status`, `outcome`, `finalScore`, `playerCount`,
  `perfectCircle`) plus the live snapshot (`currentRound`, `roundDeadline`,
  `submissions` JSON) that makes restart recovery possible.
- **GamePlayer** — one row per seat, carrying `status`, `placement`,
  `connectedAtRound` and `missedRounds`.
- **Connection** — a group that left the circle together, unique on
  `(gameId, placement)`.
- **Round / Submission** — one `Submission` per player per round. `normalized`
  is the output of `normalizeWord()` and is what both matching and the no-repeat
  rule compare on; `gameId` is denormalised onto it so the per-game ban lookup is
  a single indexed query rather than a join.
- **Friendship / FriendRequest** — unchanged, and no longer gate play.

### Migrating from the two-player schema

`scripts/export-legacy-games.ts` snapshots the old `Game`/`Round` rows;
`scripts/backfill-multiplayer.ts` rebuilds them in the new shape — a closed
two-player `Room` each, `GamePlayer` rows from `player1Id`/`player2Id`,
`Submission` rows from `player1Word`/`player2Word`, and a single `Connection` at
placement 1 for games that matched. That is exactly what the new rules produce at
two players, so old history stays truthful. Both are idempotent.

---

## 6. HTTP API

All routes are JSON under `/api`. Everything except `/api/health` and the auth
entry points requires a session cookie.

```
POST   /api/auth/register | login | logout          GET /api/auth/me

GET    /api/users/search?q=        id + username only — never email
GET    /api/users/:id/stats        record, placements, closest minds

GET    /api/friends                               GET /api/friends/requests
POST   /api/friends/request                       POST /api/friends/requests/:id/accept
POST   /api/friends/requests/:id/reject           DELETE /api/friends/requests/:id
DELETE /api/friends/:friendId

POST   /api/rooms                  { name?, password?, maxPlayers }
POST   /api/rooms/quick            { friendId } — two-player room, pre-invited
POST   /api/rooms/join             { code, password? }
GET    /api/rooms/mine | /invites
GET    /api/rooms/:id              members only; non-members get 404
POST   /api/rooms/:id/invite       { userId } — anyone, friend or not
POST   /api/rooms/:id/settings     { roundDurationMs?, maxPlayers? } — host, lobby only
POST   /api/rooms/:id/start        host only, 2 ≤ members ≤ maxPlayers
POST   /api/rooms/:id/leave | /decline
DELETE /api/rooms/:id/members/:userId   host kick

GET    /api/games/active | /history?limit=
GET    /api/games/leaderboard?size=N
GET    /api/games/:id              live view, or the DB view once finished
```

Route order matters: literal paths are declared before `/:id`.

The leaderboard is **bucketed by player count**, and within a bucket each
distinct group appears once at its best circle — otherwise one group that plays
a lot simply fills the board with itself.

---

## 7. Realtime protocol

Socket.IO authenticates from the same httpOnly cookie as the REST API. Every
connection joins a private `user:<id>` room; lobbies use `room:<id>` and games
use `game:<id>`.

**Client → server:** `room:join`, `room:leave`, `game:join`, `game:submit`,
`game:forfeit`, `game:leave`.

**Server → client**

| Event | When |
|---|---|
| `session:ready` | On connect |
| `room:state` / `room:changed` | Lobby membership or host changed |
| `room:invited` / `room:kicked` / `room:closed` | Pushed to the user's own room |
| `room:game_started` | The host started; clients navigate to the game |
| `game:state` | Personalised snapshot — one per socket, never shared |
| `round:started` | `{ roundNumber, deadlineAt, durationMs, activeCount }` |
| `round:revealed` | Every word, the groups that formed, the played-word list |
| `connection:formed` | `{ placement, word, memberIds, roundNumber }` |
| `player:left` | A drop-out or an idle removal |
| `game:ended` | `{ outcome, finalScore, perfectCircle, connections, wildcardId }` |
| `game:presence` | Online/offline (`announced` gates the toast) |
| `games:changed` / `rooms:changed` | Hints to refetch dashboard lists |
| `game:error` | A rejected action, with a human-readable message |

### The rule you must not break

`game:state` is built **per socket** and exposes `hasSubmitted` per player, never
the word. With eight players there are seven ways to leak a pending word instead
of one. There is a test that drives eight clients and asserts no viewer's payload
contains anyone else's secret.

The boundary is the round, not the word. Once a round resolves its words are
public and **stay on screen** — on the circle beside whoever said them, pinned
under the word box, and in a full round log. Convergence is impossible if players
have three seconds to memorise eight words, so `state.rounds` carries the whole
record and the client renders it continuously.

## 8. Security

| Concern | How it is handled |
|---|---|
| Session storage | JWT in an **httpOnly** cookie — XSS cannot read it. No token in localStorage. |
| Token forgery | `HS256` pinned on verify (`algorithms: ['HS256']`) to block algorithm confusion; issuer checked. |
| Secrets | `JWT_SECRET` is required and must be ≥32 chars. The server **exits** if it is missing — there is no dev fallback. |
| Passwords | bcrypt cost 12, minimum 10 characters, capped at 200 so a huge input cannot burn CPU. |
| Account enumeration | Login returns one message for "wrong password" and "no such user", and always runs a bcrypt compare (against a dummy hash) so the timing matches. |
| Brute force | `express-rate-limit` per route; login counts **failures only**, so a legitimate user signing in often is never locked out. |
| Data exposure | User search returns id + username only. Email is never returned for anyone but yourself. |
| Authorisation | Every friend-request transition checks the specific party; games check membership. A room code resolved by a non-player returns **404, not 403**, so the room's existence is not disclosed. |
| Input | Zod on every body, query and param, plus a second validation pass on socket payloads. |
| Payload size | JSON capped at 16kb; socket buffer at 8kb. Oversized bodies return 413. |
| Socket flooding | Per-socket budget of 60 events / 10s. |
| Headers | Helmet; `x-powered-by` disabled. |
| Proxies | `trust proxy` is **off** unless `TRUST_PROXY=true`, so X-Forwarded-For cannot be spoofed to evade rate limits. |
| Errors | Central handler. Unknown errors log server-side and return a generic message in production. |

Dependencies are pinned clean: `npm audit` reports **0 vulnerabilities**, with
`overrides` in the root `package.json` forcing patched transitive versions of
`ws`, `engine.io` and the Socket.IO parser/adapter.

---

## 9. Frontend

**State** lives in three contexts: `AuthProvider` (who you are — it asks the
server, since the cookie is unreadable from JS), `SocketProvider` (one socket for
the whole app) and `ToastProvider`.

One socket matters: the dashboard needs it for invites and presence, the lobby
for membership, the arena for rounds. A second connection would make the server
see the same player twice.

**The circle** (`components/Circle.tsx`) is the centrepiece. Players sit at fixed
angles by seat index; connected players move to an inner radius. Each Connection
draws chords from its members to a hub placed at the **average of its members'
angles, computed from unit vectors** — averaging the angles directly would send a
group spanning 12 o'clock to the opposite side of the circle. Colours come from
`placementColor()` so Connection #1 and #2 never read as the same group.

**Showing the round just gone.** `state.rounds` carries every submission, and
the client renders the most recent round in three places at once: beside each
player on the circle (`.seat-word-previous`), in a highlighted panel under the
word box (`LastRound`), and in a scrollable full log (`RoundHistory`). All three
are intentionally large and bright — a player cannot aim at the middle of words
they had three seconds to memorise.

Seat geometry constrains this: `.seat` width, `.seat-word` font size and its
`max-width` move together, and widening them too far makes seats collide at
eight players. The browser harness measures every seat pair for overlap using
deliberately long words, so changes here are checkable rather than guessed at.

**Long lists scroll in place.** `.rows-scroll` caps a list at ~324px with
`overscroll-behavior: contain`. Search results, the friends list and the lobby's
invite list all use it; without it a long list stretches its card and drags the
whole dashboard grid out of shape.

**Dev proxying.** `vite.config.ts` proxies `/api` and `/socket.io` to :4000, so
the browser talks to one origin and the session cookie stays first-party.
`VITE_API_URL` is only needed for a split-origin deployment.

### Traps worth knowing

- **Never store derived countdown time in state.** It is computed during render
  from `roundDeadline` and a ticking `now`, clamped to the round length. Storing
  it meant the first paint of a round showed `0s` — an empty, urgent-red ring.
- **React StrictMode double-mounts effects in dev.** `GamePage`'s cleanup queues
  `game:leave` behind a 150ms timer that a remount cancels. Without it, a remount
  tells the server you left, broadcasting a half-started game to everyone else.
- **Do not refetch per socket event.** The dashboard coalesces `*:changed` into
  one refetch behind a 350ms timer. Eight players on one network otherwise
  generate hundreds of requests in seconds — enough to trip the rate limiter.

---

## 10. Testing

```bash
npm test                                   # all 91
npx vitest run tests/game.test.ts          # from server/
```

The suite runs against a **separate database** (`connectio_test`) and truncates
every table before each test. Round timings are env-driven, so the socket tests
drive the real engine at 700ms rounds instead of waiting out 15 seconds.

| File | Covers |
|---|---|
| `words.test.ts` | Normalisation, validation, matching |
| `grouping.test.ts` | Group formation, deterministic placement order |
| `presence.test.ts` | Reference-counted online tracking |
| `api.test.ts` | Auth, cookies, enumeration resistance, friends, rooms, authorisation |
| `game.test.ts` | Full socket games at 2–8 players |

`game.test.ts` is where the real behaviour is pinned: multi-group rounds, the
no-repeat rule, the Wildcard and Perfect Circle endings, the round cap, idle
removal, drop-outs, forfeits, leaderboard bucketing, restart recovery, and word
secrecy across eight clients. Run it whenever you touch the engine.

**Test words must be letters only.** `validateWord()` rejects digits, so a word
like `alpha1` silently submits nothing — which once made an idle-removal test
pass for entirely the wrong reason.

For the interface, drive a real browser. An eight-context playwright-core
harness (pointed at the local Brave binary, so no Chromium download) covers room
creation, both invite paths, password enforcement, the circle, placements, the
no-repeat warning, the podium and the mobile layout.

---

## 11. Deploying

1. Provision Postgres; set `DATABASE_URL`.
2. Generate a real `JWT_SECRET` (`openssl rand -hex 32`).
3. Set `NODE_ENV=production`, `CLIENT_ORIGIN` to the client's URL, and
   `COOKIE_SECURE=true` behind HTTPS.
4. Serve the API and the client from the **same registrable domain** if you can —
   then `COOKIE_SAMESITE=lax` works and CSRF is handled by the browser. Only use
   `COOKIE_SAMESITE=none` (which requires `COOKIE_SECURE=true`) for a split
   domain.
5. `npm run build`, then `npm start --workspace server` and serve `client/dist`
   as static files.
6. Switch `prisma db push` for `prisma migrate deploy` and commit migrations.

Game state is in-process, so the server is **single-instance** as written. Running
several copies needs a Socket.IO Redis adapter plus moving the `live` map out of
memory — see `TASKS.md`.
