/**
 * Snapshots the two-player Game/Round rows before the multiplayer schema
 * replaces those columns. Pairs with `backfill-multiplayer.ts`, which reads the
 * file back in once the new tables exist.
 *
 *   npx tsx scripts/export-legacy-games.ts <outfile>
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const out = process.argv[2] ?? path.join(process.cwd(), 'legacy-games.json');

async function main() {
  const games = await prisma.game.findMany({
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  fs.writeFileSync(out, JSON.stringify(games, null, 2));
  const rounds = games.reduce((sum, g) => sum + g.rounds.length, 0);
  console.log(`Exported ${games.length} game(s) and ${rounds} round(s) to ${out}`);
}

main()
  .catch((err) => {
    console.error('Export failed:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
