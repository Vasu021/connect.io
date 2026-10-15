import { Router } from 'express';
import { compare, hash } from 'bcryptjs';
import { prisma } from '../db.js';
import {
  type AuthedRequest,
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from '../lib/auth.js';
import { conflict, unauthorized, wrap } from '../lib/errors.js';
import { loginLimiter, registerLimiter } from '../lib/limits.js';
import { loginSchema, registerSchema } from '../lib/validation.js';

export const authRouter = Router();

/** Cost 12: ~250ms per hash on commodity hardware — slow for attackers, fine for users. */
const BCRYPT_COST = 12;

/**
 * A real bcrypt hash of a random string. Comparing against it when no user
 * matches keeps the response time for "unknown user" and "wrong password" the
 * same, so login cannot be used to enumerate accounts by timing.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.kgVqD0qH4dMFcQ8bTqzS/0bNBrBVBMa';

authRouter.post(
  '/register',
  registerLimiter,
  wrap(async (req, res) => {
    const { username, email, password } = registerSchema.parse(req.body);
    const usernameLower = username.toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ usernameLower }, { email }] },
      select: { usernameLower: true, email: true },
    });

    if (existing) {
      throw conflict(
        existing.usernameLower === usernameLower
          ? 'That username is taken'
          : 'An account already exists for that email',
      );
    }

    const user = await prisma.user.create({
      data: {
        username,
        usernameLower,
        email,
        passwordHash: await hash(password, BCRYPT_COST),
      },
      select: { id: true, username: true, email: true, createdAt: true },
    });

    setSessionCookie(res, { id: user.id, username: user.username });
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const needle = identifier.toLowerCase();

    const user = await prisma.user.findFirst({
      where: { OR: [{ usernameLower: needle }, { email: needle }] },
    });

    const passwordOk = await compare(password, user?.passwordHash ?? DUMMY_HASH);

    // One message for both failure modes — never reveal whether the account exists.
    if (!user || !passwordOk) throw unauthorized('Incorrect username or password');

    setSessionCookie(res, { id: user.id, username: user.username });
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const { user: session } = req as AuthedRequest;
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, username: true, email: true, createdAt: true },
    });

    // Token is valid but the account is gone (deleted between requests).
    if (!user) {
      clearSessionCookie(res);
      throw unauthorized('Account no longer exists');
    }

    res.json({ user });
  }),
);
