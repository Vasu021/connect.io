import { randomInt } from 'node:crypto';
import type { GameOutcome, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { emitToGame, emitToUser, gameRoom, getIo, hasIo } from '../realtime/hub.js';
import { presence } from '../realtime/presence.js';
import {
  INVITE_TTL_MS,
  MAX_ROUNDS,
  PRESENCE_ANNOUNCE_DELAY_MS,
  RECONNECT_GRACE_MS,
  REVEAL_PAUSE_MS,
  ROUND_DURATION_MS,
} from './constants.js';
import type { GameStateView, PlayerView, RoundView } from './types.js';
import { validateWord, wordsMatch } from './words.js';

type LiveGame = {
  id: string;
  roomCode: string;
  player1Id: string;
  player2Id: string;
  usernames: Map<string, string>;
  status: 'WAITING' | 'ACTIVE';
  currentRound: number;
  submissions: Map<string, string>;
  roundDeadline: number | null;
  rounds: RoundView[];
  startedAt: Date | null;
  /** socketId -> userId, for building per-player views of the room. */
  socketUsers: Map<string, string>;
  socketsByUser: Map<string, Set<string>>;
  /** Users who have been in the room at least once, used to detect reconnects. */
  everJoined: Set<string>;
  roundTimer: NodeJS.Timeout | null;
  nextRoundTimer: NodeJS.Timeout | null;
  graceTimers: Map<string, NodeJS.Timeout>;
  /** Pending "your partner dropped" announcements, keyed by user. */
  announceTimers: Map<string, NodeJS.Timeout>;
  /** Users we have actually told the room about, so we only announce a return
   *  to people who were told about the departure. */
  announcedOffline: Set<string>;
};

const live = new Map<string, LiveGame>();

// ─── Room codes ──────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — easier to read aloud

function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function players(game: LiveGame): [string, string] {
  return [game.player1Id, game.player2Id];
}

function isPlayer(game: LiveGame, userId: string): boolean {
  return game.player1Id === userId || game.player2Id === userId;
}

function opponentOf(game: LiveGame, userId: string): string {
  return game.player1Id === userId ? game.player2Id : game.player1Id;
}

function clearTimers(game: LiveGame): void {
  if (game.roundTimer) clearTimeout(game.roundTimer);
  if (game.nextRoundTimer) clearTimeout(game.nextRoundTimer);
  for (const timer of game.graceTimers.values()) clearTimeout(timer);
  for (const timer of game.announceTimers.values()) clearTimeout(timer);
  game.roundTimer = null;
  game.nextRoundTimer = null;
  game.graceTimers.clear();
  game.announceTimers.clear();
}

function bothPresent(game: LiveGame): boolean {
  return game.socketsByUser.has(game.player1Id) && game.socketsByUser.has(game.player2Id);
}

async function persistLiveState(game: LiveGame): Promise<void> {
  const submissions: Record<string, string> = {};
  for (const [userId, word] of game.submissions) submissions[userId] = word;

  await prisma.game.update({
    where: { id: game.id },
    data: {
      status: game.status,
      currentRound: game.currentRound,
      roundDeadline: game.roundDeadline === null ? null : new Date(game.roundDeadline),
      submissions: submissions as Prisma.InputJsonValue,
      startedAt: game.startedAt,
    },
  });
}

// ─── Public view ─────────────────────────────────────────────────────────────

export function stateFor(game: LiveGame, viewerId: string): GameStateView {
  const opponentId = opponentOf(game, viewerId);
  const online = presence.onlineAmong(players(game));

  const playerViews: PlayerView[] = players(game).map((id) => ({
    id,
    username: game.usernames.get(id) ?? 'player',
    online: online.has(id),
    isYou: id === viewerId,
  }));

  return {
    id: game.id,
    roomCode: game.roomCode,
    status: game.status,
    outcome: null,
    finalScore: null,
    currentRound: game.currentRound,
    maxRounds: MAX_ROUNDS,
    roundDurationMs: ROUND_DURATION_MS,
    roundDeadline: game.roundDeadline,
    players: playerViews,
    youId: viewerId,
    opponentId,
    youSubmitted: game.submissions.has(viewerId),
    youWord: game.submissions.get(viewerId) ?? null,
    opponentSubmitted: game.submissions.has(opponentId),
    opponentOnline: online.has(opponentId),
    bothPresent: bothPresent(game),
    rounds: game.rounds,
  };
}

/** Sends every socket in the room its own view — never another player's. */
function broadcastState(game: LiveGame): void {
  if (!hasIo()) return;
  const io = getIo();
  for (const [socketId, userId] of game.socketUsers) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('game:state', stateFor(game, userId));
  }
}

