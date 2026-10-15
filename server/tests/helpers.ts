import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as IoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { registerSocketServer } from '../src/realtime/sockets.js';
import { AUTH_COOKIE } from '../src/lib/auth.js';

export type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const app = createApp();
  const httpServer: HttpServer = createServer(app);
  const io = new IoServer(httpServer, {
    cors: { origin: ['http://localhost:5173'], credentials: true },
    pingInterval: 200,
    pingTimeout: 300,
  });
  registerSocketServer(io);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export type TestUser = {
  id: string;
  username: string;
  cookie: string;
};

function sessionCookie(response: Response): string {
  const all = response.headers.getSetCookie();
  const match = all.find((c) => c.startsWith(`${AUTH_COOKIE}=`));
  if (!match) throw new Error('No session cookie in response');
  return match.split(';')[0] as string;
}

export function api(server: TestServer) {
  async function request(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string } = {},
  ) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { status: response.status, body: json, response };
  }

  return {
    request,
    get: (path: string, cookie?: string) => request('GET', path, { cookie }),
    post: (path: string, body?: unknown, cookie?: string) => request('POST', path, { body, cookie }),
    del: (path: string, cookie?: string) => request('DELETE', path, { cookie }),

    async register(username: string, password = 'a-very-good-password'): Promise<TestUser> {
      const response = await fetch(`${server.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email: `${username.toLowerCase()}@example.com`,
          password,
        }),
      });

      if (response.status !== 201) {
        throw new Error(`register(${username}) failed: ${response.status} ${await response.text()}`);
      }

      const body = (await response.json()) as { user: { id: string; username: string } };
      return { id: body.user.id, username: body.user.username, cookie: sessionCookie(response) };
    },

    /** Creates a room with this user as host. */
    async createRoom(
      host: TestUser,
      options: { password?: string; maxPlayers?: number; name?: string } = {},
    ): Promise<{ id: string; code: string }> {
      const result = await request('POST', '/api/rooms', {
        body: { maxPlayers: options.maxPlayers ?? 8, ...options },
        cookie: host.cookie,
      });
      if (result.status !== 201) {
        throw new Error(`createRoom failed: ${result.status} ${JSON.stringify(result.body)}`);
      }
      const room = result.body.room as { id: string; code: string };
      return room;
    },

    /** Invites a user, then has them accept by joining with the room code. */
    async inviteAndJoin(host: TestUser, roomId: string, code: string, guest: TestUser) {
      const invited = await request('POST', `/api/rooms/${roomId}/invite`, {
        body: { userId: guest.id },
        cookie: host.cookie,
      });
      if (invited.status !== 201) {
        throw new Error(`invite failed: ${invited.status} ${JSON.stringify(invited.body)}`);
      }
      // No password supplied: the invite is the authorisation.
      const joined = await request('POST', '/api/rooms/join', {
        body: { code },
        cookie: guest.cookie,
      });
      if (joined.status !== 200) {
        throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
      }
    },

    async startRoom(host: TestUser, roomId: string): Promise<string> {
      const result = await request('POST', `/api/rooms/${roomId}/start`, { cookie: host.cookie });
      if (result.status !== 200) {
        throw new Error(`start failed: ${result.status} ${JSON.stringify(result.body)}`);
      }
      return (result.body as { gameId: string }).gameId;
    },

    /** Makes two users friends by sending and accepting a request. */
    async befriend(a: TestUser, b: TestUser): Promise<void> {
      const sent = await request('POST', '/api/friends/request', {
        body: { toUserId: b.id },
        cookie: a.cookie,
      });
      if (sent.status !== 201) throw new Error(`friend request failed: ${sent.status}`);

      const requests = await request('GET', '/api/friends/requests', { cookie: b.cookie });
      const incoming = (requests.body as { incoming: { id: string }[] }).incoming;
      const first = incoming[0];
      if (!first) throw new Error('no incoming request to accept');

      const accepted = await request('POST', `/api/friends/requests/${first.id}/accept`, {
        cookie: b.cookie,
      });
      if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status}`);
    },
  };
}

export function connectSocket(server: TestServer, user: TestUser): ClientSocket {
  return ioClient(server.baseUrl, {
    extraHeaders: { Cookie: user.cookie },
    transports: ['websocket'],
    reconnection: false,
  });
}

/** Resolves with the first payload emitted for `event`, or rejects on timeout. */
export function waitFor<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);

    function handler(payload: T) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

/**
 * Resolves with the first payload for `event` that satisfies `predicate`.
 * Needed because a client may have several state broadcasts in flight, so
 * "the next one" is not necessarily the one the assertion cares about.
 */
export function waitForWhere<T = unknown>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for a matching "${event}"`));
    }, timeoutMs);

    function handler(payload: T) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
