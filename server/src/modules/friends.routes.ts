import { Router } from 'express';
import { prisma } from '../db.js';
import { type AuthedRequest, requireAuth } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../lib/errors.js';
import { areFriends, orderPair } from '../lib/friends.js';
import { friendRequestLimiter } from '../lib/limits.js';
import { idParamSchema, uuidSchema } from '../lib/validation.js';
import { emitToUser } from '../realtime/hub.js';
import { presence } from '../realtime/presence.js';
import { z } from 'zod';

export const friendsRouter = Router();

const sendRequestSchema = z.object({ toUserId: uuidSchema });

friendsRouter.use(requireAuth);

friendsRouter.get(
  '/',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const rows = await prisma.friendship.findMany({
      where: { OR: [{ user1Id: user.id }, { user2Id: user.id }] },
      select: {
        createdAt: true,
        user1: { select: { id: true, username: true } },
        user2: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const friends = rows
      .map((row) => {
        const friend = row.user1.id === user.id ? row.user2 : row.user1;
        return {
          id: friend.id,
          username: friend.username,
          online: presence.isOnline(friend.id),
          friendsSince: row.createdAt,
        };
      })
      // Online friends first — they are the ones you can actually play with.
      .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));

    res.json({ friends });
  }),
);

friendsRouter.get(
  '/requests',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const [incoming, outgoing] = await Promise.all([
      prisma.friendRequest.findMany({
        where: { toUserId: user.id, status: 'PENDING' },
        select: {
          id: true,
          createdAt: true,
          fromUser: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.friendRequest.findMany({
        where: { fromUserId: user.id, status: 'PENDING' },
        select: {
          id: true,
          createdAt: true,
          toUser: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      incoming: incoming.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: { ...r.fromUser, online: presence.isOnline(r.fromUser.id) },
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: { ...r.toUser, online: presence.isOnline(r.toUser.id) },
      })),
    });
  }),
);

friendsRouter.post(
  '/request',
  friendRequestLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { toUserId } = sendRequestSchema.parse(req.body);

    if (toUserId === user.id) throw badRequest('You cannot add yourself');

    const target = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, username: true },
    });
    if (!target) throw notFound('No such player');

    if (await areFriends(user.id, toUserId)) throw conflict('You are already friends');

    const pending = await prisma.friendRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { fromUserId: user.id, toUserId },
          { fromUserId: toUserId, toUserId: user.id },
        ],
      },
      select: { id: true, fromUserId: true },
    });

    // They already asked you — accept instead of stacking a second request.
    if (pending && pending.fromUserId === toUserId) {
      const [user1Id, user2Id] = orderPair(user.id, toUserId);
      await prisma.$transaction([
        prisma.friendRequest.update({
          where: { id: pending.id },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        }),
        prisma.friendship.create({ data: { user1Id, user2Id } }),
      ]);

      emitToUser(toUserId, 'friend:changed', { reason: 'accepted', by: user.username });
      res.json({ status: 'accepted', friend: target });
      return;
    }

    if (pending) throw conflict('Request already pending');

    const created = await prisma.friendRequest.create({
      data: { fromUserId: user.id, toUserId },
      select: { id: true, createdAt: true },
    });

    emitToUser(toUserId, 'friend:request_received', {
      requestId: created.id,
      from: { id: user.id, username: user.username },
    });
    emitToUser(toUserId, 'friend:changed', { reason: 'request_received' });

    res.status(201).json({ status: 'pending', request: created });
  }),
);

friendsRouter.post(
  '/requests/:id/accept',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const request = await prisma.friendRequest.findUnique({
      where: { id },
      select: { id: true, fromUserId: true, toUserId: true, status: true },
    });

    if (!request) throw notFound('Request not found');
    // Only the recipient may accept.
    if (request.toUserId !== user.id) throw forbidden();
    if (request.status !== 'PENDING') throw conflict('That request is no longer pending');

    const [user1Id, user2Id] = orderPair(request.fromUserId, request.toUserId);

    await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      }),
      prisma.friendship.create({ data: { user1Id, user2Id } }),
    ]);

    emitToUser(request.fromUserId, 'friend:request_accepted', {
      by: { id: user.id, username: user.username },
    });
    emitToUser(request.fromUserId, 'friend:changed', { reason: 'accepted' });

    res.json({ ok: true });
  }),
);

friendsRouter.post(
  '/requests/:id/reject',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const request = await prisma.friendRequest.findUnique({
      where: { id },
      select: { id: true, fromUserId: true, toUserId: true, status: true },
    });

    if (!request) throw notFound('Request not found');
    if (request.toUserId !== user.id) throw forbidden();
    if (request.status !== 'PENDING') throw conflict('That request is no longer pending');

    await prisma.friendRequest.update({
      where: { id },
      data: { status: 'REJECTED', respondedAt: new Date() },
    });

    emitToUser(request.fromUserId, 'friend:changed', { reason: 'rejected' });
    res.json({ ok: true });
  }),
);

/** Cancel a request you sent. */
friendsRouter.delete(
  '/requests/:id',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const request = await prisma.friendRequest.findUnique({
      where: { id },
      select: { id: true, fromUserId: true, toUserId: true, status: true },
    });

    if (!request) throw notFound('Request not found');
    // Only the sender may cancel.
    if (request.fromUserId !== user.id) throw forbidden();
    if (request.status !== 'PENDING') throw conflict('That request is no longer pending');

    await prisma.friendRequest.update({
      where: { id },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });

    emitToUser(request.toUserId, 'friend:changed', { reason: 'cancelled' });
    res.json({ ok: true });
  }),
);

friendsRouter.delete(
  '/:friendId',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const friendId = uuidSchema.parse(req.params.friendId);
    const [user1Id, user2Id] = orderPair(user.id, friendId);

    const existing = await prisma.friendship.findUnique({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      select: { id: true },
    });
    if (!existing) throw notFound('You are not friends');

    await prisma.friendship.delete({ where: { id: existing.id } });

    emitToUser(friendId, 'friend:changed', { reason: 'removed' });
    res.json({ ok: true });
  }),
);
