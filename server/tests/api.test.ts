import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let client: ReturnType<typeof api>;

beforeAll(async () => {
  server = await startTestServer();
  client = api(server);
});

afterAll(async () => {
  await server.close();
});

describe('registration', () => {
  it('creates an account and sets an httpOnly session cookie', async () => {
    const response = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'vasu',
        email: 'vasu@example.com',
        password: 'a-very-good-password',
      }),
    });

    expect(response.status).toBe(201);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('connectio_session='));
    expect(cookie).toBeDefined();
    // The token must be unreadable from client JavaScript.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('never returns the password hash', async () => {
    const user = await client.register('hashcheck');
    const me = await client.get('/api/auth/me', user.cookie);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('rejects a short password', async () => {
    const result = await client.post('/api/auth/register', {
      username: 'shorty',
      email: 'shorty@example.com',
      password: 'short',
    });
    expect(result.status).toBe(400);
  });

  it('rejects an invalid username', async () => {
    const result = await client.post('/api/auth/register', {
      username: 'bad name!',
      email: 'bad@example.com',
      password: 'a-very-good-password',
    });
    expect(result.status).toBe(400);
  });

  it('rejects a duplicate username regardless of case', async () => {
    await client.register('Taken');
    const result = await client.post('/api/auth/register', {
      username: 'taken',
      email: 'other@example.com',
      password: 'a-very-good-password',
    });
    expect(result.status).toBe(409);
  });
});

