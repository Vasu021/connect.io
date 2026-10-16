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

describe('rooms', () => {
  it('creates a room with the host already in it', async () => {
    const host = await client.register('roomHost');
    const result = await client.post('/api/rooms', { maxPlayers: 8 }, host.cookie);

    expect(result.status).toBe(201);
    const room = result.body.room as { code: string; members: unknown[]; youAreHost: boolean };
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.members).toHaveLength(1);
    expect(room.youAreHost).toBe(true);
  });

  it('lets a stranger join by code — friendship is not required to play', async () => {
    const host = await client.register('openHost');
    const stranger = await client.register('stranger');
    const room = await client.createRoom(host);

    const joined = await client.post('/api/rooms/join', { code: room.code }, stranger.cookie);
    expect(joined.status).toBe(200);
    expect((joined.body.room as { members: unknown[] }).members).toHaveLength(2);
  });

  it('requires the password when joining by code', async () => {
    const host = await client.register('lockHost');
    const outsider = await client.register('outsider');
    const room = await client.createRoom(host, { password: 'letmein' });

    const noPassword = await client.post('/api/rooms/join', { code: room.code }, outsider.cookie);
    expect(noPassword.status).toBe(404);

    const wrongPassword = await client.post(
      '/api/rooms/join',
      { code: room.code, password: 'nope' },
      outsider.cookie,
    );
    // A wrong password is indistinguishable from an unknown code, so the
    // endpoint cannot be used to discover which rooms exist.
    expect(wrongPassword.status).toBe(404);
    expect(wrongPassword.body.message).toBe(noPassword.body.message);

    const correct = await client.post(
      '/api/rooms/join',
      { code: room.code, password: 'letmein' },
      outsider.cookie,
    );
    expect(correct.status).toBe(200);
  });

  it('lets an invited player in without the password', async () => {
    const host = await client.register('inviteHost');
    const guest = await client.register('inviteGuest');
    const room = await client.createRoom(host, { password: 'letmein' });

    await client.post(`/api/rooms/${room.id}/invite`, { userId: guest.id }, host.cookie);

    const joined = await client.post('/api/rooms/join', { code: room.code }, guest.cookie);
    expect(joined.status).toBe(200);
  });

  it('shows an invite on the invited player\'s dashboard', async () => {
    const host = await client.register('notifyHost');
    const guest = await client.register('notifyGuest');
    const room = await client.createRoom(host);

    await client.post(`/api/rooms/${room.id}/invite`, { userId: guest.id }, host.cookie);

    const invites = await client.get('/api/rooms/invites', guest.cookie);
    const list = invites.body.invites as { room: { code: string }; from: { username: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.room.code).toBe(room.code);
    expect(list[0]?.from.username).toBe('notifyHost');
  });

  it('refuses to let a non-member see the room', async () => {
    const host = await client.register('privHost');
    const outsider = await client.register('privOutsider');
    const room = await client.createRoom(host);

    const result = await client.get(`/api/rooms/${room.id}`, outsider.cookie);
    expect(result.status).toBe(404);
  });

  it('enforces the room capacity', async () => {
    const host = await client.register('capHost');
    const guest = await client.register('capGuest');
    const extra = await client.register('capExtra');
    const room = await client.createRoom(host, { maxPlayers: 2 });

    expect((await client.post('/api/rooms/join', { code: room.code }, guest.cookie)).status).toBe(200);
    const full = await client.post('/api/rooms/join', { code: room.code }, extra.cookie);
    expect(full.status).toBe(409);
  });

  it('only lets the host start, and only with enough players', async () => {
    const host = await client.register('startHost');
    const guest = await client.register('startGuest');
    const room = await client.createRoom(host);

    // One player is not a game.
    const tooFew = await client.post(`/api/rooms/${room.id}/start`, undefined, host.cookie);
    expect(tooFew.status).toBe(400);

    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);

    const notHost = await client.post(`/api/rooms/${room.id}/start`, undefined, guest.cookie);
    expect(notHost.status).toBe(403);

    const started = await client.post(`/api/rooms/${room.id}/start`, undefined, host.cookie);
    expect(started.status).toBe(200);
    expect(started.body.gameId).toBeDefined();
  });

  it('passes the host on when the host leaves, and closes an empty room', async () => {
    const host = await client.register('leaveHost');
    const guest = await client.register('leaveGuest');
    const room = await client.createRoom(host);
    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);

    await client.post(`/api/rooms/${room.id}/leave`, undefined, host.cookie);

    const view = await client.get(`/api/rooms/${room.id}`, guest.cookie);
    expect((view.body.room as { youAreHost: boolean }).youAreHost).toBe(true);

    await client.post(`/api/rooms/${room.id}/leave`, undefined, guest.cookie);
    // Last one out closes the room, so the code stops working.
    const rejoin = await client.post('/api/rooms/join', { code: room.code }, guest.cookie);
    expect(rejoin.status).toBe(404);
  });

  it('lets the host remove a player but not themselves', async () => {
    const host = await client.register('kickHost');
    const guest = await client.register('kickGuest');
    const room = await client.createRoom(host);
    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);

    expect(
      (await client.del(`/api/rooms/${room.id}/members/${host.id}`, host.cookie)).status,
    ).toBe(400);
    expect(
      (await client.del(`/api/rooms/${room.id}/members/${guest.id}`, guest.cookie)).status,
    ).toBe(403);
    expect(
      (await client.del(`/api/rooms/${room.id}/members/${guest.id}`, host.cookie)).status,
    ).toBe(200);

    const view = await client.get(`/api/rooms/${room.id}`, host.cookie);
    expect((view.body.room as { members: unknown[] }).members).toHaveLength(1);
  });

  it('lets only the host change the round length', async () => {
    const host = await client.register('timerHost');
    const guest = await client.register('timerGuest');
    const room = await client.createRoom(host);
    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);

    const byGuest = await client.post(
      `/api/rooms/${room.id}/settings`,
      { roundDurationMs: 30_000 },
      guest.cookie,
    );
    expect(byGuest.status).toBe(403);

    const byHost = await client.post(
      `/api/rooms/${room.id}/settings`,
      { roundDurationMs: 30_000 },
      host.cookie,
    );
    expect(byHost.status).toBe(200);
    expect((byHost.body.room as { roundDurationMs: number }).roundDurationMs).toBe(30_000);

    // Everyone in the lobby sees the new length.
    const forGuest = await client.get(`/api/rooms/${room.id}`, guest.cookie);
    expect((forGuest.body.room as { roundDurationMs: number }).roundDurationMs).toBe(30_000);
  });

  it('rejects a round length outside the allowed range', async () => {
    const host = await client.register('rangeHost');
    const room = await client.createRoom(host);

    expect(
      (await client.post(`/api/rooms/${room.id}/settings`, { roundDurationMs: 500 }, host.cookie))
        .status,
    ).toBe(400);
    expect(
      (await client.post(
        `/api/rooms/${room.id}/settings`,
        { roundDurationMs: 999_999 },
        host.cookie,
      )).status,
    ).toBe(400);
  });

  it('refuses to shrink a room below the people already in it', async () => {
    const host = await client.register('shrinkHost');
    const guest = await client.register('shrinkGuest');
    const extra = await client.register('shrinkExtra');
    const room = await client.createRoom(host, { maxPlayers: 8 });
    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);
    await client.post('/api/rooms/join', { code: room.code }, extra.cookie);

    const result = await client.post(
      `/api/rooms/${room.id}/settings`,
      { maxPlayers: 2 },
      host.cookie,
    );
    expect(result.status).toBe(409);
  });

  it('creates a ready-to-go two-player room from the friends list', async () => {
    const a = await client.register('quickA');
    const b = await client.register('quickB');
    await client.befriend(a, b);

    const result = await client.post('/api/rooms/quick', { friendId: b.id }, a.cookie);
    expect(result.status).toBe(201);
    expect((result.body.room as { maxPlayers: number }).maxPlayers).toBe(2);

    const invites = await client.get('/api/rooms/invites', b.cookie);
    expect((invites.body.invites as unknown[]).length).toBe(1);
  });

  it('validates ids instead of trusting the path', async () => {
    const a = await client.register('valA');
    expect((await client.get('/api/games/not-a-uuid', a.cookie)).status).toBe(400);
    expect((await client.get('/api/rooms/not-a-uuid', a.cookie)).status).toBe(400);
  });

  it('starts an empty leaderboard', async () => {
    const a = await client.register('lbA');
    const result = await client.get('/api/games/leaderboard', a.cookie);
    expect(result.body.leaderboard).toEqual([]);
    expect(result.body.availableSizes).toEqual([]);
  });
});

