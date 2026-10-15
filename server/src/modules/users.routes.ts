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
 * A player's record. Placement is personal — connecting early is the thing you
 * can be good at — while the room score belongs to everyone in the circle.
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

    const entries = await prisma.gamePlayer.findMany({
      where: { userId: id, game: { status: 'COMPLETED' } },
      select: {
        status: true,
        placement: true,
        connectedAtRound: true,
        connectionId: true,
        game: {
          select: {
            id: true,
            outcome: true,
            finalScore: true,
            playerCount: true,
            perfectCircle: true,
          },
        },
      },
    });

    const connected = entries.filter((entry) => entry.placement !== null);
    const scored = entries.filter(
      (entry) => entry.game.outcome === 'MATCHED' && entry.game.finalScore !== null,
    );
    const placements = connected.map((entry) => entry.placement as number);
    const connectRounds = connected
      .map((entry) => entry.connectedAtRound)
      .filter((round): round is number => round !== null);

    // Who this player actually clicks with: everyone who has been inside the
    // same Connection as them.
    const connectionIds = connected
      .map((entry) => entry.connectionId)
      .filter((value): value is string => value !== null);

    const partnerRows = connectionIds.length
      ? await prisma.gamePlayer.findMany({
          where: { connectionId: { in: connectionIds }, userId: { not: id } },
          select: {
            userId: true,
            connectedAtRound: true,
            user: { select: { id: true, username: true } },
          },
        })
      : [];

    const partners = new Map<
      string,
      { id: string; username: string; times: number; fastest: number | null }
    >();

    for (const row of partnerRows) {
      const entry =
        partners.get(row.userId) ??
        { id: row.user.id, username: row.user.username, times: 0, fastest: null };
      entry.times += 1;
      if (row.connectedAtRound !== null) {
        entry.fastest =
          entry.fastest === null ? row.connectedAtRound : Math.min(entry.fastest, row.connectedAtRound);
      }
      partners.set(row.userId, entry);
    }

    const topPartners = [...partners.values()]
      .sort((a, b) => b.times - a.times || (a.fastest ?? 99) - (b.fastest ?? 99))
      .slice(0, 5);

    const average = (values: number[]) =>
      values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

    res.json({
      user: { ...user, online: presence.isOnline(user.id) },
      stats: {
        gamesPlayed: entries.length,
        gamesConnected: connected.length,
        bestScore: scored.length
          ? Math.min(...scored.map((entry) => entry.game.finalScore as number))
          : null,
        averageScore: average(scored.map((entry) => entry.game.finalScore as number)),
        firstPlaceFinishes: placements.filter((placement) => placement === 1).length,
        averagePlacement: average(placements),
        fastestConnection: connectRounds.length ? Math.min(...connectRounds) : null,
        perfectCircles: entries.filter((entry) => entry.game.perfectCircle).length,
        // Left standing alone when the circle closed.
        wildcards: entries.filter(
          (entry) => entry.game.outcome === 'MATCHED' && entry.placement === null,
        ).length,
        unfinished: entries.filter((entry) => entry.game.outcome !== 'MATCHED').length,
        topPartners,
      },
    });
  }),
);
