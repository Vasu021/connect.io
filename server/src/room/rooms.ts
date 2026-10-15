import { compare, hash } from 'bcryptjs';
import { prisma } from '../db.js';
import {
  MAX_PLAYERS,
  MAX_ROUND_DURATION_MS,
  MIN_PLAYERS,
  MIN_ROUND_DURATION_MS,
  ROUND_DURATION_MS,
} from '../game/constants.js';
import { createGameForRoom, liveGameForRoom } from '../game/engine.js';
import type { RoomView } from '../game/types.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { randomRoomCode } from '../lib/codes.js';
import { emitToUser } from '../realtime/hub.js';
import { presence } from '../realtime/presence.js';

const BCRYPT_COST = 12;
/** Lobbies nobody started are swept after this long. */
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

const roomSelect = {
  id: true,
  code: true,
  name: true,
  passwordHash: true,
  hostId: true,
  maxPlayers: true,
  roundDurationMs: true,
  status: true,
  createdAt: true,
  members: {
    select: { userId: true, joinedAt: true, user: { select: { username: true } } },
    orderBy: { joinedAt: 'asc' },
  },
} as const;

type RoomRow = {
  id: string;
  code: string;
  name: string | null;
  passwordHash: string | null;
  hostId: string;
  maxPlayers: number;
  roundDurationMs: number;
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED';
  createdAt: Date;
  members: { userId: string; joinedAt: Date; user: { username: string } }[];
};

export function roomViewFor(room: RoomRow, viewerId: string): RoomView {
  const online = presence.onlineAmong(room.members.map((m) => m.userId));

  return {
    id: room.id,
    code: room.code,
    name: room.name,
    hasPassword: room.passwordHash !== null,
    maxPlayers: room.maxPlayers,
    roundDurationMs: room.roundDurationMs,
    status: room.status,
    hostId: room.hostId,
    youAreHost: room.hostId === viewerId,
    members: room.members.map((member) => ({
      id: member.userId,
      username: member.user.username,
      online: online.has(member.userId),
      isHost: member.userId === room.hostId,
      isYou: member.userId === viewerId,
    })),
    activeGameId: liveGameForRoom(room.id)?.id ?? null,
    createdAt: room.createdAt.toISOString(),
  };
}

export async function loadRoom(roomId: string): Promise<RoomRow> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: roomSelect });
  if (!room) throw notFound('Room not found');
  return room as RoomRow;
}

export async function createRoom(
  hostId: string,
  options: { name?: string; password?: string; maxPlayers: number; roundDurationMs?: number },
): Promise<RoomRow> {
  if (options.maxPlayers < MIN_PLAYERS || options.maxPlayers > MAX_PLAYERS) {
    throw badRequest(`A room holds ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }

  const passwordHash = options.password ? await hash(options.password, BCRYPT_COST) : null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const room = await prisma.room.create({
        data: {
          code: randomRoomCode(),
          name: options.name?.trim() || null,
          passwordHash,
          hostId,
          maxPlayers: options.maxPlayers,
          // Defaults to the server's configured round length, which the test
          // suite turns right down.
          roundDurationMs: options.roundDurationMs ?? ROUND_DURATION_MS,
          status: 'LOBBY',
          members: { create: [{ userId: hostId }] },
        },
        select: roomSelect,
      });
      return room as RoomRow;
    } catch (err) {
      // Astronomically unlikely code collision; try again.
      if ((err as { code?: string }).code !== 'P2002' || attempt === 4) throw err;
    }
  }

  throw new Error('Could not allocate a room code');
}

/**
 * Joining by code needs the password — unless the user was explicitly invited,
 * in which case the invite is the authorisation.
 *
 * A wrong code and a wrong password fail identically, so the endpoint cannot be
 * used to discover which rooms exist.
 */
export async function joinRoomByCode(
  userId: string,
  code: string,
  password: string | undefined,
): Promise<RoomRow> {
  const room = (await prisma.room.findUnique({
    where: { code },
    select: roomSelect,
  })) as RoomRow | null;

  if (!room || room.status === 'CLOSED') throw notFound('No open room with that code');

  if (room.members.some((member) => member.userId === userId)) return room;

  if (room.status === 'IN_GAME') throw conflict('That game has already started');

  const invited = await prisma.roomInvite.findUnique({
    where: { roomId_toUserId: { roomId: room.id, toUserId: userId } },
    select: { status: true },
  });
  const hasInvite = invited !== null && invited.status === 'PENDING';

  if (room.passwordHash && !hasInvite) {
    if (!password || !(await compare(password, room.passwordHash))) {
      throw notFound('No open room with that code');
    }
  }

  if (room.members.length >= room.maxPlayers) throw conflict('That room is full');

  await prisma.$transaction(async (tx) => {
    await tx.roomMember.create({ data: { roomId: room.id, userId } });
    if (hasInvite) {
      await tx.roomInvite.update({
        where: { roomId_toUserId: { roomId: room.id, toUserId: userId } },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
    }
  });

  return loadRoom(room.id);
}

export async function inviteToRoom(
  roomId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const room = await loadRoom(roomId);

  if (room.status !== 'LOBBY') throw conflict('That room is no longer open');
  if (!room.members.some((member) => member.userId === fromUserId)) {
    throw forbidden('You are not in this room');
  }
  if (room.members.some((member) => member.userId === toUserId)) {
    throw conflict('They are already in the room');
  }
  if (room.members.length >= room.maxPlayers) throw conflict('That room is full');

  // Anyone can be invited — friendship is not required to play.
  const target = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, username: true },
  });
  if (!target) throw notFound('No such player');

  const inviter = await prisma.user.findUniqueOrThrow({
    where: { id: fromUserId },
    select: { username: true },
  });

  await prisma.roomInvite.upsert({
    where: { roomId_toUserId: { roomId, toUserId } },
    create: { roomId, fromUserId, toUserId, status: 'PENDING' },
    update: { fromUserId, status: 'PENDING', createdAt: new Date(), respondedAt: null },
  });

  emitToUser(toUserId, 'room:invited', {
    roomId,
    code: room.code,
    name: room.name,
    hasPassword: room.passwordHash !== null,
    from: { id: fromUserId, username: inviter.username },
  });
  emitToUser(toUserId, 'rooms:changed', { reason: 'invited' });
}

/**
 * Lobby settings the host can change before anyone plays. Round length is the
 * interesting one: eight players need longer to read what the group just said
 * than two do.
 */
export async function updateRoomSettings(
  roomId: string,
  hostId: string,
  settings: { roundDurationMs?: number; maxPlayers?: number },
): Promise<RoomRow> {
  const room = await loadRoom(roomId);

  if (room.hostId !== hostId) throw forbidden('Only the host can change the room');
  if (room.status !== 'LOBBY') throw conflict('The game has already started');

  if (settings.roundDurationMs !== undefined) {
    const value = settings.roundDurationMs;
    if (value < MIN_ROUND_DURATION_MS || value > MAX_ROUND_DURATION_MS) {
      throw badRequest('That round length is out of range');
    }
  }

  if (settings.maxPlayers !== undefined) {
    if (settings.maxPlayers < MIN_PLAYERS || settings.maxPlayers > MAX_PLAYERS) {
      throw badRequest(`A room holds ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
    }
    // Shrinking below the people already sitting here would strand them.
    if (settings.maxPlayers < room.members.length) {
      throw conflict(`There are already ${room.members.length} players in the room`);
    }
  }

  await prisma.room.update({
    where: { id: roomId },
    data: {
      ...(settings.roundDurationMs !== undefined
        ? { roundDurationMs: settings.roundDurationMs }
        : {}),
      ...(settings.maxPlayers !== undefined ? { maxPlayers: settings.maxPlayers } : {}),
    },
  });

  return loadRoom(roomId);
}

