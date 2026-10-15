import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { disconnectDb } from './db.js';
import { env } from './env.js';
import { restoreLiveGames, shutdownEngine, sweepStaleInvites } from './game/engine.js';
import { registerSocketServer } from './realtime/sockets.js';

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: env.allowedOrigins,
    credentials: true,
  },
  // Keeps a dropped player's grace window meaningful rather than waiting on
  // the default 20s ping timeout before we notice.
  pingTimeout: 10_000,
  pingInterval: 5_000,
  maxHttpBufferSize: 8_000,
});

registerSocketServer(io);

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let sweepTimer: NodeJS.Timeout | null = null;

async function start() {
  const restored = await restoreLiveGames();
  if (restored > 0) console.log(`Restored ${restored} in-progress game(s).`);

  await sweepStaleInvites().catch((err) => console.error('invite sweep failed:', err));
  sweepTimer = setInterval(() => {
    void sweepStaleInvites().catch((err) => console.error('invite sweep failed:', err));
  }, SWEEP_INTERVAL_MS);

  httpServer.listen(env.PORT, () => {
    console.log(`connect.io server ready on http://localhost:${env.PORT}`);
    console.log(`allowing origin(s): ${env.allowedOrigins.join(', ')}`);
  });
}

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down.`);

  if (sweepTimer) clearInterval(sweepTimer);
  shutdownEngine();
  io.close();
  httpServer.close();
  await disconnectDb();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