export function viewFor(gameId: string, viewerId: string): GameStateView | null {
  const game = live.get(gameId);
  if (!game || !isPlayer(game, viewerId)) return null;
  return stateFor(game, viewerId);
}

export function getLive(gameId: string): LiveGame | undefined {
  return live.get(gameId);
}

export function findLiveByRoomCode(roomCode: string): LiveGame | undefined {
  for (const game of live.values()) {
    if (game.roomCode === roomCode) return game;
  }
  return undefined;
}

// ─── Creation ────────────────────────────────────────────────────────────────

export async function createGame(creatorId: string, friendId: string) {
  // Retry on the astronomically unlikely room-code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await prisma.game.create({
        data: {
          roomCode: randomRoomCode(),
          player1Id: creatorId,
          player2Id: friendId,
          status: 'WAITING',
        },
        include: {
          player1: { select: { id: true, username: true } },
          player2: { select: { id: true, username: true } },
        },
      });

      live.set(created.id, {
        id: created.id,
        roomCode: created.roomCode,
        player1Id: created.player1Id,
        player2Id: created.player2Id,
        usernames: new Map([
          [created.player1.id, created.player1.username],
          [created.player2.id, created.player2.username],
        ]),
        status: 'WAITING',
        currentRound: 0,
        submissions: new Map(),
        roundDeadline: null,
        rounds: [],
        startedAt: null,
        socketUsers: new Map(),
        socketsByUser: new Map(),
        everJoined: new Set(),
        roundTimer: null,
        nextRoundTimer: null,
        graceTimers: new Map(),
        announceTimers: new Map(),
        announcedOffline: new Set(),
      });

      emitToUser(friendId, 'game:invited', {
        gameId: created.id,
        roomCode: created.roomCode,
        from: { id: created.player1.id, username: created.player1.username },
      });
      emitToUser(friendId, 'games:changed', { reason: 'invited' });
      emitToUser(creatorId, 'games:changed', { reason: 'created' });

      return created;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'P2002' || attempt === 4) throw err;
    }
  }
  throw new Error('Could not allocate a room code');
}

// ─── Round lifecycle ─────────────────────────────────────────────────────────

async function startRound(gameId: string): Promise<void> {
  const game = live.get(gameId);
  if (!game || game.status !== 'ACTIVE') return;

  if (game.roundTimer) clearTimeout(game.roundTimer);
  if (game.nextRoundTimer) clearTimeout(game.nextRoundTimer);
  game.nextRoundTimer = null;

  game.currentRound += 1;
  game.submissions.clear();
  game.roundDeadline = Date.now() + ROUND_DURATION_MS;

  await persistLiveState(game);

  emitToGame(game.id, 'round:started', {
    gameId: game.id,
    roundNumber: game.currentRound,
    deadlineAt: game.roundDeadline,
    durationMs: ROUND_DURATION_MS,
  });
  broadcastState(game);

  game.roundTimer = setTimeout(() => {
    void resolveRound(gameId).catch((err) => console.error('resolveRound failed:', err));
  }, ROUND_DURATION_MS);
}