describe('login', () => {
  it('accepts a username or an email', async () => {
    await client.register('loginer');

    const byUsername = await client.post('/api/auth/login', {
      identifier: 'loginer',
      password: 'a-very-good-password',
    });
    expect(byUsername.status).toBe(200);

    const byEmail = await client.post('/api/auth/login', {
      identifier: 'loginer@example.com',
      password: 'a-very-good-password',
    });
    expect(byEmail.status).toBe(200);
  });

  it('gives the same message for a wrong password and an unknown account', async () => {
    await client.register('realuser');

    const wrongPassword = await client.post('/api/auth/login', {
      identifier: 'realuser',
      password: 'not-the-password',
    });
    const unknownUser = await client.post('/api/auth/login', {
      identifier: 'ghost-account',
      password: 'not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    // Identical wording — login must not be usable to enumerate accounts.
    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
  });

  it('refuses protected routes without a session', async () => {
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/friends')).status).toBe(401);
    expect((await client.get('/api/games/active')).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const result = await client.get('/api/auth/me', 'connectio_session=not-a-real-token');
    expect(result.status).toBe(401);
  });

  it('clears the cookie on logout', async () => {
    const user = await client.register('logouter');
    const result = await client.post('/api/auth/logout', undefined, user.cookie);
    expect(result.status).toBe(200);
    const cleared = result.response.headers
      .getSetCookie()
      .find((c) => c.startsWith('connectio_session='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});

describe('user search', () => {
  it('finds other players without exposing their email', async () => {
    const me = await client.register('searcher');
    await client.register('findme');

    const result = await client.get('/api/users/search?q=findme', me.cookie);
    expect(result.status).toBe(200);

    const users = result.body.users as { username: string }[];
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe('findme');
    // An authenticated search must not turn the user table into an address book.
    expect(JSON.stringify(result.body)).not.toMatch(/@example\.com/);
  });

  it('excludes the searcher themselves', async () => {
    const me = await client.register('onlyme');
    const result = await client.get('/api/users/search?q=onlyme', me.cookie);
    expect(result.body.users).toHaveLength(0);
  });

  it('reports the relationship so the UI can show the right action', async () => {
    const a = await client.register('relA');
    const b = await client.register('relB');

    let result = await client.get('/api/users/search?q=relB', a.cookie);
    expect((result.body.users as { relationship: string }[])[0]?.relationship).toBe('none');

    await client.post('/api/friends/request', { toUserId: b.id }, a.cookie);

    result = await client.get('/api/users/search?q=relB', a.cookie);
    expect((result.body.users as { relationship: string }[])[0]?.relationship).toBe('request_sent');

    result = await client.get('/api/users/search?q=relA', b.cookie);
    expect((result.body.users as { relationship: string }[])[0]?.relationship).toBe(
      'request_received',
    );
  });
});

describe('friendships', () => {
  it('runs the request, accept and list flow', async () => {
    const a = await client.register('friendA');
    const b = await client.register('friendB');

    await client.befriend(a, b);

    const friends = await client.get('/api/friends', a.cookie);
    const list = friends.body.friends as { username: string }[];
    expect(list.map((f) => f.username)).toEqual(['friendB']);
  });

  it('lets the recipient reject a request', async () => {
    const a = await client.register('rejA');
    const b = await client.register('rejB');

    await client.post('/api/friends/request', { toUserId: b.id }, a.cookie);
    const requests = await client.get('/api/friends/requests', b.cookie);
    const id = (requests.body.incoming as { id: string }[])[0]?.id;

    const rejected = await client.post(`/api/friends/requests/${id}/reject`, undefined, b.cookie);
    expect(rejected.status).toBe(200);
    expect((await client.get('/api/friends', b.cookie)).body.friends).toHaveLength(0);
  });

  it('lets the sender cancel, but not the recipient', async () => {
    const a = await client.register('canA');
    const b = await client.register('canB');

    await client.post('/api/friends/request', { toUserId: b.id }, a.cookie);
    const requests = await client.get('/api/friends/requests', a.cookie);
    const id = (requests.body.outgoing as { id: string }[])[0]?.id;

    // The recipient cannot cancel someone else's request.
    expect((await client.del(`/api/friends/requests/${id}`, b.cookie)).status).toBe(403);
    expect((await client.del(`/api/friends/requests/${id}`, a.cookie)).status).toBe(200);
  });

  it('refuses to let a third party accept a request', async () => {
    const a = await client.register('thirdA');
    const b = await client.register('thirdB');
    const c = await client.register('thirdC');

    await client.post('/api/friends/request', { toUserId: b.id }, a.cookie);
    const requests = await client.get('/api/friends/requests', b.cookie);
    const id = (requests.body.incoming as { id: string }[])[0]?.id;

    expect((await client.post(`/api/friends/requests/${id}/accept`, undefined, c.cookie)).status).toBe(
      403,
    );
  });

  it('auto-accepts when both sides request each other', async () => {
    const a = await client.register('mutA');
    const b = await client.register('mutB');

    await client.post('/api/friends/request', { toUserId: b.id }, a.cookie);
    const result = await client.post('/api/friends/request', { toUserId: a.id }, b.cookie);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('accepted');
    expect((await client.get('/api/friends', a.cookie)).body.friends).toHaveLength(1);
  });

  it('rejects adding yourself', async () => {
    const a = await client.register('selfadd');
    const result = await client.post('/api/friends/request', { toUserId: a.id }, a.cookie);
    expect(result.status).toBe(400);
  });

  it('unfriends from either side', async () => {
    const a = await client.register('unfA');
    const b = await client.register('unfB');
    await client.befriend(a, b);

    expect((await client.del(`/api/friends/${a.id}`, b.cookie)).status).toBe(200);
    expect((await client.get('/api/friends', a.cookie)).body.friends).toHaveLength(0);
  });
});

describe('games', () => {
  it('refuses to create a game with a stranger', async () => {
    const a = await client.register('strA');
    const b = await client.register('strB');

    const result = await client.post('/api/games', { friendId: b.id }, a.cookie);
    expect(result.status).toBe(403);
  });

  it('creates a game between friends and shows it to both players', async () => {
    const a = await client.register('gameA');
    const b = await client.register('gameB');
    await client.befriend(a, b);

    const created = await client.post('/api/games', { friendId: b.id }, a.cookie);
    expect(created.status).toBe(201);

    // The invited player must be able to find the game without being handed a URL.
    const forB = await client.get('/api/games/active', b.cookie);
    const games = forB.body.games as { id: string; opponent: { username: string } }[];
    expect(games).toHaveLength(1);
    expect(games[0]?.opponent.username).toBe('gameA');
  });

  it('reuses an open room instead of stacking duplicate invites', async () => {
    const a = await client.register('dupA');
    const b = await client.register('dupB');
    await client.befriend(a, b);

    const first = await client.post('/api/games', { friendId: b.id }, a.cookie);
    const second = await client.post('/api/games', { friendId: b.id }, a.cookie);

    expect(second.body.reused).toBe(true);
    expect((second.body.game as { id: string }).id).toBe((first.body.game as { id: string }).id);
  });

  it('resolves a room code only for the players in that room', async () => {
    const a = await client.register('codeA');
    const b = await client.register('codeB');
    const outsider = await client.register('codeC');
    await client.befriend(a, b);

    const created = await client.post('/api/games', { friendId: b.id }, a.cookie);
    const roomCode = (created.body.game as { roomCode: string }).roomCode;

    expect((await client.post('/api/games/join', { roomCode }, b.cookie)).status).toBe(200);
    // An outsider gets "not found" rather than "forbidden" — the room's
    // existence is itself not disclosed.
    const blocked = await client.post('/api/games/join', { roomCode }, outsider.cookie);
    expect(blocked.status).toBe(404);
  });

  it('hides a game from players who are not in it', async () => {
    const a = await client.register('privA');
    const b = await client.register('privB');
    const outsider = await client.register('privC');
    await client.befriend(a, b);

    const created = await client.post('/api/games', { friendId: b.id }, a.cookie);
    const gameId = (created.body.game as { id: string }).id;

    expect((await client.get(`/api/games/${gameId}`, outsider.cookie)).status).toBe(403);
  });

  it('validates ids instead of trusting the path', async () => {
    const a = await client.register('valA');
    expect((await client.get('/api/games/not-a-uuid', a.cookie)).status).toBe(400);
  });

  it('starts an empty leaderboard', async () => {
    const a = await client.register('lbA');
    const result = await client.get('/api/games/leaderboard', a.cookie);
    expect(result.body.leaderboard).toEqual([]);
  });
});

describe('hardening', () => {
  it('serves health without auth', async () => {
    const result = await client.get('/api/health');
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
  });

  it('404s unknown endpoints as JSON', async () => {
    const result = await client.get('/api/nope');
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('not_found');
  });

  it('does not advertise the server framework', async () => {
    const result = await client.get('/api/health');
    expect(result.response.headers.get('x-powered-by')).toBeNull();
  });

  it('rejects an oversized body', async () => {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'x'.repeat(40_000), password: 'y' }),
    });
    expect(response.status).toBe(413);
  });
});
