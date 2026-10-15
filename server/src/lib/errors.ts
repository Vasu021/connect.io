import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../env.js';

/** An error whose message is safe to show the client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (m: string) => new AppError(400, m, 'bad_request');
export const unauthorized = (m = 'Not signed in') => new AppError(401, m, 'unauthorized');
export const forbidden = (m = 'Not allowed') => new AppError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new AppError(404, m, 'not_found');
export const conflict = (m: string) => new AppError(409, m, 'conflict');

/**
 * Express 5 forwards rejected promises from async handlers automatically, but
 * wrapping keeps the behaviour explicit and unit-testable.
 */
export function wrap<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(handler(req as T, res, next)).catch(next);
  };
}

/** Extracts a 4xx status from an http-errors style object, if present. */
function httpStatusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = (err as { status?: unknown; statusCode?: unknown });
  const raw = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 400 && raw < 500 ? raw : null;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    const first = err.issues[0];
    res.status(400).json({
      error: 'validation_failed',
      message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input',
    });
    return;
  }

  // body-parser and friends throw http-errors-shaped objects (a JSON syntax
  // error, a payload over the 16kb cap). Those are client mistakes, not bugs,
  // so they must not surface as a 500.
  const status = httpStatusOf(err);
  if (status !== null) {
    res.status(status).json({
      error: status === 413 ? 'payload_too_large' : 'bad_request',
      message:
        status === 413 ? 'That request was too large.' : 'That request could not be understood.',
    });
    return;
  }

  // Anything unrecognised is a bug: log it server-side, tell the client nothing.
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'internal_error',
    message: env.isProduction ? 'Something went wrong' : String((err as Error)?.message ?? err),
  });
}
