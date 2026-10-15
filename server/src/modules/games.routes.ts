import { Router } from 'express';
import { prisma } from '../db.js';
import { type AuthedRequest, requireAuth } from '../lib/auth.js';
import { forbidden, notFound, wrap } from '../lib/errors.js';
import { idParamSchema, leaderboardQuerySchema, paginationSchema } from '../lib/validation.js';
import { MAX_ROUNDS, ROUND_DURATION_MS } from '../game/constants.js';
import { viewFor } from '../game/engine.js';
import { readyImagesFor } from '../images/index.js';
import type {
  ConnectionView,
  GameStateView,
  RoundView,
  WordImageView,
} from '../game/types.js';
import { presence } from '../realtime/presence.js';

export const gamesRouter = Router();

gamesRouter.use(requireAuth);

const finishedGameSelect = {
  id: true,
  status: true,
  outcome: true,
  finalScore: true,
  playerCount: true,
  perfectCircle: true,
  currentRound: true,
  createdAt: true,
  endedAt: true,
  room: { select: { id: true, code: true } },
  players: {
    select: {
      userId: true,
      status: true,
      placement: true,
      connectedAtRound: true,
      user: { select: { id: true, username: true } },
    },
    orderBy: { joinedAt: 'asc' },
  },
  connections: {
    select: {
      placement: true,
      word: true,
      roundNumber: true,
      players: { select: { userId: true } },
    },
    orderBy: { placement: 'asc' },
  },
} as const;

type FinishedGame = Awaited<
  ReturnType<typeof prisma.game.findFirstOrThrow<{ select: typeof finishedGameSelect }>>
>;

function toConnections(game: FinishedGame): ConnectionView[] {
  return game.connections.map((connection) => ({
    placement: connection.placement,
    word: connection.word,
    roundNumber: connection.roundNumber,
    memberIds: connection.players.map((player) => player.userId),
  }));
}

function toSummary(game: FinishedGame, viewerId: string) {
  const you = game.players.find((player) => player.userId === viewerId);
  return {
    id: game.id,
    roomCode: game.room.code,
    status: game.status,
    outcome: game.outcome,
    finalScore: game.finalScore,
    playerCount: game.playerCount,
    perfectCircle: game.perfectCircle,
    currentRound: game.currentRound,
    createdAt: game.createdAt.toISOString(),
    endedAt: game.endedAt ? game.endedAt.toISOString() : null,
    players: game.players.map((player) => player.user),
    yourPlacement: you?.placement ?? null,
  };
}

/** A completed game is no longer in memory, so its view comes from the DB. */
function completedView(
  game: FinishedGame & {
    rounds: {
      roundNumber: number;
      revealedAt: Date;
      submissions: { userId: string; word: string; matched: boolean }[];
    }[];
  },
  viewerId: string,
  images: Record<string, WordImageView> = {},
): GameStateView {
  const connections = toConnections(game);
  const online = presence.onlineAmong(game.players.map((p) => p.userId));
  const you = game.players.find((player) => player.userId === viewerId);

  const rounds: RoundView[] = game.rounds.map((round) => ({
    roundNumber: round.roundNumber,
    revealedAt: round.revealedAt.toISOString(),
    submissions: round.submissions.map((submission) => ({
      userId: submission.userId,
      word: submission.word,
      matched: submission.matched,
    })),
    formed: connections.filter((c) => c.roundNumber === round.roundNumber),
  }));

  const playedWords: string[] = [];
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const submission of round.submissions) {
      const key = submission.word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      playedWords.push(submission.word);
    }
  }

  const leftover = game.players.filter((player) => player.status === 'ACTIVE');

  return {
    id: game.id,
    roomId: game.room.id,
    roomCode: game.room.code,
    status: 'COMPLETED',
    outcome: game.outcome,
    finalScore: game.finalScore,
    perfectCircle: game.perfectCircle,
    currentRound: game.currentRound,
    maxRounds: MAX_ROUNDS,
    roundDurationMs: ROUND_DURATION_MS,
    roundDeadline: null,
    players: game.players.map((player, index) => ({
      id: player.userId,
      username: player.user.username,
      online: online.has(player.userId),
      isYou: player.userId === viewerId,
      status: player.status,
      placement: player.placement,
      connectedAtRound: player.connectedAtRound,
      hasSubmitted: false,
      seat: index,
    })),
    youId: viewerId,
    youStatus: you?.status ?? 'LEFT',
    youSubmitted: false,
    youWord: null,
    activeCount: leftover.length,
    connections,
    rounds,
    playedWords,
    // Every round here is finished, so all of its pictures are public.
    images,
    wildcardId: leftover.length === 1 ? (leftover[0]?.userId ?? null) : null,
  };
}

// ─── Lists ───────────────────────────────────────────────────────────────────

