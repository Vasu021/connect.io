import { Router } from 'express';
import { prisma } from '../db.js';
import { type AuthedRequest, requireAuth } from '../lib/auth.js';
import { badRequest, forbidden, notFound, wrap } from '../lib/errors.js';
import { areFriends } from '../lib/friends.js';
import { createGameLimiter } from '../lib/limits.js';
import {
  createGameSchema,
  idParamSchema,
  joinByCodeSchema,
  paginationSchema,
} from '../lib/validation.js';
import { MAX_ROUNDS, ROUND_DURATION_MS } from '../game/constants.js';
import { createGame, findLiveByRoomCode, viewFor } from '../game/engine.js';
import type { GameStateView, GameSummary } from '../game/types.js';
import { presence } from '../realtime/presence.js';

export const gamesRouter = Router();

gamesRouter.use(requireAuth);

const playerSelect = { select: { id: true, username: true } } as const;

const gameSelect = {
  id: true,
  roomCode: true,
  status: true,
  outcome: true,
  finalScore: true,
  currentRound: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  player1Id: true,
  player2Id: true,
  player1: playerSelect,
  player2: playerSelect,
} as const;

type GameRow = {
  id: string;
  roomCode: string;
  status: 'WAITING' | 'ACTIVE' | 'COMPLETED';
  outcome: GameStateView['outcome'];
  finalScore: number | null;
  currentRound: number;
  createdAt: Date;
  endedAt: Date | null;
  player1Id: string;
  player2Id: string;
  player1: { id: string; username: string };
  player2: { id: string; username: string };
};

function toSummary(row: GameRow, viewerId: string): GameSummary {
  const opponent = row.player1Id === viewerId ? row.player2 : row.player1;
  return {
    id: row.id,
    roomCode: row.roomCode,
    status: row.status,
    outcome: row.outcome,
    finalScore: row.finalScore,
    currentRound: row.currentRound,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    opponent: { ...opponent, online: presence.isOnline(opponent.id) },
    youInvited: row.player1Id === viewerId,
  };
}

/** Completed games are no longer held in memory, so their view comes from the DB. */
function completedView(
  row: GameRow & {
    rounds: {
      roundNumber: number;
      player1Word: string | null;
      player2Word: string | null;
      matched: boolean;
      revealedAt: Date;
    }[];
  },
  viewerId: string,
): GameStateView {
  const opponentId = row.player1Id === viewerId ? row.player2Id : row.player1Id;
  return {
    id: row.id,
    roomCode: row.roomCode,
    status: 'COMPLETED',
    outcome: row.outcome,
    finalScore: row.finalScore,
    currentRound: row.currentRound,
    maxRounds: MAX_ROUNDS,
    roundDurationMs: ROUND_DURATION_MS,
    roundDeadline: null,
    players: [row.player1, row.player2].map((p) => ({
      id: p.id,
      username: p.username,
      online: presence.isOnline(p.id),
      isYou: p.id === viewerId,
    })),
    youId: viewerId,
    opponentId,
    youSubmitted: false,
    youWord: null,
    opponentSubmitted: false,
    opponentOnline: presence.isOnline(opponentId),
    bothPresent: false,
    rounds: row.rounds.map((r) => ({
      roundNumber: r.roundNumber,
      player1Word: r.player1Word,
      player2Word: r.player2Word,
      matched: r.matched,
      revealedAt: r.revealedAt.toISOString(),
    })),
  };
}

// ─── Create / join ───────────────────────────────────────────────────────────

gamesRouter.post(
  '/',
  createGameLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { friendId } = createGameSchema.parse(req.body);

    if (friendId === user.id) throw badRequest('You need a partner to connect with');
    // The score describes a relationship, so games are friends-only by design.
    if (!(await areFriends(user.id, friendId))) {
      throw forbidden('You can only play with friends');
    }

    const existing = await prisma.game.findFirst({
      where: {
        status: { in: ['WAITING', 'ACTIVE'] },
        OR: [
          { player1Id: user.id, player2Id: friendId },
          { player1Id: friendId, player2Id: user.id },
        ],
      },
      select: gameSelect,
    });

    // Reuse an open room rather than piling up duplicate invites.
    if (existing) {
      res.json({ game: toSummary(existing as GameRow, user.id), reused: true });
      return;
    }

    const created = await createGame(user.id, friendId);
    const row = await prisma.game.findUniqueOrThrow({
      where: { id: created.id },
      select: gameSelect,
    });

    res.status(201).json({ game: toSummary(row as GameRow, user.id), reused: false });
  }),
);

