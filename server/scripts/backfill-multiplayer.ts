/**
 * Rebuilds the exported two-player games in the multiplayer shape.
 *
 *   npx tsx scripts/backfill-multiplayer.ts <legacy-games.json>
 *
 * Each old game becomes a closed two-player Room; its player1/player2 columns
 * become GamePlayer rows and its player1Word/player2Word columns become
 * Submission rows. A game that matched gets a single Connection at placement 1
 * holding both players — which is exactly what the new rules produce at two
 * players, so old history stays truthful.
 *
 * Idempotent: a game whose id already exists is skipped.
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { normalizeWord } from '../src/game/words.js';

const prisma = new PrismaClient();
const file = process.argv[2];

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
  status: string;
  outcome: string | null;
  finalScore: number | null;
  currentRound: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  rounds: LegacyRound[];
};

async function main() {
  if (!file || !fs.existsSync(file)) {
    console.error(`Usage: backfill-multiplayer.ts <legacy-games.json> (got: ${file})`);
    process.exit(1);
  }

  const games = JSON.parse(fs.readFileSync(file, 'utf8')) as LegacyGame[];
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));

  let imported = 0;
  let skipped = 0;
  let connections = 0;
  let submissions = 0;

  for (const legacy of games) {
    if (await prisma.game.findUnique({ where: { id: legacy.id }, select: { id: true } })) {
      skipped += 1;
      continue;
    }
    // A game whose players no longer exist cannot be rebuilt.
    if (!userIds.has(legacy.player1Id) || !userIds.has(legacy.player2Id)) {
      skipped += 1;
      continue;
    }

    const matched = legacy.outcome === 'MATCHED' && legacy.finalScore !== null;
    const matchedRound = legacy.rounds.find((r) => r.matched);

    await prisma.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: {
          code: legacy.roomCode,
          hostId: legacy.player1Id,
          maxPlayers: 2,
          status: 'CLOSED',
          createdAt: new Date(legacy.createdAt),
          closedAt: legacy.endedAt ? new Date(legacy.endedAt) : new Date(legacy.createdAt),
          members: {
            create: [{ userId: legacy.player1Id }, { userId: legacy.player2Id }],
          },
        },
      });

      await tx.game.create({
        data: {
          id: legacy.id,
          roomId: room.id,
          status: 'COMPLETED',
          outcome: (legacy.outcome ?? 'UNMATCHED') as 'MATCHED',
          finalScore: matched ? legacy.finalScore : null,
          playerCount: 2,
          // At two players a match means both connected and nobody was left over.
          perfectCircle: matched,
          currentRound: legacy.currentRound,
          createdAt: new Date(legacy.createdAt),
          startedAt: legacy.startedAt ? new Date(legacy.startedAt) : null,
          endedAt: legacy.endedAt ? new Date(legacy.endedAt) : null,
        },
      });

      const connection =
        matched && matchedRound
          ? await tx.connection.create({
              data: {
                gameId: legacy.id,
                placement: 1,
                word: normalizeWord(matchedRound.player1Word),
                roundNumber: matchedRound.roundNumber,
              },
            })
          : null;

      if (connection) connections += 1;

      for (const userId of [legacy.player1Id, legacy.player2Id]) {
        await tx.gamePlayer.create({
          data: {
            gameId: legacy.id,
            userId,
            status: connection ? 'CONNECTED' : 'LEFT',
            connectionId: connection?.id ?? null,
            placement: connection ? 1 : null,
            connectedAtRound: connection ? connection.roundNumber : null,
            joinedAt: new Date(legacy.startedAt ?? legacy.createdAt),
          },
        });
      }

      for (const legacyRound of legacy.rounds) {
        const round = await tx.round.create({
          data: {
            gameId: legacy.id,
            roundNumber: legacyRound.roundNumber,
            revealedAt: new Date(legacyRound.revealedAt),
          },
        });

        const pairs: [string, string | null][] = [
          [legacy.player1Id, legacyRound.player1Word],
          [legacy.player2Id, legacyRound.player2Word],
        ];

        for (const [userId, word] of pairs) {
          // A missed round had no word at all; there is nothing to record.
          if (!word) continue;
          await tx.submission.create({
            data: {
              roundId: round.id,
              gameId: legacy.id,
              userId,
              word,
              normalized: normalizeWord(word),
              matched: legacyRound.matched,
            },
          });
          submissions += 1;
        }
      }
    });

    imported += 1;
  }

  console.log(
    `Backfilled ${imported} game(s), ${connections} connection(s), ${submissions} submission(s). Skipped ${skipped}.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
