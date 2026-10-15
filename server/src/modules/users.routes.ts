import { Router } from 'express';
import { prisma } from '../db.js';
import { type AuthedRequest, requireAuth } from '../lib/auth.js';
import { notFound, wrap } from '../lib/errors.js';
import { friendIdsOf } from '../lib/friends.js';
import { searchLimiter } from '../lib/limits.js';
import { idParamSchema, searchSchema } from '../lib/validation.js';
import { presence } from '../realtime/presence.js';

export const usersRouter = Router();

type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

/**
 * Search deliberately returns only id + username. Exposing email addresses
 * through an authenticated search endpoint would turn the whole user table
 * into a harvestable address book.
 */
usersRouter.get(
  '/search',
  requireAuth,
  searchLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      res.json({ users: [] });
      return;
    }

    const q = parsed.data.q.toLowerCase();

    const matches = await prisma.user.findMany({
      where: { usernameLower: { contains: q }, id: { not: user.id } },
      select: { id: true, username: true },
      orderBy: [{ usernameLower: 'asc' }],
      take: 15,
    });

    const ids = matches.map((m) => m.id);
    const [friendIds, requests] = await Promise.all([
      friendIdsOf(user.id),
      prisma.friendRequest.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { fromUserId: user.id, toUserId: { in: ids } },
            { toUserId: user.id, fromUserId: { in: ids } },
          ],
        },
        select: { id: true, fromUserId: true, toUserId: true },
      }),
    ]);

    const friendSet = new Set(friendIds);
    const sent = new Map(
      requests.filter((r) => r.fromUserId === user.id).map((r) => [r.toUserId, r.id]),
    );
    const received = new Map(
      requests.filter((r) => r.toUserId === user.id).map((r) => [r.fromUserId, r.id]),
    );

    const users = matches.map((match) => {
      let relationship: Relationship = 'none';
      if (friendSet.has(match.id)) relationship = 'friend';
      else if (sent.has(match.id)) relationship = 'request_sent';
      else if (received.has(match.id)) relationship = 'request_received';

      return {
        id: match.id,
        username: match.username,
        online: presence.isOnline(match.id),
        relationship,
        requestId: received.get(match.id) ?? sent.get(match.id) ?? null,
      };
    });

    res.json({ users });
  }),
);

/**
 * A player's record. Because the score belongs to the pair, the headline stat
 * is their best partnership, not a solo number.
 */
usersRouter.get(
  '/:id/stats',
  requireAuth,
  wrap(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, createdAt: true },
    });
    if (!user) throw notFound('No such player');

    const games = await prisma.game.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: id }, { player2Id: id }],
      },
      select: {
        id: true,
        outcome: true,
        finalScore: true,
        endedAt: true,
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
      },
      orderBy: { endedAt: 'desc' },
    });

    const matched = games.filter((g) => g.outcome === 'MATCHED' && g.finalScore !== null);
    const scores = matched.map((g) => g.finalScore as number);

    const partners = new Map<
      string,
      { id: string; username: string; games: number; best: number | null }
    >();

    for (const game of games) {
      const other = game.player1.id === id ? game.player2 : game.player1;
      const entry =
        partners.get(other.id) ?? { id: other.id, username: other.username, games: 0, best: null };
      entry.games += 1;
      if (game.outcome === 'MATCHED' && game.finalScore !== null) {
        entry.best = entry.best === null ? game.finalScore : Math.min(entry.best, game.finalScore);
      }
      partners.set(other.id, entry);
    }

    const ranked = [...partners.values()]
      .filter((p) => p.best !== null)
      .sort((a, b) => (a.best as number) - (b.best as number))
      .slice(0, 5);

    res.json({
      user: { ...user, online: presence.isOnline(user.id) },
      stats: {
        gamesPlayed: games.length,
        gamesMatched: matched.length,
        bestScore: scores.length ? Math.min(...scores) : null,
        averageScore: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
        unmatched: games.filter((g) => g.outcome === 'UNMATCHED').length,
        abandoned: games.filter((g) => g.outcome === 'ABANDONED' || g.outcome === 'FORFEITED').length,
        topPartners: ranked,
      },
    });
  }),
);