gamesRouter.get(
  '/active',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const games = await prisma.game.findMany({
      where: {
        status: { in: ['WAITING', 'ACTIVE'] },
        players: { some: { userId: user.id } },
      },
      select: finishedGameSelect,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ games: games.map((game) => toSummary(game as FinishedGame, user.id)) });
  }),
);

gamesRouter.get(
  '/history',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { limit } = paginationSchema.parse(req.query);

    const games = await prisma.game.findMany({
      where: { status: 'COMPLETED', players: { some: { userId: user.id } } },
      select: {
        ...finishedGameSelect,
        rounds: {
          select: {
            roundNumber: true,
            revealedAt: true,
            submissions: { select: { userId: true, word: true, matched: true } },
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
      orderBy: { endedAt: 'desc' },
      take: limit,
    });

    res.json({
      games: games.map((game) => ({
        ...toSummary(game as FinishedGame, user.id),
        connections: toConnections(game as FinishedGame),
        rounds: game.rounds.map((round) => ({
          roundNumber: round.roundNumber,
          revealedAt: round.revealedAt.toISOString(),
          submissions: round.submissions,
          formed: toConnections(game as FinishedGame).filter(
            (c) => c.roundNumber === round.roundNumber,
          ),
        })),
      })),
    });
  }),
);

/**
 * Circles ranked by how fast they closed.
 *
 * Bucketed by player count, because a score of 6 at eight players is a
 * completely different achievement from 6 at two. Within a bucket each distinct
 * group appears once, at its best result — otherwise one group that plays a lot
 * simply fills the board with itself.
 */
gamesRouter.get(
  '/leaderboard',
  wrap(async (req, res) => {
    const { size } = leaderboardQuerySchema.parse(req.query);

    const [sizes, games] = await Promise.all([
      prisma.game.groupBy({
        by: ['playerCount'],
        where: { outcome: 'MATCHED', finalScore: { not: null } },
        _count: { _all: true },
        orderBy: { playerCount: 'asc' },
      }),
      prisma.game.findMany({
        where: {
          outcome: 'MATCHED',
          finalScore: { not: null },
          ...(size ? { playerCount: size } : {}),
        },
        select: finishedGameSelect,
        orderBy: [{ finalScore: 'asc' }, { perfectCircle: 'desc' }, { endedAt: 'desc' }],
        take: 500,
      }),
    ]);

    type Entry = {
      groupKey: string;
      gameId: string;
      roomCode: string;
      finalScore: number;
      playerCount: number;
      perfectCircle: boolean;
      endedAt: string | null;
      games: number;
      players: { id: string; username: string; placement: number | null }[];
    };

    const byGroup = new Map<string, Entry>();

    for (const row of games) {
      const game = row as FinishedGame;
      const groupKey = game.players
        .map((player) => player.userId)
        .slice()
        .sort()
        .join(':');

      const existing = byGroup.get(groupKey);
      if (existing) {
        // Rows arrive best-first, so the first one seen is already the best.
        existing.games += 1;
        continue;
      }

      byGroup.set(groupKey, {
        groupKey,
        gameId: game.id,
        roomCode: game.room.code,
        finalScore: game.finalScore as number,
        playerCount: game.playerCount,
        perfectCircle: game.perfectCircle,
        endedAt: game.endedAt ? game.endedAt.toISOString() : null,
        games: 1,
        players: game.players
          .slice()
          .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
          .map((player) => ({
            id: player.user.id,
            username: player.user.username,
            placement: player.placement,
          })),
      });
    }

    const leaderboard = [...byGroup.values()]
      .sort(
        (a, b) =>
          a.finalScore - b.finalScore ||
          Number(b.perfectCircle) - Number(a.perfectCircle) ||
          b.games - a.games,
      )
      .slice(0, 20)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    res.json({
      availableSizes: sizes.map((row) => ({
        playerCount: row.playerCount,
        games: row._count._all,
      })),
      leaderboard,
    });
  }),
);

// ─── Single game ─────────────────────────────────────────────────────────────

gamesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const liveState = viewFor(id, user.id);
    if (liveState) {
      res.json({ game: liveState });
      return;
    }

    const game = await prisma.game.findUnique({
      where: { id },
      select: {
        ...finishedGameSelect,
        rounds: {
          select: {
            roundNumber: true,
            revealedAt: true,
            submissions: { select: { userId: true, word: true, matched: true } },
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!game) throw notFound('Game not found');
    if (!game.players.some((player) => player.userId === user.id)) throw forbidden();

    const words = game.rounds.flatMap((round) => round.submissions.map((s) => s.word));
    const images = Object.fromEntries(await readyImagesFor(words));

    res.json({
      game: completedView(game as Parameters<typeof completedView>[0], user.id, images),
    });
  }),
);
