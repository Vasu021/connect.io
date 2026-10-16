import { z } from 'zod';
import { AVATAR_IDS } from './avatars.js';
import { MAX_WORD_LENGTH } from '../game/words.js';

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only use letters, numbers and underscore');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

/**
 * 10 characters rather than 8: the only brake on offline cracking is entropy,
 * and the cost to the user is negligible. Capped at 200 so a huge input cannot
 * be used to burn CPU in bcrypt.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters');

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
});

/** Null clears the avatar and falls back to initials. */
export const avatarSchema = z.object({
  avatar: z.union([z.enum(AVATAR_IDS), z.null()]),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(40),
});

export const uuidSchema = z.uuid('Invalid id');

export const idParamSchema = z.object({ id: uuidSchema });

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Room codes are 6 letters or digits');

/** Milliseconds per round, as the host sets it in the lobby. */
export const roundDurationSchema = z.coerce
  .number()
  .int()
  .min(5_000, 'Rounds must be at least 5 seconds')
  .max(120_000, 'Rounds must be at most 2 minutes');

export const roomSettingsSchema = z
  .object({
    roundDurationMs: roundDurationSchema.optional(),
    maxPlayers: z.coerce.number().int().min(2).max(8).optional(),
  })
  .refine(
    (value) => value.roundDurationMs !== undefined || value.maxPlayers !== undefined,
    'Nothing to change',
  );

export const createRoomSchema = z.object({
  name: z.string().trim().max(40, 'Keep the room name under 40 characters').optional(),
  // Short by design: this is a "keep randoms out" code shared in chat, not a
  // credential. It is still bcrypt-hashed at rest.
  password: z.string().min(4, 'Use at least 4 characters').max(72).optional(),
  maxPlayers: z.coerce.number().int().min(2).max(8).default(8),
  roundDurationMs: roundDurationSchema.optional(),
});

export const joinRoomSchema = z.object({
  code: roomCodeSchema,
  password: z.string().max(72).optional(),
});

export const inviteSchema = z.object({ userId: uuidSchema });

export const quickPlaySchema = z.object({ friendId: uuidSchema });

export const leaderboardQuerySchema = z.object({
  size: z.coerce.number().int().min(2).max(8).optional(),
});

export const submitWordSchema = z.object({
  gameId: uuidSchema,
  word: z.string().max(MAX_WORD_LENGTH * 2),
});

export const gameIdSchema = z.object({ gameId: uuidSchema });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
