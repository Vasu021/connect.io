import { prisma } from '../db.js';

/**
 * Friendships are undirected. Storing the pair in a fixed order lets a single
 * unique constraint reject duplicates no matter who sent the request.
 */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [user1Id, user2Id] = orderPair(a, b);
  const row = await prisma.friendship.findUnique({
    where: { user1Id_user2Id: { user1Id, user2Id } },
    select: { id: true },
  });
  return row !== null;
}

export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
    select: { user1Id: true, user2Id: true },
  });
  return rows.map((row) => (row.user1Id === userId ? row.user2Id : row.user1Id));
}