/** Leaving transfers the host role; the last person out closes the room. */
export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  const room = await loadRoom(roomId);
  if (!room.members.some((member) => member.userId === userId)) return;

  const remaining = room.members.filter((member) => member.userId !== userId);

  await prisma.$transaction(async (tx) => {
    await tx.roomMember.deleteMany({ where: { roomId, userId } });

    if (remaining.length === 0) {
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      return;
    }

    if (room.hostId === userId) {
      const next = remaining[0];
      if (next) await tx.room.update({ where: { id: roomId }, data: { hostId: next.userId } });
    }
  });

  for (const member of remaining) {
    emitToUser(member.userId, 'rooms:changed', { reason: 'member_left' });
  }
}

export async function kickFromRoom(
  roomId: string,
  hostId: string,
  targetId: string,
): Promise<void> {
  const room = await loadRoom(roomId);
  if (room.hostId !== hostId) throw forbidden('Only the host can remove players');
  if (targetId === hostId) throw badRequest('You cannot remove yourself — leave instead');
  if (room.status !== 'LOBBY') throw conflict('The game has already started');

  await prisma.roomMember.deleteMany({ where: { roomId, userId: targetId } });
  emitToUser(targetId, 'room:kicked', { roomId });
  emitToUser(targetId, 'rooms:changed', { reason: 'kicked' });
}

/** Only the host starts, and only with a legal number of players. */
export async function startRoom(roomId: string, hostId: string): Promise<string> {
  const room = await loadRoom(roomId);

  if (room.hostId !== hostId) throw forbidden('Only the host can start the game');
  if (room.status === 'IN_GAME') {
    const existing = liveGameForRoom(roomId);
    if (existing) return existing.id;
    throw conflict('That game has already started');
  }
  if (room.status === 'CLOSED') throw conflict('That room is closed');
  if (room.members.length < MIN_PLAYERS) {
    throw badRequest(`You need at least ${MIN_PLAYERS} players to start`);
  }
  if (room.members.length > room.maxPlayers) throw badRequest('That room is over capacity');

  const gameId = await createGameForRoom(
    { id: room.id, code: room.code, roundDurationMs: room.roundDurationMs },
    room.members.map((member) => ({ userId: member.userId, username: member.user.username })),
  );

  await prisma.$transaction([
    prisma.room.update({ where: { id: roomId }, data: { status: 'IN_GAME' } }),
    // Outstanding invites are moot once play begins.
    prisma.roomInvite.updateMany({
      where: { roomId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    }),
  ]);

  return gameId;
}

/** Lobbies nobody ever started, and rooms whose game is long finished. */
export async function sweepStaleRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - ROOM_TTL_MS);
  const stale = await prisma.room.findMany({
    where: { status: 'LOBBY', createdAt: { lt: cutoff } },
    select: { id: true, members: { select: { userId: true } } },
  });

  for (const room of stale) {
    await prisma.room.update({
      where: { id: room.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    for (const member of room.members) {
      emitToUser(member.userId, 'rooms:changed', { reason: 'expired' });
    }
  }

  return stale.length;
}
