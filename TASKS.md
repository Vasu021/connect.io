# Tasks

Status of the build, and what is worth doing next.

---

## Done

### Connections — the 2–8 player game
- [x] Rounds resolve on all-submitted **or** the timer, for whoever is still in
- [x] Matching groups of 2+ form numbered **Connections** and leave the circle
- [x] Deterministic placement when several groups form in one round
- [x] **No-repeat rule**: a word played once is burned for the whole game
- [x] A rejected repeat does not consume the round
- [x] Ends when everyone is connected or one player is left alone
- [x] **Wildcard** for the player left over, **Perfect Circle** when nobody is
- [x] Round cap (15) ends the game `UNMATCHED` with no score
- [x] Idle players removed after three silent rounds
- [x] A drop-out no longer kills the game — play continues while 2+ remain
- [x] 30-second reconnect grace, departures debounced before announcing
- [x] In-progress games survive a restart, including the ban list and placements
- [x] Only `MATCHED` scores; abandoning or forfeiting never reaches the board

### Rooms
- [x] Create with optional name, optional password, size 2–8
- [x] Join by six-character code; invited players skip the password
- [x] Wrong password and unknown code are indistinguishable
- [x] Invite from the friends list **or** by searching every player
- [x] **Friendship is no longer required to play**
- [x] Only the host starts; host can remove players; host transfers on leave
- [x] Room is destroyed when the game ends and everyone is returned home
- [x] One-click two-player room from the friends list, invite included
- [x] Stale lobbies swept after two hours

### Word images
- [x] A Pixabay picture beside every revealed word, prefetched on submit so it
      is ready at the reveal
- [x] Never shown for the round in progress — an image would give the word away
- [x] Cached per normalised word, deduped in flight, token-bucketed under
      Pixabay's 100/min, with a negative cache for words that have no pictures
- [x] Downloaded to our own storage, since Pixabay forbids hotlinking and their
      URLs expire after a day
- [x] Attribution shown wherever images appear
- [x] Pictures sized to the room — 2× at 2–4 players, 1.5× at 5, base at 6–8
- [x] Degrades to nothing at all without an API key, or when Pixabay is down

### Profile pictures
- [x] Twelve hand-drawn animal avatars, chosen from a fixed set — no uploads,
      so nothing to moderate or store
- [x] Picked on your own profile, shown everywhere a player appears
- [x] A new account is given one at random, so nobody starts as a grey monogram
- [x] Eyes blink; an unknown id falls back to initials

### Interface
- [x] The circle: players on a ring, chords snapping to each Connection's hub
- [x] Per-Connection colours, placement badges, live lock-in pips
- [x] Simultaneous reveal with words beside each seat
- [x] Played-words panel, with the input warning before you waste a round
- [x] Last round's words stay on screen while you think — on the circle, in a
      highlighted panel under the input, and in a full round-by-round log
- [x] Those words sized and lit to be read at a glance, with seat collisions at
      eight players checked in the browser
- [x] Long result and friend lists scroll inside their card
- [x] Host-adjustable round length (10–60s) set in the lobby
- [x] Dashboard laid out as purposeful columns, so short cards no longer leave
      holes beside tall ones
- [x] Standings rail, podium result with the Wildcard row
- [x] Confetti and a Perfect Circle banner
- [x] Spectator view once you have connected
- [x] Auto-return to the dashboard once the room is gone
- [x] Avatar initials that actually distinguish `demo1`…`demo8`
- [x] Responsive to 390px; `prefers-reduced-motion` respected
- [x] A "Made by Vasu" signature with GitHub and LinkedIn links

### Data and API
- [x] Schema rebuilt for N players: Room, RoomMember, RoomInvite, Game,
      GamePlayer, Connection, Round, Submission
- [x] All 14 historical two-player games migrated into the new shape
- [x] Leaderboard bucketed by player count, each group listed once at its best
- [x] Stats: best circle, placements, fastest connection, perfect circles,
      wildcards, closest minds
- [x] History with the full round-by-round trail

### Foundation
- [x] 116 server tests, including eight-player secrecy tests for words and images
- [x] Fixed a double-resolve race when players submitted in the same tick
- [x] Dashboard refetches coalesced — eight players no longer trip the limiter
- [x] `npm audit` clean, transitive patches pinned via overrides
- [x] Demo seeder for local eight-player testing

---

## Next

### Worth doing soon
- [ ] **Migrations.** Development still uses `prisma db push`. Before any real
      deploy, switch to `prisma migrate` and commit the migration files.
- [ ] **Client tests.** The server has 87; the client has none. The circle's
      geometry (`seatPosition`, hub averaging) and `GamePage`'s event handlers
      are the parts worth covering.
- [ ] **Rematch.** Rooms are single-use by design, so "run it back" should
      create a fresh room and auto-invite everyone from the last game.
- [ ] **Lobby chat**, or at least a ready-check, so a host knows people are
      actually at their keyboards before starting.
- [ ] **Email verification and password reset.** Neither exists.

### Design questions, not just features
- [ ] **Public rooms.** A browsable list of open rooms would let strangers play
      without an invite. It needs thought about abuse and moderation first.
- [ ] **Near-miss scoring.** `fifa` / `FIFA` already matches. Should
      `football` / `footballs`? It would soften the game and may weaken what a
      score of 1 means. Deliberately unresolved.
- [ ] **Spectating.** Watching a circle close live could be better than reading
      the trail back.
- [ ] **Suggest a round length by room size.** The host can already set 10–60s;
      defaulting a big room to something longer would save them the thought.

### Scale
- [ ] **Horizontal scaling.** Live game state is an in-process `Map` and the
      server is single-instance. Running several copies needs a Socket.IO Redis
      adapter and moving that state out of memory.
- [ ] **Observability.** No structured logging or metrics. Rounds-to-close by
      player count, abandonment rate and placement distribution are the
      interesting signals.

### Known limits
- [ ] **The dashboard refetches six endpoints per change event.** Debounced, but
      eight players behind one address still generate a lot of calls during a
      busy game. Pushing deltas over the socket instead of refetching would fix
      it properly.

### Images, later
- [ ] **Let players turn pictures off.** Some will find them distracting, and a
      slow connection might not want them.
- [ ] **Prune the image store.** Nothing deletes old files yet; a sweep for
      images unused in N months would keep it bounded.
- [ ] **Let a player reroll a picture** they think misrepresents their word.

### Housekeeping
- [ ] Demo accounts (`demo1`…`demo8`, `demo_a`, `demo_b`) and the games they
      generated can be deleted once you are done testing.
- [ ] `server/data/db.json` is gitignored but still on disk; remove it when you
      are satisfied the migration chain is correct.
