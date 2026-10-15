import type { Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { restoreLiveGames, shutdownEngine, viewFor } from '../src/game/engine.js';
import type { GameStateView, RoundView } from '../src/game/types.js';
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

type Match = {
  a: TestUser;
  b: TestUser;
  gameId: string;
  roomCode: string;
  socketA: ClientSocket;
  socketB: ClientSocket;
};

let seq = 0;

/** Two friends, a created game, and both players connected but not yet joined. */
async function setupPair(): Promise<Match> {
  seq += 1;
  const a = await client.register(`pa${seq}`);
  const b = await client.register(`pb${seq}`);
  await client.befriend(a, b);

  const created = await client.post('/api/games', { friendId: b.id }, a.cookie);
  const game = created.body.game as { id: string; roomCode: string };

  const socketA = track(connectSocket(server, a));
  const socketB = track(connectSocket(server, b));
  await Promise.all([waitFor(socketA, 'session:ready'), waitFor(socketB, 'session:ready')]);

  return { a, b, gameId: game.id, roomCode: game.roomCode, socketA, socketB };
}

/** Joins both players and resolves once round 1 is live. */
async function startMatch(match: Match): Promise<void> {
  const started = waitFor(match.socketA, 'game:started');
  const roundOne = waitFor<{ roundNumber: number }>(match.socketA, 'round:started');

  match.socketA.emit('game:join', { gameId: match.gameId });
  await sleep(120);
  match.socketB.emit('game:join', { gameId: match.gameId });

  await started;
  const round = await roundOne;
  expect(round.roundNumber).toBe(1);
}

type RevealPayload = { round: RoundView; rounds: RoundView[]; isFinal: boolean };
type EndedPayload = { outcome: string; finalScore: number | null; reason: string | null };

describe('a full match', () => {
  it('starts only once both players are in the room', async () => {
    const match = await setupPair();

    const state = waitFor<GameStateView>(match.socketA, 'game:state');
    match.socketA.emit('game:join', { gameId: match.gameId });
    const first = await state;

    // One player present: still waiting, no round running.
    expect(first.status).toBe('WAITING');
    expect(first.roundDeadline).toBeNull();

    const started = waitFor(match.socketA, 'game:started');
    match.socketB.emit('game:join', { gameId: match.gameId });
    await started;
  });

  it('ends on a first-round match and scores it 1', async () => {
    const match = await setupPair();
    await startMatch(match);

    const revealed = waitFor<RevealPayload>(match.socketA, 'round:revealed');
    const ended = waitFor<EndedPayload>(match.socketA, 'game:ended');

    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'fifa' });
    match.socketB.emit('game:submit', { gameId: match.gameId, word: 'FIFA ' });

    const reveal = await revealed;
    expect(reveal.round.matched).toBe(true);

    const result = await ended;
    expect(result.outcome).toBe('MATCHED');
    expect(result.finalScore).toBe(1);

    const row = await prisma.game.findUniqueOrThrow({ where: { id: match.gameId } });
    expect(row.status).toBe('COMPLETED');
    expect(row.finalScore).toBe(1);
  });

  it('scores the round the pair actually converged on', async () => {
    const match = await setupPair();
    await startMatch(match);

    // Round 1: no match.
    const firstReveal = waitFor<RevealPayload>(match.socketA, 'round:revealed');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'messi' });
    match.socketB.emit('game:submit', { gameId: match.gameId, word: 'ronaldo' });
    expect((await firstReveal).round.matched).toBe(false);

    // Round 2: they land on the same word.
    const roundTwo = waitFor<{ roundNumber: number }>(match.socketA, 'round:started');
    expect((await roundTwo).roundNumber).toBe(2);

    const ended = waitFor<EndedPayload>(match.socketA, 'game:ended');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'fifa' });
    match.socketB.emit('game:submit', { gameId: match.gameId, word: 'fifa' });

    const result = await ended;
    expect(result.outcome).toBe('MATCHED');
    expect(result.finalScore).toBe(2);
  });

  it('resolves a round on the timer when one player says nothing', async () => {
    const match = await setupPair();
    await startMatch(match);

    const revealed = waitFor<RevealPayload>(match.socketA, 'round:revealed');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'alone' });

    const reveal = await revealed;
    expect(reveal.round.player1Word).toBe('alone');
    expect(reveal.round.player2Word).toBeNull();
    expect(reveal.round.matched).toBe(false);

    // The game carries on into the next round.
    const next = await waitFor<{ roundNumber: number }>(match.socketA, 'round:started');
    expect(next.roundNumber).toBe(2);
  });

  it('ends UNMATCHED with no score once the round cap is reached', async () => {
    const match = await setupPair();
    await startMatch(match);

    // MAX_ROUNDS is 3 under test; nobody submits anything.
    const result = await waitFor<EndedPayload>(match.socketA, 'game:ended', 12_000);
    expect(result.outcome).toBe('UNMATCHED');
    expect(result.finalScore).toBeNull();

    const row = await prisma.game.findUniqueOrThrow({ where: { id: match.gameId } });
    expect(row.currentRound).toBe(3);
    expect(row.finalScore).toBeNull();
  });
});