async function resolveRound(gameId: string): Promise<void> {
  const game = live.get(gameId);
  if (!game || game.status !== 'ACTIVE') return;

  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
    game.roundTimer = null;
  }

  const player1Word = game.submissions.get(game.player1Id) ?? null;
  const player2Word = game.submissions.get(game.player2Id) ?? null;
  const matched = wordsMatch(player1Word, player2Word);
  const roundNumber = game.currentRound;

  const record = await prisma.round.create({
    data: { gameId: game.id, roundNumber, player1Word, player2Word, matched },
  });

  const view: RoundView = {
    roundNumber,
    player1Word,
    player2Word,
    matched,
    revealedAt: record.revealedAt.toISOString(),
  };
  game.rounds.push(view);
  game.roundDeadline = null;

  emitToGame(game.id, 'round:revealed', {
    gameId: game.id,
    round: view,
    rounds: game.rounds,
    isFinal: matched || roundNumber >= MAX_ROUNDS,
  });

  if (matched) {
    await endGame(gameId, 'MATCHED', roundNumber);
    return;
  }

  if (roundNumber >= MAX_ROUNDS) {
    await endGame(gameId, 'UNMATCHED', null);
    return;
  }

  await persistLiveState(game);
  broadcastState(game);

  game.nextRoundTimer = setTimeout(() => {
    void startRound(gameId).catch((err) => console.error('startRound failed:', err));
  }, REVEAL_PAUSE_MS);
}

/**
 * Terminal transition. Only a MATCHED game carries a score — an abandoned or
 * forfeited game must never land on the leaderboard, or quitting early would
 * outrank a genuine match.
 */
async function endGame(
  gameId: string,
  outcome: GameOutcome,
  finalScore: number | null,
  reason?: string,
): Promise<void> {
  const game = live.get(gameId);
  if (!game) return;

  clearTimers(game);
  live.delete(gameId);

  const score = outcome === 'MATCHED' ? finalScore : null;

  await prisma.game.update({
    where: { id: gameId },
    data: {
      status: 'COMPLETED',
      outcome,
      finalScore: score,
      endedAt: new Date(),
      roundDeadline: null,
      submissions: {} as Prisma.InputJsonValue,
      currentRound: game.currentRound,
    },
  });

  emitToGame(gameId, 'game:ended', {
    gameId,
    outcome,
    finalScore: score,
    rounds: game.rounds,
    reason: reason ?? null,
    players: players(game).map((id) => ({ id, username: game.usernames.get(id) ?? 'player' })),
  });

  for (const userId of players(game)) {
    emitToUser(userId, 'games:changed', { reason: 'ended' });
  }
}

// ─── Socket-driven actions ───────────────────────────────────────────────────

export type JoinResult = { ok: true; state: GameStateView } | { ok: false; message: string };

export async function joinRoom(
  socketId: string,
  userId: string,
  gameId: string,
): Promise<JoinResult> {
  const game = live.get(gameId);
  if (!game) return { ok: false, message: 'This game is no longer open.' };
  if (!isPlayer(game, userId)) return { ok: false, message: 'You are not in this game.' };

  const grace = game.graceTimers.get(userId);
  if (grace) {
    clearTimeout(grace);
    game.graceTimers.delete(userId);
  }

  // They are back before the room was ever told they left — say nothing.
  const pendingAnnounce = game.announceTimers.get(userId);
  if (pendingAnnounce) {
    clearTimeout(pendingAnnounce);
    game.announceTimers.delete(userId);
  }

  const isReconnect = game.announcedOffline.has(userId);
  if (isReconnect) game.announcedOffline.delete(userId);

  game.socketUsers.set(socketId, userId);
  const set = game.socketsByUser.get(userId) ?? new Set<string>();
  set.add(socketId);
  game.socketsByUser.set(userId, set);
  game.everJoined.add(userId);

  if (isReconnect) {
    emitToGame(game.id, 'game:presence', {
      gameId: game.id,
      userId,
      username: game.usernames.get(userId) ?? 'player',
      online: true,
      // Worth telling the partner about: they were told this player had gone.
      announced: true,
    });
  }

  // Kick off the match once both players are actually in the room.
  if (game.status === 'WAITING' && bothPresent(game)) {
    game.status = 'ACTIVE';
    game.startedAt = new Date();
    await persistLiveState(game);

    emitToGame(game.id, 'game:started', {
      gameId: game.id,
      players: players(game).map((id) => ({ id, username: game.usernames.get(id) ?? 'player' })),
    });
    for (const id of players(game)) emitToUser(id, 'games:changed', { reason: 'started' });

    await startRound(game.id);
  } else {
    broadcastState(game);
  }

  const current = live.get(gameId);
  if (!current) return { ok: false, message: 'This game just ended.' };
  return { ok: true, state: stateFor(current, userId) };
}

