import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { restoreLiveGames, shutdownEngine, viewFor } from '../src/game/engine.js';
import type { ConnectionView, GameStateView, RoundView } from '../src/game/types.js';
import {
  api,
  connectSocket,
  sleep,
  startTestServer,
  waitFor,
  waitForWhere,
  type TestServer,
  type TestUser,
} from './helpers.js';

let server: TestServer;
let client: ReturnType<typeof api>;
const openSockets: ClientSocket[] = [];

beforeAll(async () => {
  server = await startTestServer();
  client = api(server);
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await server.close();
});

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

type Table = {
  users: TestUser[];
  host: TestUser;
  roomId: string;
  code: string;
  gameId: string;
  sockets: ClientSocket[];
};

let seq = 0;

/** Seats `count` players in a room and plays through to round one. */
async function seat(count: number, options: { password?: string } = {}): Promise<Table> {
  seq += 1;
  const users: TestUser[] = [];
  for (let i = 0; i < count; i += 1) {
    users.push(await client.register(`p${seq}x${i}`));
  }

  const host = users[0] as TestUser;
  const room = await client.createRoom(host, { maxPlayers: count, ...options });

  for (const guest of users.slice(1)) {
    const joined = await client.post(
      '/api/rooms/join',
      { code: room.code, ...(options.password ? { password: options.password } : {}) },
      guest.cookie,
    );
    if (joined.status !== 200) throw new Error(`join failed: ${joined.status}`);
  }

  const sockets = users.map((user) => track(connectSocket(server, user)));
  await Promise.all(sockets.map((socket) => waitFor(socket, 'session:ready')));

  const gameId = await client.startRoom(host, room.id);

  const firstRound = waitFor<{ roundNumber: number }>(sockets[0] as ClientSocket, 'round:started');
  for (const socket of sockets) socket.emit('game:join', { gameId });
  const round = await firstRound;
  expect(round.roundNumber).toBe(1);

  return { users, host, roomId: room.id, code: room.code, gameId, sockets };
}

/** Submits one word per seat index; `null` means that player stays silent. */
function submitAll(table: Table, words: (string | null)[]): void {
  words.forEach((word, index) => {
    if (word === null) return;
    table.sockets[index]?.emit('game:submit', { gameId: table.gameId, word });
  });
}

type RevealPayload = {
  round: RoundView;
  playedWords: string[];
  remaining: number;
  isFinal: boolean;
};
type EndedPayload = {
  outcome: string;
  finalScore: number | null;
  perfectCircle: boolean;
  connections: ConnectionView[];
  wildcardId: string | null;
  reason: string | null;
};

const reveal = (table: Table, index = 0) =>
  waitFor<RevealPayload>(table.sockets[index] as ClientSocket, 'round:revealed');
const ended = (table: Table, index = 0, timeout = 15_000) =>
  waitFor<EndedPayload>(table.sockets[index] as ClientSocket, 'game:ended', timeout);
const nextRound = (table: Table, index = 0) =>
  waitFor<{ roundNumber: number }>(table.sockets[index] as ClientSocket, 'round:started');

describe('connections', () => {
  it('forms several groups in one round, numbered in order', async () => {
    const table = await seat(8);
    const watcher = reveal(table);

    // ocean: seats 0,3,4   signal: seats 1,2   alone: 5,6,7 all different
    submitAll(table, ['ocean', 'signal', 'signal', 'ocean', 'ocean', 'lamp', 'pine', 'drum']);

    const payload = await watcher;
    expect(payload.round.formed).toHaveLength(2);

    const [first, second] = payload.round.formed;
    // Deterministic placement: normalised ascending, so "ocean" precedes "signal".
    expect(first?.placement).toBe(1);
    expect(first?.word.toLowerCase()).toBe('ocean');
    expect(first?.memberIds).toHaveLength(3);
    expect(second?.placement).toBe(2);
    expect(second?.memberIds).toHaveLength(2);

    expect(payload.remaining).toBe(3);
  });

  it('connects a group of five as a single connection', async () => {
    const table = await seat(6);
    const watcher = reveal(table);
    submitAll(table, ['ocean', 'ocean', 'ocean', 'ocean', 'ocean', 'solo']);

    const payload = await watcher;
    expect(payload.round.formed).toHaveLength(1);
    expect(payload.round.formed[0]?.memberIds).toHaveLength(5);
    expect(payload.remaining).toBe(1);
  });

  it('keeps unconnected players in the circle for the next round', async () => {
    const table = await seat(4);
    const first = reveal(table);
    submitAll(table, ['ocean', 'ocean', 'north', 'south']);
    expect((await first).remaining).toBe(2);

    const second = await nextRound(table, 2);
    expect(second.roundNumber).toBe(2);
  });
});