describe('fair play', () => {
  it("never reveals the opponent's word before the reveal", async () => {
    const match = await setupPair();
    await startMatch(match);

    // Several state broadcasts may already be in flight, so wait for the one
    // that reflects A's submission rather than simply the next one.
    const stateForB = waitForWhere<GameStateView>(
      match.socketB,
      'game:state',
      (state) => state.opponentSubmitted,
    );
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'secret' });
    const view = await stateForB;

    // B must learn only that A has locked in, never what.
    expect(view.opponentSubmitted).toBe(true);
    expect(view.youWord).toBeNull();
    expect(JSON.stringify(view)).not.toContain('secret');
  });

  it('rejects a second submission in the same round', async () => {
    const match = await setupPair();
    await startMatch(match);

    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'first' });
    const error = waitFor<{ message: string }>(match.socketA, 'game:error');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'second' });

    expect((await error).message).toMatch(/already locked in/i);
  });

  it('rejects multi-word and non-letter submissions', async () => {
    const match = await setupPair();
    await startMatch(match);

    const firstError = waitFor<{ message: string }>(match.socketA, 'game:error');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'world cup' });
    expect((await firstError).message).toMatch(/one word/i);

    const secondError = waitFor<{ message: string }>(match.socketA, 'game:error');
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'fifa23' });
    expect((await secondError).message).toMatch(/letters only/i);
  });

  it('refuses to let an outsider into the room', async () => {
    const match = await setupPair();
    const outsider = await client.register(`out${seq}`);
    const socket = track(connectSocket(server, outsider));
    await waitFor(socket, 'session:ready');

    const error = waitFor<{ message: string }>(socket, 'game:error');
    socket.emit('game:join', { gameId: match.gameId });
    expect((await error).message).toMatch(/not in this game/i);
  });

  it('refuses an unauthenticated socket', async () => {
    const { io: ioClient } = await import('socket.io-client');
    const socket = track(
      ioClient(server.baseUrl, { transports: ['websocket'], reconnection: false }),
    );
    const error = await waitFor<Error>(socket, 'connect_error');
    expect(error.message).toBe('unauthorized');
  });
});