export type SubmitResult = { ok: true } | { ok: false; message: string };

export async function submitWord(
  userId: string,
  gameId: string,
  rawWord: string,
): Promise<SubmitResult> {
  const game = live.get(gameId);
  if (!game) return { ok: false, message: 'This game is not running.' };
  if (!isPlayer(game, userId)) return { ok: false, message: 'You are not in this game.' };
  if (game.status !== 'ACTIVE') return { ok: false, message: 'The game has not started yet.' };
  if (game.roundDeadline === null) return { ok: false, message: 'Wait for the next round.' };
  if (game.submissions.has(userId)) return { ok: false, message: 'You already locked in a word.' };
  if (Date.now() > game.roundDeadline + 750) {
    // Small grace for network latency; beyond that the round is over.
    return { ok: false, message: 'Too late — that round closed.' };
  }

  const validation = validateWord(rawWord);
  if (!validation.ok) return { ok: false, message: validation.reason };

  game.submissions.set(userId, validation.word);
  await persistLiveState(game);
  broadcastState(game);

  if (game.submissions.size === 2) {
    await resolveRound(gameId);
  }

  return { ok: true };
}

export async function forfeit(userId: string, gameId: string): Promise<SubmitResult> {
  const game = live.get(gameId);
  if (!game) return { ok: false, message: 'This game is not running.' };
  if (!isPlayer(game, userId)) return { ok: false, message: 'You are not in this game.' };

  const username = game.usernames.get(userId) ?? 'A player';
  await endGame(gameId, 'FORFEITED', null, `${username} ended the game.`);
  return { ok: true };
}

/** Called when a socket drops. Starts the reconnect grace window if needed. */
export function handleSocketDisconnect(socketId: string, userId: string): void {
  for (const game of live.values()) {
    if (!game.socketUsers.has(socketId)) continue;

    game.socketUsers.delete(socketId);
    const set = game.socketsByUser.get(userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) game.socketsByUser.delete(userId);
    }

    // Another tab is still open — the player has not really left.
    if (game.socketsByUser.has(userId)) {
      broadcastState(game);
      continue;
    }

    if (game.status !== 'ACTIVE') {
      broadcastState(game);
      continue;
    }

    // Hold the announcement briefly: most drops are momentary.
    const pending = game.announceTimers.get(userId);
    if (pending) clearTimeout(pending);

    const announceGameId = game.id;
    game.announceTimers.set(
      userId,
      setTimeout(() => {
        const current = live.get(announceGameId);
        if (!current) return;
        current.announceTimers.delete(userId);
        if (current.socketsByUser.has(userId)) return; // already back

        current.announcedOffline.add(userId);
        emitToGame(current.id, 'game:presence', {
          gameId: current.id,
          userId,
          username: current.usernames.get(userId) ?? 'player',
          online: false,
          graceMs: RECONNECT_GRACE_MS - PRESENCE_ANNOUNCE_DELAY_MS,
          announced: true,
        });
        broadcastState(current);
      }, PRESENCE_ANNOUNCE_DELAY_MS),
    );

    broadcastState(game);

    const existing = game.graceTimers.get(userId);
    if (existing) clearTimeout(existing);

    const gameId = game.id;
    const username = game.usernames.get(userId) ?? 'A player';
    game.graceTimers.set(
      userId,
      setTimeout(() => {
        const current = live.get(gameId);
        if (!current) return;
        current.graceTimers.delete(userId);
        if (current.socketsByUser.has(userId)) return; // came back in time
        void endGame(gameId, 'ABANDONED', null, `${username} disconnected and did not return.`).catch(
          (err) => console.error('abandon failed:', err),
        );
      }, RECONNECT_GRACE_MS),
    );
  }
}