describe('the no-repeat rule', () => {
  it('rejects a word anyone has already played', async () => {
    const table = await seat(4);

    const first = reveal(table);
    submitAll(table, ['ocean', 'north', 'south', 'east']);
    await first;
    await nextRound(table);

    const error = waitFor<{ message: string }>(table.sockets[0] as ClientSocket, 'game:error');
    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'OCEAN' });
    expect((await error).message).toMatch(/already been played/i);
  });

  it('does not consume the round when a repeat is rejected', async () => {
    const table = await seat(4);

    const first = reveal(table);
    submitAll(table, ['ocean', 'north', 'south', 'east']);
    await first;
    await nextRound(table);

    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'north' });
    await sleep(120);

    // The rejected attempt must leave the player free to try again.
    const accepted = waitFor(table.sockets[0] as ClientSocket, 'game:submitted');
    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'harbour' });
    await accepted;

    const state = viewFor(table.gameId, (table.users[0] as TestUser).id);
    expect(state?.youWord).toBe('harbour');
  });

  it('publishes the played words, because everyone saw them', async () => {
    const table = await seat(4);
    const first = reveal(table);
    submitAll(table, ['ocean', 'north', 'south', 'east']);

    const payload = await first;
    expect([...payload.playedWords].sort()).toEqual(['east', 'north', 'ocean', 'south']);
  });
});

describe('closing the circle', () => {
  it('ends with a Wildcard when one player is left alone', async () => {
    const table = await seat(5);

    const first = reveal(table);
    submitAll(table, ['ocean', 'ocean', 'north', 'south', 'east']);
    await first;
    await nextRound(table, 2);

    const finish = ended(table);
    submitAll(table, [null, null, 'harbour', 'harbour', 'lonely']);

    const result = await finish;
    expect(result.outcome).toBe('MATCHED');
    expect(result.finalScore).toBe(2);
    expect(result.perfectCircle).toBe(false);
    expect(result.wildcardId).toBe((table.users[4] as TestUser).id);
    expect(result.connections).toHaveLength(2);
  });

  it('is a Perfect Circle when nobody is left over', async () => {
    const table = await seat(4);

    const finish = ended(table);
    submitAll(table, ['ocean', 'ocean', 'signal', 'signal']);

    const result = await finish;
    expect(result.outcome).toBe('MATCHED');
    expect(result.perfectCircle).toBe(true);
    expect(result.wildcardId).toBeNull();
    expect(result.connections.map((c) => c.placement)).toEqual([1, 2]);

    const row = await prisma.game.findUniqueOrThrow({ where: { id: table.gameId } });
    expect(row.perfectCircle).toBe(true);
    expect(row.finalScore).toBe(1);
  });

  it('plays exactly like the old two-player game at two players', async () => {
    const table = await seat(2);

    const first = reveal(table);
    submitAll(table, ['messi', 'ronaldo']);
    expect((await first).round.formed).toHaveLength(0);

    await nextRound(table);
    const finish = ended(table);
    submitAll(table, ['fifa', 'FIFA']);

    const result = await finish;
    expect(result.outcome).toBe('MATCHED');
    expect(result.finalScore).toBe(2);
    expect(result.perfectCircle).toBe(true);
  });

  it('ends UNMATCHED with no score when the round cap is reached', async () => {
    const table = await seat(3);
    const finish = ended(table, 0, 25_000);

    // MAX_ROUNDS is 5 under test. Everyone keeps playing — they just never land
    // on the same word. (Staying silent instead would get them removed as idle,
    // which is a different ending.)
    const script = [
      ['north', 'south', 'east'],
      ['amber', 'cobalt', 'indigo'],
      ['maple', 'cedar', 'willow'],
      ['copper', 'silver', 'bronze'],
      ['harbour', 'meadow', 'canyon'],
    ];

    for (let round = 1; round <= 5; round += 1) {
      // Both listeners go on before submitting: the reveal pause is short
      // enough that round N+1 can start before a later subscribe lands.
      const watcher = reveal(table);
      const next = round < 5 ? nextRound(table) : null;
      submitAll(table, script[round - 1] as string[]);
      await watcher;
      if (next) await next;
    }

    const result = await finish;
    expect(result.outcome).toBe('UNMATCHED');
    expect(result.finalScore).toBeNull();

    const row = await prisma.game.findUniqueOrThrow({ where: { id: table.gameId } });
    expect(row.currentRound).toBe(5);
    expect(row.finalScore).toBeNull();
  });

  it('closes the room when the game ends', async () => {
    const table = await seat(2);
    const finish = ended(table);
    submitAll(table, ['ocean', 'ocean']);
    await finish;

    const room = await prisma.room.findUniqueOrThrow({ where: { id: table.roomId } });
    expect(room.status).toBe('CLOSED');
    // The code stops working: the room is gone, not merely finished.
    const rejoin = await client.post('/api/rooms/join', { code: table.code }, table.host.cookie);
    expect(rejoin.status).toBe(404);
  });
});

