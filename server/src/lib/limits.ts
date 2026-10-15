import type { Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../env.js';

/**
 * Rate limits are the main defence against credential stuffing and friend-spam.
 * They are disabled under NODE_ENV=test so the suite is not throttled.
 */
function limiter(
  windowMs: number,
  limit: number,
  message: string,
  options: { countFailuresOnly?: boolean } = {},
) {
  return rateLimit({
    windowMs,
    limit: env.isTest ? 0 : limit,
    // Brute force is a stream of failures. Counting successes too would lock
    // out a legitimate user who simply signs in often.
    skipSuccessfulRequests: options.countFailuresOnly ?? false,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: ((_req: Request, res: Response) => {
      res.status(429).json({ error: 'rate_limited', message });
    }) as Options['handler'],
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Broad ceiling for the whole API. */
export const apiLimiter = limiter(15 * MINUTE, 600, 'Too many requests — slow down a moment.');

/** Tight: login and register are the brute-force surface. */
export const loginLimiter = limiter(
  15 * MINUTE,
  10,
  'Too many sign-in attempts. Try again in a few minutes.',
  { countFailuresOnly: true },
);

export const registerLimiter = limiter(HOUR, 5, 'Too many accounts created. Try again later.');

export const friendRequestLimiter = limiter(HOUR, 40, 'You are sending friend requests too fast.');

export const createGameLimiter = limiter(HOUR, 60, 'Too many games started. Take a breath.');

export const searchLimiter = limiter(MINUTE, 60, 'Too many searches — slow down.');
