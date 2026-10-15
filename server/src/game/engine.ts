import type { GameOutcome, GamePlayerStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { emitToGame, emitToUser, gameRoom, getIo, hasIo } from '../realtime/hub.js';
import { presence } from '../realtime/presence.js';
import {
  MAX_MISSED_ROUNDS,
  MAX_ROUNDS,
  PRESENCE_ANNOUNCE_DELAY_MS,
  RECONNECT_GRACE_MS,
  REVEAL_PAUSE_MS,
  START_GRACE_MS,
} from './constants.js';
import { groupSubmissions } from './grouping.js';
import type { ConnectionView, GameStateView, PlayerView, RoundView } from './types.js';
import { normalizeWord, validateWord } from './words.js';

type PlayerState = {
  userId: string;
  username: string;
  status: GamePlayerStatus;
  placement: number | null;
  connectedAtRound: number | null;
  missedRounds: number;
  seat: number;
};

type LiveGame = {
  id: string;
  roomId: string;
  roomCode: string;
  status: 'WAITING' | 'ACTIVE';
  players: Map<string, PlayerState>;
  /** Stable seat order, used for the circle layout. */
  order: string[];
  currentRound: number;
  submissions: Map<string, string>;
  /** Normalised words already played. The no-repeat rule compares against this. */
  bannedWords: Set<string>;
  /** Same words in play order, for display. */
  playedWords: string[];
  connections: ConnectionView[];
  rounds: RoundView[];
  roundDeadline: number | null;
  /** This game's round length, copied from the room at start. */
  roundDurationMs: number;
  startedAt: Date | null;
  wildcardId: string | null;

  socketUsers: Map<string, string>;
  socketsByUser: Map<string, Set<string>>;
  everJoined: Set<string>;

  roundTimer: NodeJS.Timeout | null;
  nextRoundTimer: NodeJS.Timeout | null;
  startGraceTimer: NodeJS.Timeout | null;
  graceTimers: Map<string, NodeJS.Timeout>;
  announceTimers: Map<string, NodeJS.Timeout>;
  announcedOffline: Set<string>;
};

const live = new Map<string, LiveGame>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function activeIds(game: LiveGame): string[] {
  return game.order.filter((id) => game.players.get(id)?.status === 'ACTIVE');
}

function connectedIds(game: LiveGame): string[] {
  return game.order.filter((id) => game.players.get(id)?.status === 'CONNECTED');
}

function isPlayer(game: LiveGame, userId: string): boolean {
  return game.players.has(userId);
}

function clearTimers(game: LiveGame): void {
  if (game.roundTimer) clearTimeout(game.roundTimer);
  if (game.nextRoundTimer) clearTimeout(game.nextRoundTimer);
  if (game.startGraceTimer) clearTimeout(game.startGraceTimer);
  for (const timer of game.graceTimers.values()) clearTimeout(timer);
  for (const timer of game.announceTimers.values()) clearTimeout(timer);
  game.roundTimer = null;
  game.nextRoundTimer = null;
  game.startGraceTimer = null;
  game.graceTimers.clear();
  game.announceTimers.clear();
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
  const online = presence.onlineAmong(game.order);
  const you = game.players.get(viewerId);

  const players: PlayerView[] = game.order.map((id) => {
    const player = game.players.get(id);
    return {
      id,
      username: player?.username ?? 'player',
      online: online.has(id),
      isYou: id === viewerId,
      status: player?.status ?? 'LEFT',
      placement: player?.placement ?? null,
      connectedAtRound: player?.connectedAtRound ?? null,
      // Whether, never what.
      hasSubmitted: game.submissions.has(id),
      seat: player?.seat ?? 0,
    };
  });

  return {
    id: game.id,
    roomId: game.roomId,
    roomCode: game.roomCode,
    status: game.status,
    outcome: null,
    finalScore: null,
    perfectCircle: false,
    currentRound: game.currentRound,
    maxRounds: MAX_ROUNDS,
    roundDurationMs: game.roundDurationMs,
    roundDeadline: game.roundDeadline,
    players,
    youId: viewerId,
    youStatus: you?.status ?? 'LEFT',
    youSubmitted: game.submissions.has(viewerId),
    youWord: game.submissions.get(viewerId) ?? null,
    activeCount: activeIds(game).length,
    connections: game.connections,
    rounds: game.rounds,
    playedWords: game.playedWords,
    wildcardId: game.wildcardId,
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

export function liveGameForRoom(roomId: string): LiveGame | undefined {
  for (const game of live.values()) {
    if (game.roomId === roomId) return game;
  }
  return undefined;
}

// ─── Creation ────────────────────────────────────────────────────────────────

/**
 * Called when the host starts a room. The game opens in WAITING and begins as
 * soon as every player has the room open — or after START_GRACE_MS, so one
 * straggler cannot hold the rest hostage.
 */
export async function createGameForRoom(
  room: { id: string; code: string; roundDurationMs: number },
  members: { userId: string; username: string }[],
): Promise<string> {
  const created = await prisma.game.create({
    data: {
      roomId: room.id,
      status: 'WAITING',
      playerCount: members.length,
      roundDurationMs: room.roundDurationMs,
      players: {
        create: members.map((member) => ({ userId: member.userId })),
      },
    },
  });

  const game: LiveGame = {
    id: created.id,
    roomId: room.id,
    roomCode: room.code,
    status: 'WAITING',
    players: new Map(
      members.map((member, index) => [
        member.userId,
        {
          userId: member.userId,
          username: member.username,
          status: 'ACTIVE' as GamePlayerStatus,
          placement: null,
          connectedAtRound: null,
          missedRounds: 0,
          seat: index,
        },
      ]),
    ),
    order: members.map((member) => member.userId),
    currentRound: 0,
    submissions: new Map(),
    bannedWords: new Set(),
    playedWords: [],
    connections: [],
    rounds: [],
    roundDeadline: null,
    roundDurationMs: room.roundDurationMs,
    startedAt: null,
    wildcardId: null,
    socketUsers: new Map(),
    socketsByUser: new Map(),
    everJoined: new Set(),
    roundTimer: null,
    nextRoundTimer: null,
    startGraceTimer: null,
    graceTimers: new Map(),
    announceTimers: new Map(),
    announcedOffline: new Set(),
  };

  live.set(game.id, game);

  game.startGraceTimer = setTimeout(() => {
    void beginPlay(game.id).catch((err) => console.error('beginPlay failed:', err));
  }, START_GRACE_MS);

  for (const member of members) {
    emitToUser(member.userId, 'room:game_started', { roomId: room.id, gameId: game.id });
  }

  return game.id;
}

/** WAITING → ACTIVE. Idempotent: whichever of "all here" or the grace timer wins. */
async function beginPlay(gameId: string): Promise<void> {
  const game = live.get(gameId);
  if (!game || game.status !== 'WAITING') return;

  if (game.startGraceTimer) {
    clearTimeout(game.startGraceTimer);
    game.startGraceTimer = null;
  }

  game.status = 'ACTIVE';
  game.startedAt = new Date();
  await persistLiveState(game);

  emitToGame(game.id, 'game:started', {
    gameId: game.id,
    players: game.order.map((id) => ({
      id,
      username: game.players.get(id)?.username ?? 'player',
    })),
  });

  await startRound(game.id);
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
  game.roundDeadline = Date.now() + game.roundDurationMs;

  await persistLiveState(game);

  emitToGame(game.id, 'round:started', {
    gameId: game.id,
    roundNumber: game.currentRound,
    deadlineAt: game.roundDeadline,
    durationMs: game.roundDurationMs,
    activeCount: activeIds(game).length,
  });
  broadcastState(game);

  game.roundTimer = setTimeout(() => {
    void resolveRound(gameId).catch((err) => console.error('resolveRound failed:', err));
  }, game.roundDurationMs);
}

/**
 * The heart of the game. Groups this round's words, turns every group of two or
 * more into a placed Connection, and takes those players out of the circle.
 */
async function resolveRound(gameId: string): Promise<void> {
  const game = live.get(gameId);
  if (!game || game.status !== 'ACTIVE') return;

  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
    game.roundTimer = null;
  }

  const roundNumber = game.currentRound;
  const active = activeIds(game);
  const entries = active
    .map((userId) => ({ userId, word: game.submissions.get(userId) ?? null }))
    .filter((entry): entry is { userId: string; word: string } => entry.word !== null);

  // Idle players are nudged out after enough silence, so one dead tab cannot
  // stall everyone else for the rest of the game.
  const idledOut: string[] = [];
  const missedUpdates: { userId: string; missedRounds: number }[] = [];

  for (const userId of active) {
    const player = game.players.get(userId);
    if (!player) continue;

    if (game.submissions.has(userId)) {
      if (player.missedRounds !== 0) {
        player.missedRounds = 0;
        missedUpdates.push({ userId, missedRounds: 0 });
      }
      continue;
    }

    player.missedRounds += 1;
    missedUpdates.push({ userId, missedRounds: player.missedRounds });
    if (player.missedRounds >= MAX_MISSED_ROUNDS) {
      player.status = 'LEFT';
      idledOut.push(userId);
    }
  }

  const groups = groupSubmissions(entries);
  const matchedUsers = new Set(groups.flatMap((group) => group.userIds));

  const round = await prisma.round.create({
    data: {
      gameId: game.id,
      roundNumber,
      submissions: {
        create: entries.map((entry) => ({
          gameId: game.id,
          userId: entry.userId,
          word: entry.word,
          normalized: normalizeWord(entry.word),
          matched: matchedUsers.has(entry.userId),
        })),
      },
    },
  });

  // The idle bookkeeping has to reach the database too, or a restart would
  // resurrect players who were already nudged out.
  if (idledOut.length > 0) {
    await prisma.gamePlayer.updateMany({
      where: { gameId: game.id, userId: { in: idledOut } },
      data: { status: 'LEFT' },
    });
  }
  for (const update of missedUpdates) {
    await prisma.gamePlayer.updateMany({
      where: { gameId: game.id, userId: update.userId },
      data: { missedRounds: update.missedRounds },
    });
  }
  for (const userId of idledOut) {
    emitToGame(game.id, 'player:left', {
      gameId: game.id,
      userId,
      username: game.players.get(userId)?.username ?? 'player',
      remaining: activeIds(game).length,
      reason: 'idle',
    });
  }

  // Every word spoken is burned, matched or not.
  for (const entry of entries) {
    const normalized = normalizeWord(entry.word);
    if (!game.bannedWords.has(normalized)) {
      game.bannedWords.add(normalized);
      game.playedWords.push(entry.word);
    }
  }

  const formed: ConnectionView[] = [];

  for (const group of groups) {
    const placement = game.connections.length + 1;

    const connection = await prisma.connection.create({
      data: {
        gameId: game.id,
        placement,
        word: group.word,
        roundNumber,
      },
    });

    for (const userId of group.userIds) {
      const player = game.players.get(userId);
      if (!player) continue;
      player.status = 'CONNECTED';
      player.placement = placement;
      player.connectedAtRound = roundNumber;
    }

    await prisma.gamePlayer.updateMany({
      where: { gameId: game.id, userId: { in: group.userIds } },
      data: {
        status: 'CONNECTED',
        connectionId: connection.id,
        placement,
        connectedAtRound: roundNumber,
      },
    });

    const view: ConnectionView = {
      placement,
      word: group.word,
      roundNumber,
      memberIds: group.userIds,
    };
    game.connections.push(view);
    formed.push(view);

    emitToGame(game.id, 'connection:formed', { gameId: game.id, connection: view });
  }

  const roundView: RoundView = {
    roundNumber,
    revealedAt: round.revealedAt.toISOString(),
    submissions: entries.map((entry) => ({
      userId: entry.userId,
      word: entry.word,
      matched: matchedUsers.has(entry.userId),
    })),
    formed,
  };
  game.rounds.push(roundView);
  game.roundDeadline = null;

  const remaining = activeIds(game);

  emitToGame(game.id, 'round:revealed', {
    gameId: game.id,
    round: roundView,
    playedWords: game.playedWords,
    remaining: remaining.length,
    isFinal: remaining.length <= 1 || roundNumber >= MAX_ROUNDS,
  });

  // The circle closes when nobody is left to connect with.
  if (remaining.length <= 1) {
    const everyoneConnected = connectedIds(game).length;
    if (everyoneConnected >= 2) {
      game.wildcardId = remaining[0] ?? null;
      await endGame(gameId, 'MATCHED', roundNumber);
    } else {
      // Nobody actually connected — the field emptied through drop-outs.
      await endGame(gameId, 'ABANDONED', null, 'Not enough players remained.');
    }
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
 * Terminal transition. Only MATCHED — the circle actually closing — carries a
 * score. A game that ran out of rounds, emptied out or was ended early scores
 * nothing, so quitting can never outrank connecting.
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
  // Perfect only if every player who started ended up connected: nobody left
  // over, nobody dropped out.
  const perfectCircle =
    outcome === 'MATCHED' && connectedIds(game).length === game.order.length;

  await prisma.game.update({
    where: { id: gameId },
    data: {
      status: 'COMPLETED',
      outcome,
      finalScore: score,
      perfectCircle,
      endedAt: new Date(),
      roundDeadline: null,
      submissions: {} as Prisma.InputJsonValue,
      currentRound: game.currentRound,
    },
  });

  // The room exists only for this game; once it ends, it is gone.
  await prisma.room.update({
    where: { id: game.roomId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  emitToGame(gameId, 'game:ended', {
    gameId,
    outcome,
    finalScore: score,
    perfectCircle,
    connections: game.connections,
    wildcardId: game.wildcardId,
    reason: reason ?? null,
    players: game.order.map((id) => {
      const player = game.players.get(id);
      return {
        id,
        username: player?.username ?? 'player',
        status: player?.status ?? 'LEFT',
        placement: player?.placement ?? null,
        connectedAtRound: player?.connectedAtRound ?? null,
      };
    }),
  });

  for (const userId of game.order) {
    emitToUser(userId, 'games:changed', { reason: 'ended' });
    emitToUser(userId, 'room:closed', { roomId: game.roomId });
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
  if (!game) return { ok: false, message: 'This game is no longer running.' };
  if (!isPlayer(game, userId)) return { ok: false, message: 'You are not in this game.' };

  const grace = game.graceTimers.get(userId);
  if (grace) {
    clearTimeout(grace);
    game.graceTimers.delete(userId);
  }

  const pendingAnnounce = game.announceTimers.get(userId);
  if (pendingAnnounce) {
    clearTimeout(pendingAnnounce);
    game.announceTimers.delete(userId);
  }

  const isReconnect = game.announcedOffline.has(userId);
  if (isReconnect) game.announcedOffline.delete(userId);

  game.socketUsers.set(socketId, userId);
  const sockets = game.socketsByUser.get(userId) ?? new Set<string>();
  sockets.add(socketId);
  game.socketsByUser.set(userId, sockets);
  game.everJoined.add(userId);

  if (isReconnect) {
    emitToGame(game.id, 'game:presence', {
      gameId: game.id,
      userId,
      username: game.players.get(userId)?.username ?? 'player',
      online: true,
      announced: true,
    });
  }

  // Start as soon as everyone has the room open, rather than waiting out the
  // full grace period.
  if (game.status === 'WAITING' && game.socketsByUser.size === game.order.length) {
    await beginPlay(game.id);
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

  const player = game.players.get(userId);
  if (!player) return { ok: false, message: 'You are not in this game.' };
  if (player.status === 'CONNECTED') {
    return { ok: false, message: 'You are already connected — sit back and watch.' };
  }
  if (player.status === 'LEFT') return { ok: false, message: 'You are out of this game.' };
  if (game.status !== 'ACTIVE') return { ok: false, message: 'The game has not started yet.' };
  if (game.roundDeadline === null) return { ok: false, message: 'Wait for the next round.' };
  if (game.submissions.has(userId)) return { ok: false, message: 'You already locked in a word.' };
  if (Date.now() > game.roundDeadline + 750) {
    return { ok: false, message: 'Too late — that round closed.' };
  }

  const validation = validateWord(rawWord);
  if (!validation.ok) return { ok: false, message: validation.reason };

  // The no-repeat rule. Rejecting does not consume the round — the player is
  // free to try another word before the clock runs out.
  if (game.bannedWords.has(normalizeWord(validation.word))) {
    return { ok: false, message: `"${validation.word}" has already been played.` };
  }

  game.submissions.set(userId, validation.word);
  await persistLiveState(game);
  broadcastState(game);

  // Everyone still in the circle has spoken; no reason to run the clock down.
  if (game.submissions.size === activeIds(game).length) {
    await resolveRound(gameId);
  }

  return { ok: true };
}

export async function forfeit(userId: string, gameId: string): Promise<SubmitResult> {
  const game = live.get(gameId);
  if (!game) return { ok: false, message: 'This game is not running.' };
  if (!isPlayer(game, userId)) return { ok: false, message: 'You are not in this game.' };

  const username = game.players.get(userId)?.username ?? 'A player';
  await endGame(gameId, 'FORFEITED', null, `${username} ended the game.`);
  return { ok: true };
}

/** Called when a socket drops. Starts the reconnect grace window if needed. */
export function handleSocketDisconnect(socketId: string, userId: string): void {
  for (const game of live.values()) {
    if (!game.socketUsers.has(socketId)) continue;

    game.socketUsers.delete(socketId);
    const sockets = game.socketsByUser.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) game.socketsByUser.delete(userId);
    }

    // Another tab is still open — the player has not really left.
    if (game.socketsByUser.has(userId)) {
      broadcastState(game);
      continue;
    }

    const player = game.players.get(userId);
    if (!player || player.status !== 'ACTIVE') {
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
        if (current.socketsByUser.has(userId)) return;

        current.announcedOffline.add(userId);
        emitToGame(current.id, 'game:presence', {
          gameId: current.id,
          userId,
          username: current.players.get(userId)?.username ?? 'player',
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
    game.graceTimers.set(
      userId,
      setTimeout(() => {
        void dropPlayer(gameId, userId).catch((err) => console.error('dropPlayer failed:', err));
      }, RECONNECT_GRACE_MS),
    );
  }
}

/**
 * A player who never came back leaves the circle. Unlike the two-player game,
 * this does not end the match — the rest play on, as long as two remain.
 */
async function dropPlayer(gameId: string, userId: string): Promise<void> {
  const game = live.get(gameId);
  if (!game) return;

  game.graceTimers.delete(userId);
  if (game.socketsByUser.has(userId)) return; // came back in time

  const player = game.players.get(userId);
  if (!player || player.status !== 'ACTIVE') return;

  player.status = 'LEFT';
  game.submissions.delete(userId);

  await prisma.gamePlayer.updateMany({
    where: { gameId, userId },
    data: { status: 'LEFT' },
  });

  emitToGame(gameId, 'player:left', {
    gameId,
    userId,
    username: player.username,
    remaining: activeIds(game).length,
  });

  const remaining = activeIds(game);
  if (remaining.length <= 1) {
    const connected = connectedIds(game).length;
    if (connected >= 2) {
      game.wildcardId = remaining[0] ?? null;
      await endGame(gameId, 'MATCHED', game.currentRound);
    } else {
      await endGame(gameId, 'ABANDONED', null, `${player.username} left the game.`);
    }
    return;
  }

  broadcastState(game);

  // Their silence should not hold up a round everyone else has finished.
  if (game.status === 'ACTIVE' && game.roundDeadline !== null) {
    if (game.submissions.size === remaining.length) {
      await resolveRound(gameId);
    }
  }
}

/** Mirrors a global connect/disconnect into any game the user belongs to. */
export function notifyPresenceChange(userId: string, online: boolean): void {
  for (const game of live.values()) {
    if (!isPlayer(game, userId)) continue;
    if (!online && (game.announceTimers.has(userId) || game.announcedOffline.has(userId))) {
      continue;
    }
    emitToGame(game.id, 'game:presence', {
      gameId: game.id,
      userId,
      username: game.players.get(userId)?.username ?? 'player',
      online,
      announced: false,
    });
  }
}

// ─── Boot restore ────────────────────────────────────────────────────────────

export async function restoreLiveGames(): Promise<number> {
  const open = await prisma.game.findMany({
    where: { status: { in: ['WAITING', 'ACTIVE'] } },
    include: {
      room: { select: { id: true, code: true, roundDurationMs: true } },
      players: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      connections: { orderBy: { placement: 'asc' }, include: { players: true } },
      rounds: {
        orderBy: { roundNumber: 'asc' },
        include: { submissions: true },
      },
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

    const bannedWords = new Set<string>();
    const playedWords: string[] = [];
    for (const round of row.rounds) {
      for (const submission of round.submissions) {
        if (bannedWords.has(submission.normalized)) continue;
        bannedWords.add(submission.normalized);
        playedWords.push(submission.word);
      }
    }

    const connections: ConnectionView[] = row.connections.map((connection) => ({
      placement: connection.placement,
      word: connection.word,
      roundNumber: connection.roundNumber,
      memberIds: connection.players.map((player) => player.userId),
    }));

    const game: LiveGame = {
      id: row.id,
      roomId: row.roomId,
      roomCode: row.room.code,
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'WAITING',
      players: new Map(
        row.players.map((player, index) => [
          player.userId,
          {
            userId: player.userId,
            username: player.user.username,
            status: player.status,
            placement: player.placement,
            connectedAtRound: player.connectedAtRound,
            missedRounds: player.missedRounds,
            seat: index,
          },
        ]),
      ),
      order: row.players.map((player) => player.userId),
      currentRound: row.currentRound,
      submissions,
      bannedWords,
      playedWords,
      connections,
      rounds: row.rounds.map((round) => ({
        roundNumber: round.roundNumber,
        revealedAt: round.revealedAt.toISOString(),
        submissions: round.submissions.map((submission) => ({
          userId: submission.userId,
          word: submission.word,
          matched: submission.matched,
        })),
        formed: connections.filter((c) => c.roundNumber === round.roundNumber),
      })),
      roundDeadline: row.roundDeadline ? row.roundDeadline.getTime() : null,
      roundDurationMs: row.roundDurationMs,
      startedAt: row.startedAt,
      wildcardId: null,
      socketUsers: new Map(),
      socketsByUser: new Map(),
      everJoined: new Set(),
      roundTimer: null,
      nextRoundTimer: null,
      startGraceTimer: null,
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

/** Test/shutdown helper — clears timers so the process can exit cleanly. */
export function shutdownEngine(): void {
  for (const game of live.values()) clearTimers(game);
  live.clear();
}

export { gameRoom };