/**
 * Mirrors a global connect/disconnect into any room the user belongs to.
 *
 * Departures from a room the player had actually joined are owned by the
 * delayed announcement in `handleSocketDisconnect` — emitting here as well
 * would announce instantly and defeat the debounce.
 */
export function notifyPresenceChange(userId: string, online: boolean): void {
  for (const game of live.values()) {
    if (!isPlayer(game, userId)) continue;
    if (!online && (game.announceTimers.has(userId) || game.announcedOffline.has(userId))) {
      continue;
    }
    emitToGame(game.id, 'game:presence', {
      gameId: game.id,
      userId,
      username: game.usernames.get(userId) ?? 'player',
      online,
      announced: false,
    });
  }
}

// ─── Boot restore & sweeps ───────────────────────────────────────────────────

export async function restoreLiveGames(): Promise<number> {
  const open = await prisma.game.findMany({
    where: { status: { in: ['WAITING', 'ACTIVE'] } },
    include: {
      player1: { select: { id: true, username: true } },
      player2: { select: { id: true, username: true } },
      rounds: { orderBy: { roundNumber: 'asc' } },
    },
  });

  const now = Date.now();

  for (const row of open) {
    const submissions = new Map<string, string>();
    const stored = row.submissions as Record<string, unknown> | null;
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'string') submissions.set(key, value);
      }
    }

    const game: LiveGame = {
      id: row.id,
      roomCode: row.roomCode,
      player1Id: row.player1Id,
      player2Id: row.player2Id,
      usernames: new Map([
        [row.player1.id, row.player1.username],
        [row.player2.id, row.player2.username],
      ]),
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'WAITING',
      currentRound: row.currentRound,
      submissions,
      roundDeadline: row.roundDeadline ? row.roundDeadline.getTime() : null,
      rounds: row.rounds.map((r) => ({
        roundNumber: r.roundNumber,
        player1Word: r.player1Word,
        player2Word: r.player2Word,
        matched: r.matched,
        revealedAt: r.revealedAt.toISOString(),
      })),
      startedAt: row.startedAt,
      socketUsers: new Map(),
      socketsByUser: new Map(),
      everJoined: new Set(),
      roundTimer: null,
      nextRoundTimer: null,
      graceTimers: new Map(),
      announceTimers: new Map(),
      announcedOffline: new Set(),
    };

    live.set(game.id, game);

    if (game.status === 'ACTIVE' && game.roundDeadline !== null) {
      const remaining = game.roundDeadline - now;
      if (remaining <= 0) {
        setImmediate(() => {
          void resolveRound(game.id).catch((err) => console.error('restore resolve failed:', err));
        });
      } else {
        game.roundTimer = setTimeout(() => {
          void resolveRound(game.id).catch((err) => console.error('restore resolve failed:', err));
        }, remaining);
      }
    }
  }

  return live.size;
}

/** Drops invitations nobody ever accepted so they stop cluttering dashboards. */
export async function sweepStaleInvites(): Promise<number> {
  const cutoff = new Date(Date.now() - INVITE_TTL_MS);
  const stale = await prisma.game.findMany({
    where: { status: 'WAITING', createdAt: { lt: cutoff } },
    select: { id: true, player1Id: true, player2Id: true },
  });

  for (const row of stale) {
    const game = live.get(row.id);
    if (game) {
      clearTimers(game);
      live.delete(row.id);
    }
    await prisma.game.update({
      where: { id: row.id },
      data: { status: 'COMPLETED', outcome: 'ABANDONED', endedAt: new Date(), finalScore: null },
    });
    emitToUser(row.player1Id, 'games:changed', { reason: 'invite_expired' });
    emitToUser(row.player2Id, 'games:changed', { reason: 'invite_expired' });
  }

  return stale.length;
}

/** Test/shutdown helper — clears timers so the process can exit cleanly. */
export function shutdownEngine(): void {
  for (const game of live.values()) clearTimers(game);
  live.clear();
}

export { gameRoom };
