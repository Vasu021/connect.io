import 'node:process';
import { z } from 'zod';

/**
 * Environment is validated once at boot and the process exits on failure.
 * A misconfigured secret is a security defect, not a runtime warning, so there
 * is deliberately no fallback value for JWT_SECRET.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  /**
   * Pixabay key for word images. Deliberately optional: with no key the image
   * feature switches off and the game plays exactly as it does without it,
   * which is also why no test ever needs a live key.
   */
  PIXABAY_API_KEY: z.string().trim().min(1).optional(),
  /** Self-imposed ceiling, under Pixabay's documented 100 requests per minute. */
  PIXABAY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(80),
  /** Where downloaded image bytes live, relative to the server working directory. */
  IMAGE_STORE_DIR: z.string().default('data/word-images'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Round timings are configurable so the test suite can run the real engine
  // at millisecond speed instead of waiting out 15-second rounds.
  ROUND_DURATION_MS: z.coerce.number().int().min(200).max(120_000).default(15_000),
  REVEAL_PAUSE_MS: z.coerce.number().int().min(50).max(30_000).default(3_500),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(200).max(300_000).default(30_000),
  PRESENCE_ANNOUNCE_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(1_500),
  MAX_ROUNDS: z.coerce.number().int().min(1).max(100).default(15),
  /** Grace after the host starts, so stragglers do not miss round one. */
  START_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),
  /** Consecutive silent rounds before a player is nudged out of the circle. */
  MAX_MISSED_ROUNDS: z.coerce.number().int().min(1).max(20).default(3),
  INVITE_TTL_MS: z.coerce.number().int().min(1_000).default(60 * 60 * 1000),
  /** Only enable behind a proxy you control; it makes rate limiting trust X-Forwarded-For. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(`\nInvalid server environment:\n${issues}\n\nSee server/.env.example\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** Word images are available only when a key is configured. */
  imagesEnabled: Boolean(raw.PIXABAY_API_KEY),
  /** Multiple origins may be supplied as a comma-separated list. */
  allowedOrigins: raw.CLIENT_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  cookieSecure: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
} as const;

if (env.isProduction && env.COOKIE_SAMESITE === 'none' && !env.cookieSecure) {
  console.error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true. Refusing to start.');
  process.exit(1);
}
