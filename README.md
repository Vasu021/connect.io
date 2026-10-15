<div align="center">

# connect.io

**How well do you two actually think alike?**

A two-player word game that measures the distance between two minds — and gives it a number.

</div>

---

## The idea

Two friends enter a room. Each round, you both get **15 seconds to type one word**. Neither of you can see the other's word. Then both words reveal at the same time.

Say the same word, and the game ends immediately.

**Your score is the round you landed on. Lower is better.**

```
Round 1    king   ·   football     no match
Round 2    messi  ·   ronaldo      no match
Round 3    fifa   ·   fifa         connected  →  score 3
```

That's the whole game.

## Why it's not just a word game

The scoring inversion is doing all the work:

- **There is no opponent.** You both want the same thing, so it's co-op. You're not beating each other — you're beating the gap between you.
- **The score belongs to the pair, not the player.** That's why the leaderboard ranks `alice + bob`, never a single name. A high rank is a claim about a friendship.
- **The failed rounds are the point.** `king → messi → fifa` is two people visibly negotiating their way to a shared idea. connect.io keeps every one of those trails so you can read them back.
- **A score of 1 is the brag.** It can't be practised or farmed. Either you landed on the same word first try, or you didn't.

Games are friends-only on purpose: the number means nothing with a stranger.

## What you can do

| | |
|---|---|
| **Play** | Real-time 15-second rounds, simultaneous reveal, live opponent status |
| **Invite** | Start a game from your friends list — it appears on their dashboard instantly |
| **Join by code** | Every room gets a short code like `K7MW2P` |
| **Reconnect** | Drop out mid-game and you have 30 seconds to get back before it's abandoned |
| **Rematch** | One click from the result screen |
| **Leaderboard** | Pairs ranked by their best score |
| **History** | Every finished game, with the full word-by-word trail |
| **Profile** | Your best score, average, and the partners you connect with fastest |
| **Friends** | Search, request, accept, reject, cancel, unfriend — with live online presence |

## Quick start

You need **Node 20+** and **Docker** (for Postgres).

```bash
git clone <your-fork-url> connect.io
cd connect.io

npm install
npm run db:up        # starts Postgres on port 5433
npm run db:push      # creates the schema
```

Create `server/.env` (copy `server/.env.example`) and set a secret:

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

Open a second browser (or an incognito window) to play as the other person.

## Playing your first game

1. Register two accounts in two browsers.
2. In one, search the other's username and send a friend request.
3. Accept it in the other window.
4. Hit **Play** next to their name. The invite appears on their dashboard immediately — no link to paste.
5. Both of you are in: the clock starts.

## Built with

**Frontend** React 19 · TypeScript · Vite · React Router · Socket.IO client
**Backend** Node · Express 5 · Socket.IO · Prisma · PostgreSQL · Zod
**Security** httpOnly cookie sessions, bcrypt, Helmet, per-route rate limiting

Run the test suite with `npm test` (68 tests covering the round engine, scoring, abandonment, auth and authorisation).

## Docs

- [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) — architecture, data model, realtime protocol, how to work on it
- [`TASKS.md`](./TASKS.md) — what's done and what's next
- [`CLAUDE.md`](./CLAUDE.md) — conventions and context for AI assistants

## License

MIT
