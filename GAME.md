# connect.io — the game

## Product summary

**connect.io** is a real-time word game for **2 to 8 players** that measures how
closely a group thinks alike.

Everyone sits in a circle. Each round, every player still in the circle has
**15 seconds to type one word**, submitted blind. All words reveal at once.

**Anyone whose word matches at least one other player connects.** They leave the
circle together as a numbered **Connection** — the first group out is
Connection #1, the next #2, and so on — then sit and watch.

Play continues until **everyone is connected, or one player is left alone**.

## Example

Eight players: `a b c d e f g h`

```
Round 1   all eight submit            no matches
Round 2   all eight submit            no matches
Round 3   a · d · e all say "ocean"   → Connection #1   (5 left)
Round 4   b c f g h submit            no matches
Round 5   b · c both say "signal"     → Connection #2   (3 left)
Round 6   f · g both say "amber"      → Connection #3   (1 left)
                                      → h is the Wildcard, the game ends

Room score: 6 — the round the circle closed. Lower is better.
```

## Rules

1. **One word per round, letters only, submitted blind.** Nobody sees anyone
   else's word until the reveal — only that they have locked one in.
2. **A word played once can never be played again — by anyone.** This is what
   makes it a game: without it, round two is "everyone copies the most popular
   word from round one". With it, you have to find a *new* middle each round, and
   the words spiral inward.
3. **A Connection is two or more players.** Five people on the same word form one
   Connection and share the placement.
4. **Round cap of 15.** Reaching it with two or more players unconnected ends the
   game with no score.
5. **Each revealed word gets a picture.** Once a round reveals, every word
   carries a small image beside it, so the group's drift is something you can
   see rather than only read. The picture is always *in addition to* the word,
   never instead of it. Images never appear for the round in progress — one
   would give the word away.
6. **Everything already said stays on screen.** Once a round reveals, those
   words remain visible while the next round is thought through — on the circle
   beside whoever said them, pinned under the word box, and in a full
   round-by-round record. You are aiming for the middle of what the group just
   said, so you should not have to memorise it.

## Two layers of result

- **Placement** is personal — connect early to place high.
- **The room score** is the round the circle finally closed, and it belongs to
  everyone in it. Lower is better.

A **Perfect Circle** is when nobody is left over. It is possible at any player
count, because groups can be three or more, and it is the thing to chase.

The player left alone is the **Wildcard** — a badge, not a failure.

## Rooms

Anyone can create a room, give it a name, optionally set a password, and choose
a size from 2 to 8. Invite people from your friends list or by searching every
player — **you do not have to be friends to play**. An invite is its own
authorisation, so invited players skip the password; anyone else joining by code
has to supply it.

The host also sets the round length, anywhere from 10 to 60 seconds in the
lobby (the default is 15). Bigger rooms usually want longer: eight people take
more time to read what everyone just said than two do.

Only the host can start, and only with at least two players. When the game ends
the room is destroyed and everyone returns to the dashboard; the result lives on
in history and on the leaderboard.

## Scoring and the leaderboard

Only a game whose circle actually closed carries a score. Running out of rounds,
a player dropping out, or someone ending the game early all score nothing — so
quitting can never outrank connecting.

The leaderboard is **bucketed by player count**, because closing in 6 rounds with
eight people is a completely different achievement from 6 with two. Within a
bucket, each distinct group appears once, at its best circle.

At two players this is exactly the original game: you match, you both connect,
nobody is left over, and the score is the round you landed on.
