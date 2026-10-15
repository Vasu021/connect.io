<div align="center">

# connect.io

**How closely do you lot actually think alike?**

A real-time word game for 2–8 players that turns a group's shared instinct into a number.

</div>

---

## The idea

Everyone sits in a circle. Each round you get **15 seconds to type one word**, submitted blind. Then every word reveals at once.

**Say the same word as anyone else and you connect.** You leave the circle together as a numbered Connection — the first group out is **#1**, the next **#2** — and then you watch the rest.

Play until everyone is connected, or one player is left alone.

```
Round 3    a · d · e   all say "ocean"     →  Connection #1     5 left
Round 5    b · c       both say "signal"   →  Connection #2     3 left
Round 6    f · g       both say "amber"    →  Connection #3     1 left

h is the Wildcard. The circle closed in 6 rounds.
```

**Lower is better.**

## The one rule that makes it a game

**A word played once can never be played again — by anyone.**

Without it, round two is just "everyone copies the most popular word from round one" and every game ends immediately. With it, you have to find a *new* middle every round, and the words spiral inward:

```
king → messi → fifa
```

That trail is the interesting part, and connect.io keeps every one of them — on
screen while you play, not just in the history afterwards. The one thing you
never see is what anyone wrote **this** round, until it reveals.

## Two things to be good at

|  |  |
|---|---|
| **Placement** | Personal. Connect early and you're #1. |
| **Room score** | Shared. The round the circle finally closed — everyone wants it low. |

A **Perfect Circle** is when nobody is left over. It's possible at any player count, because a Connection can be three or more people. It's the thing to chase.

The player left standing alone is the **Wildcard** — a badge, not a failure. Nobody else was in that head.

## What you can do

| | |
|---|---|
| **Rooms** | Create one, name it, set a password, pick a size from 2 to 8 |
| **Invite anyone** | From your friends list or by searching every player — **you don't have to be friends to play** |
| **Join by code** | Six readable characters like `K7MW2P`. Invited players skip the password |
| **Host controls** | Only the host starts the game, sets the round length (10–60s), and can remove players |
| **Nothing to memorise** | Every word already said stays on screen while you think — large and legible beside whoever said it, in a highlighted panel under the word box, and in a full round log |
| **Live circle** | Watch chords snap between players the moment a Connection forms |
| **Reconnect** | Drop out mid-game and you have 30 seconds to get back |
| **Leaderboard** | Fastest circles, bucketed by player count, each group listed at its best |
| **History** | Every finished game with the full round-by-round trail |
| **Profile** | Best circle, average placement, and the people you connect with fastest |

At two players it's the original game, unchanged: you match, you both connect, and the score is the round you landed on.

## Quick start

You need **Node 20+** and **Docker** (for Postgres).

```bash
git clone <your-fork-url> connect.io
cd connect.io

npm install
npm run db:up        # Postgres on port 5433
npm run db:push      # create the schema
```

Create `server/.env` and give it a real secret:

```bash
cp server/.env.example server/.env
echo "JWT_SECRET=\"$(openssl rand -hex 32)\"" >> server/.env
```

Then:

```bash
npm run dev
```

- App → **http://localhost:5173**
- API → http://localhost:4000

### Playing locally with yourself

Eight accounts is a lot of sign-up forms, so there's a seeder:

```bash
npm run seed:demo --workspace server
```

That creates `demo1` … `demo8` (password `connect-io-demo-pass`), all friends with `demo1`. Open them in separate browser profiles or incognito windows, create a room as `demo1`, invite the rest, and start.

## Built with

**Frontend** React 19 · TypeScript · Vite · React Router · Socket.IO client
**Backend** Node · Express 5 · Socket.IO · Prisma · PostgreSQL · Zod
**Security** httpOnly cookie sessions, bcrypt, Helmet, per-route rate limiting

`npm test` runs 91 server tests covering the round engine, grouping and placement, the no-repeat rule, scoring, abandonment, rooms and authorisation.

## Docs

- [`GAME.md`](./GAME.md) — the rules in full
- [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) — architecture, data model, realtime protocol
- [`TASKS.md`](./TASKS.md) — what's done and what's next
- [`CLAUDE.md`](./CLAUDE.md) — conventions and invariants for AI assistants

## License

MIT
