import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { errorHandler } from './lib/errors.js';
import { apiLimiter } from './lib/limits.js';
import { authRouter } from './modules/auth.routes.js';
import { friendsRouter } from './modules/friends.routes.js';
import { gamesRouter } from './modules/games.routes.js';
import { imagesRouter } from './modules/images.routes.js';
import { roomsRouter } from './modules/rooms.routes.js';
import { usersRouter } from './modules/users.routes.js';

export function createApp() {
  const app = express();

  // Only trust X-Forwarded-For when explicitly told to: otherwise any client
  // could spoof its IP and sidestep the rate limiters.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; the client is a separate origin with its own CSP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin || env.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    }),
  );

  // Small cap: every endpoint takes a short JSON body, so anything larger is abuse.
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'connect.io' });
  });

  // Mounted ahead of the general limiter on purpose: eight players loading
  // image tags is a burst of cheap, cached file reads, and counting them
  // against the API budget would throttle actual gameplay requests.
  app.use('/api/images', imagesRouter);

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/rooms', roomsRouter);
  app.use('/api/games', gamesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint' });
  });

  app.use(errorHandler);

  return app;
}
