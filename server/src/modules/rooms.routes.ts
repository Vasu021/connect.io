import { Router } from 'express';
import { prisma } from '../db.js';
import { type AuthedRequest, requireAuth } from '../lib/auth.js';
import { badRequest, forbidden, notFound, wrap } from '../lib/errors.js';
import { createGameLimiter, inviteLimiter, joinLimiter } from '../lib/limits.js';
import {
  createRoomSchema,
  idParamSchema,
  inviteSchema,
  joinRoomSchema,
  quickPlaySchema,
  roomSettingsSchema,
  uuidSchema,
} from '../lib/validation.js';
import { MAX_PLAYERS } from '../game/constants.js';
import {
  createRoom,
  inviteToRoom,
  joinRoomByCode,
  kickFromRoom,
  leaveRoom,
  loadRoom,
  roomViewFor,
  startRoom,
  updateRoomSettings,
} from '../room/rooms.js';
import { emitToRoom, emitToUser } from '../realtime/hub.js';

export const roomsRouter = Router();

roomsRouter.use(requireAuth);

async function pushRoomState(roomId: string): Promise<void> {
  const room = await loadRoom(roomId);
  // Each member gets their own view, because `youAreHost` differs per viewer.
  for (const member of room.members) {
    emitToUser(member.userId, 'room:state', roomViewFor(room, member.userId));
  }
  emitToRoom(roomId, 'room:changed', { roomId });
}

roomsRouter.post(
  '/',
  createGameLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const input = createRoomSchema.parse(req.body);

    const room = await createRoom(user.id, input);
    res.status(201).json({ room: roomViewFor(room, user.id) });
  }),
);

/** One-click path from the friends list: a two-player room, already invited. */
roomsRouter.post(
  '/quick',
  createGameLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { friendId } = quickPlaySchema.parse(req.body);

    if (friendId === user.id) throw badRequest('You need someone to connect with');

    const friend = await prisma.user.findUnique({
      where: { id: friendId },
      select: { id: true },
    });
    if (!friend) throw notFound('No such player');

    const room = await createRoom(user.id, { maxPlayers: 2 });
    await inviteToRoom(room.id, user.id, friendId);

    res.status(201).json({ room: roomViewFor(await loadRoom(room.id), user.id) });
  }),
);

roomsRouter.post(
  '/join',
  joinLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { code, password } = joinRoomSchema.parse(req.body);

    const room = await joinRoomByCode(user.id, code, password);
    await pushRoomState(room.id);

    res.json({ room: roomViewFor(room, user.id) });
  }),
);

roomsRouter.get(
  '/invites',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const invites = await prisma.roomInvite.findMany({
      where: { toUserId: user.id, status: 'PENDING', room: { status: 'LOBBY' } },
      select: {
        id: true,
        createdAt: true,
        fromUser: { select: { id: true, username: true } },
        room: {
          select: {
            id: true,
            code: true,
            name: true,
            maxPlayers: true,
            passwordHash: true,
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        createdAt: invite.createdAt.toISOString(),
        from: invite.fromUser,
        room: {
          id: invite.room.id,
          code: invite.room.code,
          name: invite.room.name,
          maxPlayers: invite.room.maxPlayers,
          // The invite itself is the authorisation; they will not be asked.
          hasPassword: invite.room.passwordHash !== null,
          memberCount: invite.room._count.members,
        },
      })),
    });
  }),
);

/** Lobbies the viewer is currently sitting in. */
roomsRouter.get(
  '/mine',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;

    const rooms = await prisma.room.findMany({
      where: { status: { in: ['LOBBY', 'IN_GAME'] }, members: { some: { userId: user.id } } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    const views = [];
    for (const row of rooms) {
      views.push(roomViewFor(await loadRoom(row.id), user.id));
    }

    res.json({ rooms: views });
  }),
);

roomsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const room = await loadRoom(id);
    if (!room.members.some((member) => member.userId === user.id)) {
      // Not a member: do not confirm the room even exists.
      throw notFound('Room not found');
    }

    res.json({ room: roomViewFor(room, user.id) });
  }),
);

roomsRouter.post(
  '/:id/invite',
  inviteLimiter,
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);
    const { userId } = inviteSchema.parse(req.body);

    await inviteToRoom(id, user.id, userId);
    await pushRoomState(id);

    res.status(201).json({ ok: true });
  }),
);

/** Host-only lobby settings: round length, room size. */
roomsRouter.post(
  '/:id/settings',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);
    const settings = roomSettingsSchema.parse(req.body);

    const room = await updateRoomSettings(id, user.id, settings);
    await pushRoomState(id);

    res.json({ room: roomViewFor(room, user.id) });
  }),
);

roomsRouter.post(
  '/:id/start',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const gameId = await startRoom(id, user.id);
    res.json({ gameId });
  }),
);

roomsRouter.post(
  '/:id/leave',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    await leaveRoom(id, user.id);
    const room = await prisma.room.findUnique({ where: { id }, select: { status: true } });
    if (room && room.status !== 'CLOSED') await pushRoomState(id);

    res.json({ ok: true });
  }),
);

roomsRouter.delete(
  '/:id/members/:userId',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);
    const targetId = uuidSchema.parse(req.params.userId);

    await kickFromRoom(id, user.id, targetId);
    await pushRoomState(id);

    res.json({ ok: true });
  }),
);

roomsRouter.post(
  '/:id/decline',
  wrap(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { id } = idParamSchema.parse(req.params);

    const invite = await prisma.roomInvite.findUnique({
      where: { roomId_toUserId: { roomId: id, toUserId: user.id } },
      select: { status: true },
    });
    if (!invite) throw notFound('No invite to decline');
    if (invite.status !== 'PENDING') throw badRequest('That invite is no longer pending');

    await prisma.roomInvite.update({
      where: { roomId_toUserId: { roomId: id, toUserId: user.id } },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });

    res.json({ ok: true });
  }),
);

export { MAX_PLAYERS };