gamesRouter.post(
  '/join',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { roomCode } = joinByCodeSchema.parse(req.body);

    const game = findLiveByRoomCode(roomCode);
    if (!game) throw notFound('No open room with that code');
    if (game.player1Id !== user.id && game.player2Id !== user.id) {
      // Do not confirm the room exists to someone who is not invited.
      throw notFound('No open room with that code');
    }

    res.json({ gameId: game.id });
  }),
);

// ─── Lists ───────────────────────────────────────────────────────────────────

gamesRouter.get(
  '/active',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const rows = await prisma.game.findMany({
      where: {
        status: { in: ['WAITING', 'ACTIVE'] },
        OR: [{ player1Id: user.id }, { player2Id: user.id }],
      },
      select: gameSelect,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ games: rows.map((row) => toSummary(row as GameRow, user.id)) });
  }),
);

gamesRouter.get(
  '/history',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { limit } = paginationSchema.parse(req.query);

    const rows = await prisma.game.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: user.id }, { player2Id: user.id }],
      },
      select: {
        ...gameSelect,
        rounds: {
          select: {
            roundNumber: true,
            player1Word: true,
            player2Word: true,
            matched: true,
            revealedAt: true,
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
      orderBy: { endedAt: 'desc' },
      take: limit,
    });

    res.json({
      games: rows.map((row) => ({
        ...toSummary(row as GameRow, user.id),
        players: [row.player1, row.player2],
        rounds: row.rounds.map((r) => ({
          roundNumber: r.roundNumber,
          player1Word: r.player1Word,
          player2Word: r.player2Word,
          matched: r.matched,
          revealedAt: r.revealedAt.toISOString(),
        })),
      })),
    });
  }),
);

/**
 * Pairs, not players: a score belongs to two people. Each pair is ranked by
 * their single best (lowest) matched game.
 */
gamesRouter.get(
  '/leaderboard',
  wrap(async (_req, res) => {
    const rows = await prisma.game.findMany({
      where: { status: 'COMPLETED', outcome: 'MATCHED', finalScore: { not: null } },
      select: {
        id: true,
        roomCode: true,
        finalScore: true,
        endedAt: true,
        player1: playerSelect,
        player2: playerSelect,
      },
      orderBy: [{ finalScore: 'asc' }, { endedAt: 'desc' }],
      take: 500,
    });

    type Entry = {
      pairKey: string;
      players: { id: string; username: string }[];
      bestScore: number;
      games: number;
      lastPlayed: string | null;
    };

    const byPair = new Map<string, Entry>();

    for (const row of rows) {
      const ids = [row.player1.id, row.player2.id].sort();
      const pairKey = ids.join(':');
      const score = row.finalScore as number;
      const existing = byPair.get(pairKey);

      if (!existing) {
        byPair.set(pairKey, {
          pairKey,
          players: [row.player1, row.player2],
          bestScore: score,
          games: 1,
          lastPlayed: row.endedAt ? row.endedAt.toISOString() : null,
        });
        continue;
      }

      existing.games += 1;
      if (score < existing.bestScore) existing.bestScore = score;
    }

    const leaderboard = [...byPair.values()]
      .sort((a, b) => a.bestScore - b.bestScore || b.games - a.games)
      .slice(0, 20)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    res.json({ leaderboard });
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

    const row = await prisma.game.findUnique({
      where: { id },
      select: {
        ...gameSelect,
        rounds: {
          select: {
            roundNumber: true,
            player1Word: true,
            player2Word: true,
            matched: true,
            revealedAt: true,
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!row) throw notFound('Game not found');
    if (row.player1Id !== user.id && row.player2Id !== user.id) throw forbidden();

    res.json({ game: completedView(row as Parameters<typeof completedView>[0], user.id) });
  }),
);

gamesRouter.post(
  '/:id/rematch',
  createGameLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const row = await prisma.game.findUnique({
      where: { id },
      select: { player1Id: true, player2Id: true },
    });

    if (!row) throw notFound('Game not found');
    if (row.player1Id !== user.id && row.player2Id !== user.id) throw forbidden();

    const opponentId = row.player1Id === user.id ? row.player2Id : row.player1Id;
    if (!(await areFriends(user.id, opponentId))) {
      throw forbidden('You are no longer friends');
    }

    const open = await prisma.game.findFirst({
      where: {
        status: { in: ['WAITING', 'ACTIVE'] },
        OR: [
          { player1Id: user.id, player2Id: opponentId },
          { player1Id: opponentId, player2Id: user.id },
        ],
      },
      select: { id: true },
    });

    if (open) {
      res.json({ gameId: open.id, reused: true });
      return;
    }

    const created = await createGame(user.id, opponentId);
    res.status(201).json({ gameId: created.id, reused: false });
  }),
);
