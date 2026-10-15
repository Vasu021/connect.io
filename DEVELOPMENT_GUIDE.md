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
│  ├─ src/
│  │  ├─ index.ts              Bootstrap: http + socket.io, restore, sweeps
│  │  ├─ app.ts                Express app: helmet, cors, routers
│  │  ├─ env.ts                Zod-validated environment (exits on failure)
│  │  ├─ db.ts                 Prisma client singleton
│  │  ├─ game/
│  │  │  ├─ engine.ts          The round state machine — the heart
│  │  │  ├─ words.ts           normalize / validate / compare
│  │  │  ├─ constants.ts       Timings (env-driven)
│  │  │  └─ types.ts           Player-facing view types
│  │  ├─ realtime/
│  │  │  ├─ sockets.ts         Handshake auth + event handlers
│  │  │  ├─ presence.ts        Reference-counted online tracking
│  │  │  └─ hub.ts             Holds io; emit helpers (avoids import cycles)
│  │  ├─ modules/*.routes.ts   auth / users / friends / games
│  │  └─ lib/                  auth, errors, limits, validation, friends
│  └─ tests/                   68 tests: unit + API + socket end-to-end
└─ client/
   ├─ src/
   │  ├─ lib/                  api, auth context, socket context, types, format
   │  ├─ components/           Brand, Avatar, CountdownRing, Reveal, RoundTrail, Confetti
   │  ├─ pages/                Login, Register, Dashboard, Game, History, Profile
   │  └─ styles/app.css        The whole design system
   └─ vite.config.ts           Proxies /api and /socket.io in dev
```

---

## 3. The game engine

`server/src/game/engine.ts` owns every in-progress game.

**Memory is the source of truth while a game runs; Postgres is the durable
mirror.** Rounds last 15 seconds and resolve on a `setTimeout`, which is a
terrible fit for a database poll — so live state lives in a `Map<gameId,
LiveGame>` and is written through to the `Game` row on every transition.

### Lifecycle

```
createGame        → WAITING row + invite pushed to the friend
both players join → ACTIVE, startedAt set, round 1 begins
startRound        → currentRound++, deadline = now + 15s, timer armed
  both submit     → timer cleared, resolve immediately
  timer fires     → resolve with whatever was submitted (possibly nothing)
resolveRound      → write a Round row, emit the reveal
  matched         → endGame(MATCHED, score = round number)
  round 20        → endGame(UNMATCHED, no score)
  otherwise       → pause 3.5s, startRound again
endGame           → COMPLETED + outcome, timers cleared, dropped from memory
```

### The scoring rule

Only `outcome: MATCHED` carries a `finalScore`. `UNMATCHED`, `ABANDONED` and
`FORFEITED` all store `null`, and the leaderboard filters on `MATCHED`.

This is load-bearing. An earlier version defaulted an abandoned game's score to
the round it died on, which meant **quitting at round 2 outranked genuinely
connecting at round 3**. There is a regression test for it
(`tests/game.test.ts` → "abandons without a score when a player does not come
back") — do not loosen it.

### Timers on a LiveGame

| Timer | Purpose |
|---|---|
| `roundTimer` | Ends the current round at the deadline |
| `nextRoundTimer` | The 3.5s pause after a reveal |
| `graceTimers` | Per-player 30s reconnect window; firing abandons the game |
| `announceTimers` | Per-player 1.5s debounce before telling the partner they dropped |

`clearTimers()` clears all four. Anything that ends a game must call it, or the
process will not exit and a dead game can still fire.

### Presence has two layers

Deliberately separate:

- **`presence.ts`** — reference-counted global online/offline. One user may hold
  several sockets (two tabs, phone + laptop), so transitions only fire on the
  first and last socket.
- **The announcement debounce** — a drop is not announced to the other player for
  1.5s. Most drops (a wifi blip, a React remount) resolve inside that window, and
  announcing them produces a flickering "dropped / back" toast.

`game:presence` carries `announced: boolean`. The client always updates the
online dot from it, but only raises a toast when `announced` is true.

### Restart recovery

`restoreLiveGames()` runs at boot, reloads every `WAITING`/`ACTIVE` row, and
rebuilds timers from the persisted `roundDeadline` — resolving immediately if the
deadline passed while the process was down. `sweepStaleInvites()` runs at boot
and every 10 minutes to retire invitations nobody accepted within an hour.

---

## 4. Data model

See `server/prisma/schema.prisma`. Five models:

- **User** — `usernameLower` is a unique lowercase mirror of `username`, so
  lookups and uniqueness are case-insensitive without a Postgres-specific
  `citext` column.
- **FriendRequest** — `PENDING | ACCEPTED | REJECTED | CANCELLED`. All four are
  reachable; every transition is authorised to one specific party.
- **Friendship** — undirected, stored with `user1Id < user2Id` so a single
  unique constraint rejects duplicates regardless of who asked. Use
  `orderPair()` from `lib/friends.ts` — never construct the pair by hand.
- **Game** — carries both the result (`status`, `outcome`, `finalScore`) and the
  live snapshot (`currentRound`, `roundDeadline`, `submissions` JSON) that makes
  restart recovery possible.
- **Round** — one row per resolved round, unique on `(gameId, roundNumber)`.

---

## 5. HTTP API

All routes are JSON and sit under `/api`. Everything except `/api/health` and
the auth entry points requires a session cookie.

```
POST   /api/auth/register          { username, email, password } → sets cookie
POST   /api/auth/login             { identifier, password }      → sets cookie
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/users/search?q=        id + username only — never email
GET    /api/users/:id/stats        record + closest partners

GET    /api/friends
GET    /api/friends/requests       { incoming, outgoing }
POST   /api/friends/request        { toUserId }  (auto-accepts a mutual request)
POST   /api/friends/requests/:id/accept
POST   /api/friends/requests/:id/reject
DELETE /api/friends/requests/:id   cancel one you sent
DELETE /api/friends/:friendId      unfriend

POST   /api/games                  { friendId } — friends only; reuses an open room
POST   /api/games/join             { roomCode }
GET    /api/games/active
GET    /api/games/history?limit=
GET    /api/games/leaderboard      pairs, best score ascending
GET    /api/games/:id              live view, or the DB view once completed
POST   /api/games/:id/rematch
```

Route order matters in `games.routes.ts`: the literal paths (`/active`,
`/history`, `/leaderboard`, `/join`) are declared before `/:id`.

---

## 6. Realtime protocol

Socket.IO authenticates from the same httpOnly cookie as the REST API — the
handshake is parsed in `realtime/sockets.ts`. Every connection joins a private
`user:<id>` room so invites and presence can be pushed without a game.

**Client → server**

| Event | Payload |
|---|---|
| `game:join` | `{ gameId }` |
| `game:submit` | `{ gameId, word }` |
| `game:forfeit` | `{ gameId }` |
| `game:leave` | `{ gameId }` |

**Server → client**

| Event | When |
|---|---|
| `session:ready` | On connect |
| `game:state` | Personalised snapshot — one per socket, never shared |
| `game:started` | Both players present |
| `round:started` | `{ roundNumber, deadlineAt, durationMs }` |
| `round:revealed` | Both words, match verdict, full trail |
| `game:ended` | `{ outcome, finalScore, rounds, reason }` |
| `game:presence` | Opponent online/offline (`announced` gates the toast) |
| `game:invited` | Pushed to the invited friend's user room |
| `games:changed` | Hint to refetch dashboard lists |
| `friend:request_received` / `friend:request_accepted` / `friend:changed` | Social updates |
| `presence:friend` | A friend came online or went offline |
| `game:error` | Rejected action, with a human-readable message |

### The one rule you must not break

`game:state` is built **per socket** via `broadcastState()`, and it carries
`opponentSubmitted: boolean` — never the opponent's pending word. Sending the
whole room one shared state object would leak the other player's answer before
the reveal and make the game trivially cheatable from devtools. There is a test
for this ("never reveals the opponent's word before the reveal").

---

## 7. Security

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

## 8. Frontend

**State** lives in three contexts: `AuthProvider` (who you are — it asks the
server, since the cookie is unreadable from JS), `SocketProvider` (one socket for
the whole app) and `ToastProvider`.

One socket matters: the dashboard needs it for invites and presence, the game
room needs it for rounds, and a second connection would make the server see the
same player twice.

**Dev proxying.** `vite.config.ts` proxies `/api` and `/socket.io` to :4000, so
the browser only ever talks to one origin and the session cookie stays
first-party. `VITE_API_URL` is only needed for a split-origin deployment.

**Design system** is `src/styles/app.css`, built from two colours: cyan is always
*you*, violet is always *them*, green is the moment you become the same word. It
is dark-only by deliberate choice and respects `prefers-reduced-motion`.

### Two traps worth knowing

- **Never store derived countdown time in state.** It is computed during render
  from `roundDeadline` and a ticking `now`. Storing it meant the first paint of a
  round rendered `0s` — an empty, urgent-red ring that then swept back to full.
- **React StrictMode double-mounts effects in dev.** `GamePage`'s cleanup queues
  `game:leave` behind a 150ms timer that a remount cancels. Without it, a remount
  tells the server you left, which broadcasts a half-started game state to your
  partner.

---

## 9. Testing

```bash
npm test                              # all 68
npx vitest run tests/game.test.ts --workspace server
```

The suite runs against a **separate database** (`connectio_test`), configured in
`server/vitest.config.ts`, and truncates every table before each test. Round
timings are env-driven, so the socket tests drive the real engine at 700ms
rounds instead of waiting out 15 seconds.

| File | Covers |
|---|---|
| `words.test.ts` | Normalisation, validation, matching |
| `presence.test.ts` | Reference-counted online tracking |
| `api.test.ts` | Auth, cookies, enumeration resistance, friends, authorisation, limits |
| `game.test.ts` | Full socket games: match, timeout, round cap, abandonment, forfeit, reconnect, restart recovery, word secrecy |

When you touch the engine, run `game.test.ts` — it is where the real behaviour is
pinned down.

---

## 10. Deploying

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