describe('fair play', () => {
  it("never leaks any other player's pending word", async () => {
    const table = await seat(8);

    const watcher = waitForWhere<GameStateView>(
      table.sockets[7] as ClientSocket,
      'game:state',
      (state) => state.players.filter((p) => p.hasSubmitted).length >= 7,
    );

    const secrets = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];
    secrets.forEach((word, index) => {
      table.sockets[index]?.emit('game:submit', { gameId: table.gameId, word });
    });

    const view = await watcher;
    const serialised = JSON.stringify(view);

    // Seven other players have locked in. The viewer may know that, and
    // nothing more.
    for (const secret of secrets) {
      expect(serialised).not.toContain(secret);
    }
    expect(view.youWord).toBeNull();
    expect(view.players.filter((p) => p.hasSubmitted)).toHaveLength(7);
  });

  it('stops a connected player from submitting again', async () => {
    const table = await seat(4);

    const first = reveal(table);
    submitAll(table, ['ocean', 'ocean', 'north', 'south']);
    await first;
    await nextRound(table, 2);

    const error = waitFor<{ message: string }>(table.sockets[0] as ClientSocket, 'game:error');
    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'anything' });
    expect((await error).message).toMatch(/already connected/i);
  });

  it('rejects a second submission in the same round', async () => {
    const table = await seat(4);
    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'first' });

    const error = waitFor<{ message: string }>(table.sockets[0] as ClientSocket, 'game:error');
    table.sockets[0]?.emit('game:submit', { gameId: table.gameId, word: 'second' });
    expect((await error).message).toMatch(/already locked in/i);
  });

  it('refuses to let an outsider into the game room', async () => {
    const table = await seat(2);
    const outsider = await client.register(`out${seq}`);
    const socket = track(connectSocket(server, outsider));
    await waitFor(socket, 'session:ready');

    const error = waitFor<{ message: string }>(socket, 'game:error');
    socket.emit('game:join', { gameId: table.gameId });
    expect((await error).message).toMatch(/not in this game/i);
  });
});

describe('players leaving', () => {
  it('carries on when one of eight drops out', async () => {
    const table = await seat(8);

    const left = waitFor<{ remaining: number }>(table.sockets[0] as ClientSocket, 'player:left');
    table.sockets[7]?.disconnect();

    expect((await left).remaining).toBe(7);

    // The game is still running, not abandoned.
    const row = await prisma.game.findUniqueOrThrow({ where: { id: table.gameId } });
    expect(row.status).toBe('ACTIVE');
  });

  /**
   * The regression that matters: a player who quits must never end up with a
   * score that beats a group who genuinely connected.
   */
  it('abandons without a score when nobody connected', async () => {
    const table = await seat(2);

    const finish = ended(table);
    table.sockets[1]?.disconnect();

    const result = await finish;
    expect(result.outcome).toBe('ABANDONED');
    expect(result.finalScore).toBeNull();

    const row = await prisma.game.findUniqueOrThrow({ where: { id: table.gameId } });
    expect(row.finalScore).toBeNull();

    const board = await client.get('/api/games/leaderboard', table.host.cookie);
    expect(board.body.leaderboard).toEqual([]);
  });

  it('removes a player who stays silent too long', async () => {
    const table = await seat(3);

    // MAX_MISSED_ROUNDS is 3 under test. Two players keep playing; the third
    // never speaks, and should be nudged out rather than stalling everyone.
    const script = [
      ['north', 'south', null],
      ['amber', 'cobalt', null],
      ['maple', 'cedar', null],
    ];

    for (let round = 1; round <= 3; round += 1) {
      const watcher = reveal(table);
      const next = round < 3 ? nextRound(table) : null;
      submitAll(table, script[round - 1] as (string | null)[]);
      await watcher;
      if (next) await next;
    }

    // The two who kept playing must still be in the circle.
    const survivors = await prisma.gamePlayer.count({
      where: { gameId: table.gameId, status: 'ACTIVE' },
    });
    expect(survivors).toBe(2);

    await sleep(200);
    const player = await prisma.gamePlayer.findFirstOrThrow({
      where: { gameId: table.gameId, userId: (table.users[2] as TestUser).id },
    });
    expect(player.status).toBe('LEFT');
  });

  it('forfeits without a score', async () => {
    const table = await seat(4);
    const finish = ended(table, 1);
    table.sockets[0]?.emit('game:forfeit', { gameId: table.gameId });

    const result = await finish;
    expect(result.outcome).toBe('FORFEITED');
    expect(result.finalScore).toBeNull();
  });
});

