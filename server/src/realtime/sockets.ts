import type { Server, Socket } from 'socket.io';
import { env } from '../env.js';
import { AUTH_COOKIE, type SessionUser, parseCookieHeader, verifySession } from '../lib/auth.js';
import { friendIdsOf } from '../lib/friends.js';
import { gameIdSchema, idParamSchema, submitWordSchema } from '../lib/validation.js';
import {
  forfeit,
  handleSocketDisconnect,
  joinRoom,
  notifyPresenceChange,
  submitWord,
} from '../game/engine.js';
import { gameRoom, lobbyRoom, setIo, userRoom } from './hub.js';
import { presence } from './presence.js';

type AuthedSocket = Socket & { data: { user: SessionUser } };

/**
 * Per-socket event budget. A client that floods us is throttled rather than
 * disconnected, so a bad network does not look like an attack.
 */
const EVENT_WINDOW_MS = 10_000;
const EVENT_BUDGET = 60;

const budgets = new WeakMap<Socket, { count: number; resetAt: number }>();

function overBudget(socket: Socket): boolean {
  const now = Date.now();
  const entry = budgets.get(socket);
  if (!entry || now > entry.resetAt) {
    budgets.set(socket, { count: 1, resetAt: now + EVENT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > EVENT_BUDGET;
}

export function registerSocketServer(io: Server): void {
  setIo(io);

  // Authenticate from the same httpOnly cookie the REST API uses: the token is
  // never handed to client JavaScript, so it cannot be replayed by injected code.
  io.use((socket, next) => {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie);
    const token = cookies[AUTH_COOKIE];
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    const user = verifySession(token);
    if (!user) {
      next(new Error('unauthorized'));
      return;
    }

    (socket as AuthedSocket).data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = (socket as AuthedSocket).data;

    void socket.join(userRoom(user.id));

    const cameOnline = presence.add(user.id, socket.id);
    if (cameOnline) {
      notifyPresenceChange(user.id, true);
      void friendIdsOf(user.id)
        .then((friendIds) => {
          for (const friendId of friendIds) {
            io.to(userRoom(friendId)).emit('presence:friend', {
              userId: user.id,
              username: user.username,
              online: true,
            });
          }
        })
        .catch((err) => console.error('presence fan-out failed:', err));
    }

    socket.emit('session:ready', { userId: user.id, username: user.username });

    // ── Lobby ────────────────────────────────────────────────────────────
    socket.on('room:join', (payload: unknown) => {
      if (overBudget(socket)) return;
      const parsed = idParamSchema.safeParse(payload);
      if (!parsed.success) return;
      // Membership is enforced by the REST layer; this only subscribes the
      // socket to lobby broadcasts, which carry no privileged data.
      void socket.join(lobbyRoom(parsed.data.id));
    });

    socket.on('room:leave', (payload: unknown) => {
      if (overBudget(socket)) return;
      const parsed = idParamSchema.safeParse(payload);
      if (!parsed.success) return;
      void socket.leave(lobbyRoom(parsed.data.id));
    });

    // ── Game ─────────────────────────────────────────────────────────────
    socket.on('game:join', (payload: unknown) => {
      if (overBudget(socket)) return;
      const parsed = gameIdSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('game:error', { message: 'Invalid game id' });
        return;
      }

      void joinRoom(socket.id, user.id, parsed.data.gameId)
        .then((result) => {
          if (!result.ok) {
            socket.emit('game:error', { message: result.message });
            return;
          }
          void socket.join(gameRoom(parsed.data.gameId));
          socket.emit('game:state', result.state);
        })
        .catch((err) => {
          console.error('game:join failed:', err);
          socket.emit('game:error', { message: 'Could not join that room' });
        });
    });

    socket.on('game:submit', (payload: unknown) => {
      if (overBudget(socket)) {
        socket.emit('game:error', { message: 'Slow down a moment.' });
        return;
      }

      const parsed = submitWordSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('game:error', { message: 'That word was not accepted.' });
        return;
      }

      void submitWord(user.id, parsed.data.gameId, parsed.data.word)
        .then((result) => {
          if (!result.ok) {
            socket.emit('game:error', { message: result.message });
            return;
          }
          socket.emit('game:submitted', { gameId: parsed.data.gameId });
        })
        .catch((err) => {
          console.error('game:submit failed:', err);
          socket.emit('game:error', { message: 'Could not lock in that word' });
        });
    });

    socket.on('game:forfeit', (payload: unknown) => {
      if (overBudget(socket)) return;
      const parsed = gameIdSchema.safeParse(payload);
      if (!parsed.success) return;

      void forfeit(user.id, parsed.data.gameId).then((result) => {
        if (!result.ok) socket.emit('game:error', { message: result.message });
      }).catch((err) => console.error('game:forfeit failed:', err));
    });

    socket.on('game:leave', (payload: unknown) => {
      if (overBudget(socket)) return;
      const parsed = gameIdSchema.safeParse(payload);
      if (!parsed.success) return;
      void socket.leave(gameRoom(parsed.data.gameId));
      handleSocketDisconnect(socket.id, user.id);
    });

    socket.on('disconnect', () => {
      // Engine first: it registers the pending-announcement timer that the
      // presence fan-out below checks before emitting anything itself.
      handleSocketDisconnect(socket.id, user.id);

      const wentOffline = presence.remove(user.id, socket.id);
      if (!wentOffline) return;

      notifyPresenceChange(user.id, false);
      void friendIdsOf(user.id)
        .then((friendIds) => {
          for (const friendId of friendIds) {
            io.to(userRoom(friendId)).emit('presence:friend', {
              userId: user.id,
              username: user.username,
              online: false,
            });
          }
        })
        .catch((err) => console.error('presence fan-out failed:', err));
    });
  });

  if (!env.isTest) {
    io.engine.on('connection_error', (err) => {
      // Unauthenticated handshakes are expected (logged-out tab); keep them quiet.
      if (err.message !== 'unauthorized') console.warn('socket connection error:', err.message);
    });
  }
}
