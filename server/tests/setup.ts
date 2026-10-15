import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/db.js';
import { presence } from '../src/realtime/presence.js';
import { shutdownEngine } from '../src/game/engine.js';

beforeEach(async () => {
  // Round and Game cascade from User, but truncating explicitly keeps the order
  // obvious and the reset fast.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "WordImage", "Submission", "Connection", "Round", "GamePlayer", "Game", ' +
      '"RoomInvite", "RoomMember", "Room", "Friendship", "FriendRequest", "User" ' +
      'RESTART IDENTITY CASCADE',
  );
  shutdownEngine();
  presence.reset();
});

afterAll(async () => {
  shutdownEngine();
  await prisma.$disconnect();
});
