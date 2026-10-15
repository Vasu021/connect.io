/**
 * One-off import of the pre-Prisma JSON store into Postgres.
 *
 *   npm run seed:import --workspace server
 *
 * Idempotent: rows that already exist are skipped, so re-running is safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

type LegacyUser = {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};
type LegacyRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  createdAt: string;
};
type LegacyFriendship = { id: string; user1Id: string; user2Id: string; createdAt: string };
type LegacyRound = {
  roundNumber: number;
  player1Word: string | null;
  player2Word: string | null;
  matched: boolean;
  revealedAt: string;
};
type LegacyGame = {
  id: string;
  roomCode: string;
  player1Id: string;
  player2Id: string;
  rounds: LegacyRound[];
  finalScore: number;
  status: string;
  endedAt: string;
  startedAt: string | null;
};

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`No legacy store at ${DB_PATH} — nothing to import.`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as {
    users?: LegacyUser[];
    friendRequests?: LegacyRequest[];
    friendships?: LegacyFriendship[];
    games?: LegacyGame[];
  };

  let users = 0;
  for (const user of raw.users ?? []) {
    const result = await prisma.user.createMany({
      data: [
        {
          id: user.id,
          username: user.username,
          usernameLower: user.username.toLowerCase(),
          email: user.email.toLowerCase(),
          passwordHash: user.passwordHash,
          createdAt: new Date(user.createdAt),
        },
      ],
      skipDuplicates: true,
    });
    users += result.count;
  }

  let friendships = 0;
  for (const row of raw.friendships ?? []) {
    const [user1Id, user2Id] =
      row.user1Id < row.user2Id ? [row.user1Id, row.user2Id] : [row.user2Id, row.user1Id];
    const result = await prisma.friendship.createMany({
      data: [{ id: row.id, user1Id, user2Id, createdAt: new Date(row.createdAt) }],
      skipDuplicates: true,
    });
    friendships += result.count;
  }

  const allowedStatus = new Set(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']);
  let requests = 0;
  for (const row of raw.friendRequests ?? []) {
    const status = allowedStatus.has(row.status) ? row.status : 'PENDING';
    const result = await prisma.friendRequest.createMany({
      data: [
        {
          id: row.id,
          fromUserId: row.fromUserId,
          toUserId: row.toUserId,
          status: status as 'PENDING',
          createdAt: new Date(row.createdAt),
        },
      ],
      skipDuplicates: true,
    });
    requests += result.count;
  }

  let games = 0;
  let rounds = 0;
  for (const row of raw.games ?? []) {
    const matchedRound = row.rounds.find((r) => r.matched);
    // The legacy store had no `outcome`, so it is derived: a game only scores
    // if some round actually matched.
    const outcome = matchedRound ? 'MATCHED' : 'UNMATCHED';
    const finalScore = matchedRound ? matchedRound.roundNumber : null;

    const existing = await prisma.game.findUnique({ where: { id: row.id }, select: { id: true } });
    if (existing) continue;

    await prisma.game.create({
      data: {
        id: row.id,
        roomCode: row.roomCode,
        player1Id: row.player1Id,
        player2Id: row.player2Id,
        status: 'COMPLETED',
        outcome,
        finalScore,
        currentRound: row.rounds.length,
        startedAt: row.startedAt ? new Date(row.startedAt) : null,
        endedAt: new Date(row.endedAt),
        rounds: {
          create: row.rounds.map((r) => ({
            roundNumber: r.roundNumber,
            player1Word: r.player1Word,
            player2Word: r.player2Word,
            matched: r.matched,
            revealedAt: new Date(r.revealedAt),
          })),
        },
      },
    });
    games += 1;
    rounds += row.rounds.length;
  }

  console.log(
    `Imported: ${users} user(s), ${friendships} friendship(s), ${requests} request(s), ${games} game(s) with ${rounds} round(s).`,
  );
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
