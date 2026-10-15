/**
 * Creates eight demo players for local testing.
 *
 *   npx tsx scripts/seed-demo.ts
 *
 * Seeding directly rather than through /api/auth/register on purpose: the
 * register endpoint is rate limited to five accounts an hour, which is correct
 * for production and useless for a local eight-player game.
 */
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PASSWORD = 'connect-io-demo-pass';
const NAMES = ['demo1', 'demo2', 'demo3', 'demo4', 'demo5', 'demo6', 'demo7', 'demo8'];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo accounts in production.');
    process.exit(1);
  }

  const passwordHash = await hash(PASSWORD, 12);
  const ids: string[] = [];

  for (const username of NAMES) {
    const user = await prisma.user.upsert({
      where: { usernameLower: username },
      update: {},
      create: {
        username,
        usernameLower: username,
        email: `${username}@example.com`,
        passwordHash,
      },
      select: { id: true },
    });
    ids.push(user.id);
  }

  // Befriend demo1 with everyone, so the friends-list invite path is testable.
  const host = ids[0] as string;
  for (const other of ids.slice(1)) {
    const [user1Id, user2Id] = host < other ? [host, other] : [other, host];
    await prisma.friendship.upsert({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      update: {},
      create: { user1Id, user2Id },
    });
  }

  console.log(`Seeded ${NAMES.length} demo players (password: ${PASSWORD}).`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