describe('leaving a game', () => {
  /**
   * The regression test for the original scoring bug: a player who drops out
   * must not end up with a score that beats a genuine match.
   */
  it('abandons without a score when a player does not come back', async () => {
    const match = await setupPair();
    await startMatch(match);

    const ended = waitFor<EndedPayload>(match.socketA, 'game:ended', 10_000);
    match.socketB.disconnect();

    const result = await ended;
    expect(result.outcome).toBe('ABANDONED');
    expect(result.finalScore).toBeNull();
    expect(result.reason).toMatch(/did not return/i);

    const row = await prisma.game.findUniqueOrThrow({ where: { id: match.gameId } });
    expect(row.outcome).toBe('ABANDONED');
    expect(row.finalScore).toBeNull();

    // And it must never reach the leaderboard.
    const leaderboard = await client.get('/api/games/leaderboard', match.a.cookie);
    expect(leaderboard.body.leaderboard).toEqual([]);
  });

  it('tells the remaining player their partner dropped, with a grace window', async () => {
    const match = await setupPair();
    await startMatch(match);

    const presenceEvent = waitFor<{ online: boolean; graceMs: number }>(
      match.socketA,
      'game:presence',
    );
    match.socketB.disconnect();

    const event = await presenceEvent;
    expect(event.online).toBe(false);
    expect(event.graceMs).toBeGreaterThan(0);
  });

  it('stays quiet about a drop brief enough to resolve itself', async () => {
    const match = await setupPair();
    await startMatch(match);

    const announcements: unknown[] = [];
    match.socketA.on('game:presence', (payload: { announced?: boolean }) => {
      // Raw presence pings keep the indicator fresh; only "announced" events
      // are the ones a player is actually interrupted by.
      if (payload.announced) announcements.push(payload);
    });

    // A page remount or a momentary wifi blip: gone and back inside the
    // announce delay. The partner should never see a "dropped" flicker.
    match.socketB.disconnect();
    const back = track(connectSocket(server, match.b));
    await waitFor(back, 'session:ready');
    back.emit('game:join', { gameId: match.gameId });
    await waitFor(back, 'game:state');

    await sleep(400);
    expect(announcements).toEqual([]);
  });

  it('keeps the game alive when a dropped player reconnects in time', async () => {
    const match = await setupPair();
    await startMatch(match);

    match.socketB.disconnect();
    await sleep(150);

    const back = track(connectSocket(server, match.b));
    await waitFor(back, 'session:ready');
    const rejoined = waitFor<GameStateView>(back, 'game:state');
    back.emit('game:join', { gameId: match.gameId });

    expect((await rejoined).status).toBe('ACTIVE');

    // Past the grace window the game is still running.
    await sleep(700);
    const row = await prisma.game.findUniqueOrThrow({ where: { id: match.gameId } });
    expect(row.status).toBe('ACTIVE');
  });

  it('forfeits without a score', async () => {
    const match = await setupPair();
    await startMatch(match);

    const ended = waitFor<EndedPayload>(match.socketB, 'game:ended');
    match.socketA.emit('game:forfeit', { gameId: match.gameId });

    const result = await ended;
    expect(result.outcome).toBe('FORFEITED');
    expect(result.finalScore).toBeNull();
  });
});

describe('leaderboard', () => {
  it('ranks pairs by their best score and ignores unscored games', async () => {
    const first = await setupPair();
    await startMatch(first);
    const firstEnded = waitFor<EndedPayload>(first.socketA, 'game:ended');
    first.socketA.emit('game:submit', { gameId: first.gameId, word: 'fifa' });
    first.socketB.emit('game:submit', { gameId: first.gameId, word: 'fifa' });
    expect((await firstEnded).finalScore).toBe(1);

    const second = await setupPair();
    await startMatch(second);
    const secondEnded = waitFor<EndedPayload>(second.socketA, 'game:ended');
    second.socketB.disconnect();
    expect((await secondEnded).outcome).toBe('ABANDONED');

    const leaderboard = await client.get('/api/games/leaderboard', first.a.cookie);
    const rows = leaderboard.body.leaderboard as { rank: number; bestScore: number }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[0]?.bestScore).toBe(1);
  });
});

describe('restart recovery', () => {
  it('restores an in-progress game from the database', async () => {
    const match = await setupPair();
    await startMatch(match);
    match.socketA.emit('game:submit', { gameId: match.gameId, word: 'persist' });
    await sleep(150);

    // Simulate a process restart: drop all in-memory state, then reload.
    shutdownEngine();
    expect(viewFor(match.gameId, match.a.id)).toBeNull();

    const restored = await restoreLiveGames();
    expect(restored).toBeGreaterThanOrEqual(1);

    const view = viewFor(match.gameId, match.a.id);
    expect(view).not.toBeNull();
    expect(view?.status).toBe('ACTIVE');
    // The submitted word survived the restart.
    expect(view?.youSubmitted).toBe(true);
    expect(view?.youWord).toBe('persist');
  });
});