describe('avatars', () => {
  it('starts with none and accepts a preset', async () => {
    const user = await client.register('avatarA');

    const before = await client.get('/api/auth/me', user.cookie);
    expect((before.body.user as { avatar: string | null }).avatar).toBeNull();

    const set = await client.post('/api/users/me/avatar', { avatar: 'giraffe' }, user.cookie);
    expect(set.status).toBe(200);
    expect((set.body.user as { avatar: string }).avatar).toBe('giraffe');

    const after = await client.get('/api/auth/me', user.cookie);
    expect((after.body.user as { avatar: string }).avatar).toBe('giraffe');
  });

  it('refuses anything that is not a preset', async () => {
    const user = await client.register('avatarB');
    // No uploads and no free text: the set is fixed, so there is nothing to
    // moderate and nothing unpleasant can end up beside a name.
    for (const bad of ['dragon', '<script>', '', 42, { id: 'cat' }]) {
      const result = await client.post('/api/users/me/avatar', { avatar: bad }, user.cookie);
      expect(result.status).toBe(400);
    }
  });

  it('lets you go back to initials', async () => {
    const user = await client.register('avatarC');
    await client.post('/api/users/me/avatar', { avatar: 'cat' }, user.cookie);

    const cleared = await client.post('/api/users/me/avatar', { avatar: null }, user.cookie);
    expect(cleared.status).toBe(200);
    expect((cleared.body.user as { avatar: string | null }).avatar).toBeNull();
  });

  it('shows a chosen avatar to other players', async () => {
    const a = await client.register('avatarD');
    const b = await client.register('avatarE');
    await client.post('/api/users/me/avatar', { avatar: 'panda' }, b.cookie);
    await client.befriend(a, b);

    const search = await client.get('/api/users/search?q=avatarE', a.cookie);
    expect((search.body.users as { avatar: string }[])[0]?.avatar).toBe('panda');

    const friends = await client.get('/api/friends', a.cookie);
    expect((friends.body.friends as { avatar: string }[])[0]?.avatar).toBe('panda');
  });

  it('needs a session to change', async () => {
    const result = await client.post('/api/users/me/avatar', { avatar: 'cat' });
    expect(result.status).toBe(401);
  });

  it('publishes the catalogue so the picker cannot drift', async () => {
    const user = await client.register('avatarF');
    const result = await client.get('/api/users/avatars', user.cookie);
    expect(result.status).toBe(200);
    expect(result.body.avatars).toContain('giraffe');
    expect((result.body.avatars as string[]).length).toBeGreaterThanOrEqual(12);
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
