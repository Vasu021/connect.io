import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { unauthorized } from './errors.js';

export const AUTH_COOKIE = 'connectio_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionUser = {
  id: string;
  username: string;
};

type TokenClaims = {
  sub: string;
  username: string;
};

/**
 * The session token lives in an httpOnly cookie rather than localStorage, so a
 * cross-site scripting bug cannot read it. The algorithm is pinned on verify to
 * rule out algorithm-confusion attacks.
 */
export function signSession(user: SessionUser): string {
  const claims: TokenClaims = { sub: user.id, username: user.username };
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: 'connect.io',
  });
}

export function verifySession(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'connect.io',
    });
    if (typeof decoded === 'string') return null;
    const { sub, username } = decoded as jwt.JwtPayload & Partial<TokenClaims>;
    if (typeof sub !== 'string' || typeof username !== 'string') return null;
    return { id: sub, username };
  } catch {
    return null;
  }
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  };
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  res.cookie(AUTH_COOKIE, signSession(user), cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Minimal cookie header parser — avoids depending on a transitive package. */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export type AuthedRequest = Request & { user: SessionUser };

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
  if (!token) {
    next(unauthorized());
    return;
  }

  const user = verifySession(token);
  if (!user) {
    next(unauthorized('Session expired — sign in again'));
    return;
  }

  (req as AuthedRequest).user = user;
  next();
}
