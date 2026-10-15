import { z } from 'zod';
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

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(40),
});

export const uuidSchema = z.uuid('Invalid id');

export const idParamSchema = z.object({ id: uuidSchema });

export const createGameSchema = z.object({ friendId: uuidSchema });

export const joinByCodeSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Room codes are 6 letters or digits'),
});

export const submitWordSchema = z.object({
  gameId: uuidSchema,
  word: z.string().max(MAX_WORD_LENGTH * 2),
});

export const gameIdSchema = z.object({ gameId: uuidSchema });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
