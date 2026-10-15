# Tasks

Status of the build, and what is worth doing next.

---

## Done

### The game loop
- [x] Real-time 15-second rounds over Socket.IO, simultaneous reveal
- [x] Round resolves on both submissions **or** the timer expiring
- [x] Exact normalised match ends the game; score = that round number
- [x] Round cap (20) ends a game `UNMATCHED` with no score
- [x] Forfeit (`End game`) ends with no score
- [x] 30-second reconnect grace before a drop abandons the game
- [x] Abandonment and forfeit store `finalScore: null` and stay off the leaderboard
- [x] In-progress games survive a server restart, timers rebuilt from the deadline
- [x] Stale `WAITING` invites swept after an hour

### Closing the invite gap
- [x] Creating a game pushes `game:invited` to the friend's socket
- [x] "Your games" card on the dashboard, live-updated
- [x] Invite banner for games you have been invited to
- [x] Join by 6-character room code
- [x] Open rooms are reused instead of stacking duplicate invites

### Social
- [x] Register, login (username **or** email), logout, session check
- [x] User search with relationship state (friend / sent / received / none)
- [x] Friend request, accept, **reject**, **cancel**, **unfriend**
- [x] Mutual requests auto-accept instead of stacking
- [x] Live online presence, reference-counted across multiple tabs

### Beyond the MVP
- [x] Rematch from the result screen
- [x] Per-player stats: best, average, played, connected, unfinished
- [x] "Closest partners" ranking on a profile
- [x] Game history with the full word-by-word trail
- [x] Pair leaderboard, ranked by best score
- [x] Single-word validation (letters, internal hyphen/apostrophe, no spaces)
- [x] Accent folding, so `café` matches `cafe`

### Foundation
- [x] Postgres + Prisma, replacing the JSON file store
- [x] Legacy `db.json` imported (3 users, 2 friendships, 1 game, 3 rounds)
- [x] Zod-validated environment; the server refuses to start without a real secret
- [x] httpOnly cookie sessions; no token in localStorage
- [x] Rate limiting per route; login counts failures only
- [x] Helmet, CORS allowlist, 16kb body cap, socket event budget
- [x] Account-enumeration resistance on login
- [x] Central error handler; 413/400 no longer surface as 500
- [x] 68 tests: unit, API, and full socket end-to-end
- [x] `npm audit` clean — 0 vulnerabilities, transitive patches pinned via overrides
- [x] `dist/`, `tsbuildinfo` and stray files untracked
- [x] Docker Compose for the dev database
- [x] Dependency-free parallel dev runner

### Interface
- [x] Dark design system built on two identity colours
- [x] Countdown ring that shifts cyan → amber → red
- [x] Simultaneous word reveal with match/miss animation
- [x] Confetti and a counting score orb on a match
- [x] The round trail, surfaced as the artifact it is
- [x] Live opponent status: thinking / locked in / offline
- [x] Toasts, skeletons, empty states
- [x] Responsive to 390px; `prefers-reduced-motion` respected

---

## Next

### Worth doing soon
- [ ] **Migrations.** Development uses `prisma db push`. Before any real deploy,
      switch to `prisma migrate` and commit the migration files.
- [ ] **Client tests.** The server has 68; the client has none. The reducers
      worth covering are `GamePage`'s event handlers and the countdown
      derivation.
- [ ] **Leaderboard paging.** It currently loads up to 500 matched games and
      groups pairs in JS. Fine at this size; wrong at 100k. Move to a grouped SQL
      query with pagination.
- [ ] **Rematch handshake.** Today rematch creates a room and the partner is
      notified. A two-sided "ready?" exchange would feel better than a bare invite.
- [ ] **Email verification and password reset.** Neither exists; both matter
      before a public launch.

### Design questions, not just features
- [ ] **Stranger matchmaking.** A pair score presumes a relationship — matching
      with a stranger measures something else entirely. If it ships, it needs a
      separate queue and its own leaderboard so the numbers never mix.
- [ ] **Near-miss scoring.** `fifa` / `FIFA` already matches. Should `football` /
      `footballs` be a near miss worth something? It would soften the game, and
      might weaken what a score of 1 means. Deliberately unresolved.
- [ ] **Spectating.** The trail is the interesting artifact; watching a pair
      converge live could be better than reading it back.

### Scale
- [ ] **Horizontal scaling.** Live game state is an in-process `Map` and the
      server is single-instance as written. Running several copies needs a
      Socket.IO Redis adapter and moving that state out of memory.
- [ ] **Observability.** No structured logging or metrics. Round duration,
      abandonment rate and score distribution are the interesting signals.

### Housekeeping
- [ ] The two demo accounts (`demo_a`, `demo_b`) created during verification can
      be deleted once you are done poking at the app.
- [ ] `server/data/db.json` is now gitignored but still on disk; remove it once
      you are satisfied the import is correct.
