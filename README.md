<div align="center">

# connect.io

### Eight people. One word each. Fifteen seconds.

**How closely do you actually think alike?**

</div>

---

## One game, start to finish

Everyone types a single word, blind. Nobody sees anybody else's until the clock runs out — then all of them land at once.

**Round 1.** A shot in the dark. Nobody has anything to go on yet.

```
elephant    mountain    hurricane    butterfly
telescope   waterfall   lightning    orchestra
```

Nothing matches. But now all eight of you have seen all eight words, and that changes everything about round two.

**Round 2.** You can feel the shape of the group now. Three people reach for the same idea at the same time.

```
storm   storm   storm   ocean
violin  river   compass sonata
```

> **Connection #1 — _storm_.** Three players leave the circle together. Five left.

**Round 3.** Fewer minds to find, and the obvious words are gone.

```
rain   rain   needle   cello   horizon
```

> **Connection #2 — _rain_.** Three left.

**Round 4.** Down to the last three. This is the tense bit.

```
north   north   quiver
```

> **Connection #3 — _north_.** One player left standing.

The circle closed in **4 rounds**. That's your score, and it belongs to all eight of you.

The player left alone is the **Wildcard** — nobody else was in that head. It's a badge, not a loss.

---

## Where it gets hard

Here's the rule that turns this from a coin flip into a game:

> ### A word played once can never be played again. By anyone. Ever.

Take it away and round two becomes "everybody copies the most popular word from round one", every game ends immediately, and nothing interesting ever happens.

Keep it, and you can't retreat to the obvious. You have to find a **new** middle every single round — and the words spiral inward as the group closes on something none of you could have named at the start:

```
king  →  messi  →  fifa
```

That trail is the good bit. connect.io keeps every word on screen while you play, not buried in a log afterwards. The only thing you never see is what someone wrote **this** round, until it reveals.

---

## Two ways to be good at this

|  |  |
|---|---|
| **Placement** | Yours alone. Get out first and you're **#1**. |
| **Room score** | Everyone's. The round the circle finally closed. |

They pull against each other, which is the point. You want out early; the group wants the whole thing over fast.

And then there's the thing to actually chase: a **Perfect Circle**, where nobody is left over at all. It's possible at any size, because a Connection can be three, four, five people who all happened to think the same thing.

At two players, by the way, this is the original game untouched: you match, you both connect, and the score is the round you landed on. Everything above is just that game with more minds in the room. Full rules in [`GAME.md`](./GAME.md).

---

## What's in it

|  |  |
|---|---|
| **Rooms** | Name it, password it, size it anywhere from 2 to 8 |
| **Anyone can play** | Invite from your friends list or search every player — **friendship is not a requirement** |
| **Join by code** | Six readable characters like `K7MW2P`. Invited players skip the password |
| **Host controls** | Only the host starts, sets the round length (10–60s), and can remove players |
| **Nothing to memorise** | Every word already said stays on screen, big and legible — beside whoever said it, under your word box, and in a full round log |
| **A picture per word** | Revealed words get a small image from Pixabay, so the group's drift is something you can see. Never for the round in progress — that would give the word away |
| **The live circle** | Chords snap between players the instant a Connection forms |
| **Reconnect** | Drop out mid-game and you've got 30 seconds to get back before the circle moves on without you |
| **Leaderboard** | Fastest circles, bucketed by player count, each group listed at its best |
| **History** | Every finished game, word by word |
| **Profile** | Best circle, average placement, the people you connect with fastest — and a cat, a giraffe or a koala to put beside your name |

---

## Run it yourself

You'll need **Node 20+** and **Docker** (for Postgres).

```bash
git clone <your-fork-url> connect.io
cd connect.io

npm install
npm run db:up        # Postgres on port 5433
npm run db:push      # create the schema
```

Give it a real secret:

```bash
cp server/.env.example server/.env
echo "JWT_SECRET=\"$(openssl rand -hex 32)\"" >> server/.env
```

Optionally, for pictures beside the words — grab a free key from
[Pixabay](https://pixabay.com/api/docs/):

```bash
echo 'PIXABAY_API_KEY="your-key"' >> server/.env
```

Skip it and everything works, just without images.

Then:

```bash
npm run dev
```

- App → **http://localhost:5173**
- API → http://localhost:4000

### Playing eight-up on your own machine

Eight sign-up forms is nobody's idea of fun, so:

```bash
npm run seed:demo --workspace server
```

You get `demo1` … `demo8`, password `connect-io-demo-pass`, all friends with `demo1`. Open them in separate browser profiles or incognito windows, make a room as `demo1`, invite the rest, start.

It's more fun with actual other people, but it's a very good way to watch the circle close.

---

## Under the hood

**Frontend** React 19 · TypeScript · Vite · React Router · Socket.IO client
**Backend** Node · Express 5 · Socket.IO · Prisma · PostgreSQL · Zod
**Security** httpOnly cookie sessions, bcrypt, Helmet, per-route rate limiting

Word images come from Pixabay, fetched server-side the moment a word is
submitted so they are ready at the reveal, cached per word so a repeat costs
nothing, and downloaded to our own storage because Pixabay forbids hotlinking.
With no API key configured the feature simply switches off and the game plays
exactly as it otherwise would.

Live game state lives in memory — fifteen-second rounds are a bad fit for polling a database — with Postgres as the durable mirror, so an in-progress game survives a server restart with its timers, its placements and its banned-word list intact.

`npm test` runs **114 server tests**: the round engine, group formation and placement ordering, the no-repeat rule, scoring, abandonment, rooms and authorisation — including one that drives eight clients at once and checks nobody's pending word ever leaks into anybody else's state.

---

## License

MIT