describe('leaderboard', () => {
  it('buckets circles by player count', async () => {
    const two = await seat(2);
    const twoEnded = ended(two);
    submitAll(two, ['ocean', 'ocean']);
    await twoEnded;

    const four = await seat(4);
    const fourEnded = ended(four);
    submitAll(four, ['signal', 'signal', 'amber', 'amber']);
    await fourEnded;

    const all = await client.get('/api/games/leaderboard', two.host.cookie);
    expect((all.body.availableSizes as { playerCount: number }[]).map((s) => s.playerCount)).toEqual(
      [2, 4],
    );

    const justFour = await client.get('/api/games/leaderboard?size=4', two.host.cookie);
    const rows = justFour.body.leaderboard as { playerCount: number; perfectCircle: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerCount).toBe(4);
    expect(rows[0]?.perfectCircle).toBe(true);
  });

  it('lists a group once, at its best circle', async () => {
    const first = await seat(2);
    const slow = ended(first);
    // Round one: a miss, so this pair's score will be 2.
    const miss = reveal(first);
    submitAll(first, ['north', 'south']);
    await miss;
    await nextRound(first);
    submitAll(first, ['ocean', 'ocean']);
    expect((await slow).finalScore).toBe(2);

    // The same two players, playing again and doing better.
    const room = await client.createRoom(first.host, { maxPlayers: 2 });
    await client.post('/api/rooms/join', { code: room.code }, (first.users[1] as TestUser).cookie);
    const gameId = await client.startRoom(first.host, room.id);

    const rematchStart = waitFor(first.sockets[0] as ClientSocket, 'round:started');
    for (const socket of first.sockets) socket.emit('game:join', { gameId });
    await rematchStart;

    const fast = waitFor<EndedPayload>(first.sockets[0] as ClientSocket, 'game:ended', 15_000);
    for (const socket of first.sockets) socket.emit('game:submit', { gameId, word: 'signal' });
    expect((await fast).finalScore).toBe(1);

    const board = await client.get('/api/games/leaderboard?size=2', first.host.cookie);
    const rows = board.body.leaderboard as { finalScore: number; games: number }[];

    // One row for the pair, carrying their best score and how often they played.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.finalScore).toBe(1);
    expect(rows[0]?.games).toBe(2);
  });
});

describe('round length', () => {
  it('plays at the length the host set, and keeps it across a restart', async () => {
    seq += 1;
    const host = await client.register(`tl${seq}a`);
    const guest = await client.register(`tl${seq}b`);
    const room = await client.createRoom(host, { maxPlayers: 2 });
    await client.post('/api/rooms/join', { code: room.code }, guest.cookie);

    // Well above the suite's 700ms default, so the effect is unmistakable.
    await client.post(`/api/rooms/${room.id}/settings`, { roundDurationMs: 9_000 }, host.cookie);

    const sockets = [host, guest].map((user) => track(connectSocket(server, user)));
    await Promise.all(sockets.map((socket) => waitFor(socket, 'session:ready')));

    const gameId = await client.startRoom(host, room.id);
    const started = waitFor<{ durationMs: number; deadlineAt: number }>(
      sockets[0] as ClientSocket,
      'round:started',
    );
    for (const socket of sockets) socket.emit('game:join', { gameId });

    const round = await started;
    expect(round.durationMs).toBe(9_000);
    // The deadline is roughly nine seconds out, not the suite default.
    expect(round.deadlineAt - Date.now()).toBeGreaterThan(7_000);

    const view = viewFor(gameId, host.id);
    expect(view?.roundDurationMs).toBe(9_000);

    shutdownEngine();
    await restoreLiveGames();
    expect(viewFor(gameId, host.id)?.roundDurationMs).toBe(9_000);
  });
});

describe('restart recovery', () => {
  it('restores an in-progress game, its played words and its connections', async () => {
    const table = await seat(5);

    const first = reveal(table);
    submitAll(table, ['ocean', 'ocean', 'north', 'south', 'east']);
    await first;
    await nextRound(table, 2);

    table.sockets[2]?.emit('game:submit', { gameId: table.gameId, word: 'harbour' });
    await sleep(150);

    // Simulate a process restart.
    shutdownEngine();
    expect(viewFor(table.gameId, (table.users[2] as TestUser).id)).toBeNull();

    const restored = await restoreLiveGames();
    expect(restored).toBeGreaterThanOrEqual(1);

    const view = viewFor(table.gameId, (table.users[2] as TestUser).id);
    expect(view?.status).toBe('ACTIVE');
    expect(view?.youWord).toBe('harbour');
    expect(view?.connections).toHaveLength(1);
    expect(view?.activeCount).toBe(3);
    // The ban list has to survive, or the no-repeat rule silently stops working.
    expect(view?.playedWords.map((w) => w.toLowerCase()).sort()).toEqual([
      'east',
      'north',
      'ocean',
      'south',
    ]);
  });
});
