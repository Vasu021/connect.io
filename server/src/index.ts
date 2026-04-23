import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? 'connect-io-dev-secret';
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const ROUND_DURATION_MS = 15000;
const NEXT_ROUND_DELAY_MS = 3000;
const RECONNECT_GRACE_MS = 30000;

// ─── Types ───────────────────────────────────────────────────────────────────

type PublicUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

type DbUser = PublicUser & {
  passwordHash: string;
};

type FriendRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
type GameStatus = 'WAITING' | 'ACTIVE' | 'COMPLETED';

type FriendRequestRecord = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FriendRequestStatus;
  createdAt: string;
};

type FriendshipRecord = {
  id: string;
  user1Id: string;
  user2Id: string;
  createdAt: string;
};

type RoundRecord = {
  roundNumber: number;
  player1Word: string | null;
  player2Word: string | null;
  matched: boolean;
  revealedAt: string;
};

type PersistedGameRecord = {
  id: string;
  roomCode: string;
  player1Id: string;
  player2Id: string;
  rounds: RoundRecord[];
  finalScore: number;
  status: GameStatus;
  endedAt: string;
  startedAt: string | null;
};

// Serialisable snapshot of an in-progress game stored in db.json so the game
// survives a server restart.
type PersistedActiveGame = {
  id: string;
  roomCode: string;
  status: GameStatus;
  players: [string, string];
  currentRound: number;
  submissions: Record<string, string>;
  roundDeadline: number | null;
  roundHistory: RoundRecord[];
  startedAt: string | null;
  winnerScore: number | null;
};

type Database = {
  users: DbUser[];
  friendRequests: FriendRequestRecord[];
  friendships: FriendshipRecord[];
  games: PersistedGameRecord[];
  activeGames: PersistedActiveGame[];
};

type AuthPayload = JwtPayload & {
  userId: string;
  username: string;
};

type AuthedRequest = Request & {
  user: AuthPayload;
};

type ActiveGame = {
  id: string;
  roomCode: string;
  status: GameStatus;
  players: [string, string];
  joined: Set<string>;
  currentRound: number;
  submissions: Record<string, string>;
  roundDeadline: number | null;
  roundHistory: RoundRecord[];
  startedAt: string | null;
  winnerScore: number | null;
  timeoutHandle: NodeJS.Timeout | null;
};

type PublicPlayer = {
  id: string;
  username: string;
};

type PublicGameState = {
  id: string;
  roomCode: string;
  status: GameStatus;
  currentRound: number;
  players: PublicPlayer[];
  roundDeadline: number | null;
  submissionsCount: number;
  viewerHasSubmitted: boolean;
  roundHistory: RoundRecord[];
  winnerScore: number | null;
};

type SocketWithUser = Socket & {
  user: AuthPayload;
};

// ─── Server setup ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());

const activeGames = new Map<string, ActiveGame>();

// key: `${gameId}:${userId}` — tracks reconnect-grace timers
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// ─── DB helpers ───────────────────────────────────────────────────────────────

function ensureDbFile(): void {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        { users: [], friendRequests: [], friendships: [], games: [], activeGames: [] },
        null,
        2,
      ),
    );
  }
}

function readDb(): Database {
  ensureDbFile();
  const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Partial<Database>;
  // Provide defaults so existing db.json files without activeGames still work.
  return {
    users: raw.users ?? [],
    friendRequests: raw.friendRequests ?? [],
    friendships: raw.friendships ?? [],
    games: raw.games ?? [],
    activeGames: raw.activeGames ?? [],
  };
}

function writeDb(db: Database): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function sanitizeUser(user: DbUser): PublicUser {
  return { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt };
}

function createToken(user: DbUser): string {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    (req as AuthedRequest).user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function getUserById(userId: string): DbUser | undefined {
  return readDb().users.find((u) => u.id === userId);
}

function areFriends(db: Database, a: string, b: string): boolean {
  return db.friendships.some(
    (f) => (f.user1Id === a && f.user2Id === b) || (f.user1Id === b && f.user2Id === a),
  );
}

function normalizeWord(word: string | null | undefined): string {
  return String(word ?? '').trim().toLowerCase();
}

function makeRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── Game state helpers ───────────────────────────────────────────────────────

function buildPublicGameState(gameId: string, viewerUserId?: string): PublicGameState | null {
  const game = activeGames.get(gameId);
  if (!game) return null;

  const players = game.players.map((userId) => {
    const user = getUserById(userId);
    return { id: userId, username: user?.username ?? 'Unknown' };
  });

  return {
    id: game.id,
    roomCode: game.roomCode,
    status: game.status,
    currentRound: game.currentRound,
    players,
    roundDeadline: game.roundDeadline,
    submissionsCount: Object.keys(game.submissions).length,
    viewerHasSubmitted: viewerUserId ? Boolean(game.submissions[viewerUserId]) : false,
    roundHistory: game.roundHistory,
    winnerScore: game.winnerScore,
  };
}

/**
 * FIX #1 — Emit personalized game:state_sync to every socket individually so
 * each player gets the correct viewerHasSubmitted value instead of receiving
 * another player's perspective.
 */
function emitPersonalizedSync(gameId: string): void {
  const room = io.sockets.adapter.rooms.get(gameId);
  if (!room) return;
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId) as SocketWithUser | undefined;
    if (socket?.user) {
      socket.emit('game:state_sync', buildPublicGameState(gameId, socket.user.userId));
    }
  }
}

// ─── Active-game persistence (FIX #3) ────────────────────────────────────────

function persistActiveGame(game: ActiveGame): void {
  const db = readDb();
  const record: PersistedActiveGame = {
    id: game.id,
    roomCode: game.roomCode,
    status: game.status,
    players: game.players,
    currentRound: game.currentRound,
    submissions: { ...game.submissions },
    roundDeadline: game.roundDeadline,
    roundHistory: [...game.roundHistory],
    startedAt: game.startedAt,
    winnerScore: game.winnerScore,
  };
  const idx = db.activeGames.findIndex((g) => g.id === game.id);
  if (idx >= 0) {
    db.activeGames[idx] = record;
  } else {
    db.activeGames.push(record);
  }
  writeDb(db);
}

function persistCompletedGame(game: ActiveGame): void {
  const db = readDb();
  db.games.push({
    id: game.id,
    roomCode: game.roomCode,
    player1Id: game.players[0],
    player2Id: game.players[1],
    rounds: game.roundHistory,
    finalScore: game.winnerScore ?? game.currentRound,
    status: game.status,
    endedAt: new Date().toISOString(),
    startedAt: game.startedAt,
  });
  // Remove from active-games list now that it's completed.
  db.activeGames = db.activeGames.filter((g) => g.id !== game.id);
  writeDb(db);
}

/**
 * On server start, restore any WAITING/ACTIVE games that were persisted before
 * the last shutdown. Timers are rebuilt so rounds continue automatically.
 */
function loadActiveGames(): void {
  const db = readDb();
  const now = Date.now();

  for (const record of db.activeGames) {
    if (record.status === 'COMPLETED') continue;

    const game: ActiveGame = {
      ...record,
      joined: new Set<string>(),
      timeoutHandle: null,
    };

    activeGames.set(game.id, game);

    if (game.status === 'ACTIVE') {
      if (game.roundDeadline !== null && game.roundDeadline <= now) {
        // Deadline already passed while the server was down — resolve immediately.
        setImmediate(() => resolveRound(game.id));
      } else if (game.roundDeadline !== null && game.roundDeadline > now) {
        // Rebuild timer for remaining time.
        const remaining = game.roundDeadline - now;
        game.timeoutHandle = setTimeout(() => resolveRound(game.id), remaining);
      }
    }
  }

  if (activeGames.size > 0) {
    console.log(`Restored ${activeGames.size} active game(s) from database.`);
  }
}

// ─── Round logic ──────────────────────────────────────────────────────────────

function startRound(gameId: string): void {
  const game = activeGames.get(gameId);
  if (!game || game.status !== 'ACTIVE') return;

  if (game.timeoutHandle) clearTimeout(game.timeoutHandle);

  game.currentRound += 1;
  game.submissions = {};
  game.roundDeadline = Date.now() + ROUND_DURATION_MS;

  persistActiveGame(game); // FIX #3

  io.to(game.id).emit('game:round_started', {
    gameId: game.id,
    roundNumber: game.currentRound,
    deadlineAt: game.roundDeadline,
    roundHistory: game.roundHistory,
  });

  game.timeoutHandle = setTimeout(() => resolveRound(gameId), ROUND_DURATION_MS);
}

function resolveRound(gameId: string): void {
  const game = activeGames.get(gameId);
  if (!game || game.status !== 'ACTIVE') return;

  const [player1Id, player2Id] = game.players;
  const player1Word = game.submissions[player1Id] ?? null;
  const player2Word = game.submissions[player2Id] ?? null;
  const matched =
    player1Word !== null &&
    player2Word !== null &&
    normalizeWord(player1Word) === normalizeWord(player2Word);

  const roundRecord: RoundRecord = {
    roundNumber: game.currentRound,
    player1Word,
    player2Word,
    matched,
    revealedAt: new Date().toISOString(),
  };

  game.roundHistory.push(roundRecord);

  io.to(game.id).emit('game:round_revealed', {
    gameId: game.id,
    roundNumber: game.currentRound,
    player1Word,
    player2Word,
    matched,
    roundHistory: game.roundHistory,
  });

  if (matched) {
    game.status = 'COMPLETED';
    game.winnerScore = game.currentRound;
    if (game.timeoutHandle) {
      clearTimeout(game.timeoutHandle);
      game.timeoutHandle = null;
    }
    persistCompletedGame(game); // FIX #3 — moves to completed, removes from activeGames in db
    io.to(game.id).emit('game:ended', {
      gameId: game.id,
      finalScore: game.winnerScore,
      roundHistory: game.roundHistory,
      leaderboardUpdated: true,
    });
    return;
  }

  persistActiveGame(game); // FIX #3

  setTimeout(() => {
    const stillActive = activeGames.get(gameId);
    if (stillActive && stillActive.status === 'ACTIVE') startRound(gameId);
  }, NEXT_ROUND_DELAY_MS);
}

// ─── REST routes ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email and password are required' });
  }

  const cleanedUsername = username.trim();
  const cleanedEmail = email.trim().toLowerCase();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanedUsername)) {
    return res
      .status(400)
      .json({ message: 'Username must be 3-20 chars and use letters, numbers, underscore' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  const db = readDb();

  if (db.users.some((u) => u.username.toLowerCase() === cleanedUsername.toLowerCase())) {
    return res.status(400).json({ message: 'Username already exists' });
  }

  if (db.users.some((u) => u.email.toLowerCase() === cleanedEmail)) {
    return res.status(400).json({ message: 'Email already exists' });
  }

  const user: DbUser = {
    id: randomUUID(),
    username: cleanedUsername,
    email: cleanedEmail,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
  };

  db.users.push(user);
  writeDb(db);

  return res.json({ token: createToken(user), user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };

  if (!identifier || !password) {
    return res.status(400).json({ message: 'identifier and password are required' });
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const db = readDb();
  const user = db.users.find(
    (u) =>
      u.username.toLowerCase() === normalizedIdentifier ||
      u.email.toLowerCase() === normalizedIdentifier,
  );

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  return res.json({ token: createToken(user), user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUserById((req as AuthedRequest).user.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: sanitizeUser(user) });
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const currentUserId = (req as AuthedRequest).user.userId;
  const query = String(req.query.q ?? '').trim().toLowerCase();
  if (!query) return res.json({ users: [] });

  const db = readDb();
  const users = db.users
    .filter((u) => u.id !== currentUserId && u.username.toLowerCase().includes(query))
    .map(sanitizeUser);

  return res.json({ users });
});

app.get('/api/friends', authMiddleware, (req, res) => {
  const currentUserId = (req as AuthedRequest).user.userId;
  const db = readDb();
  const friendIds = db.friendships.flatMap((f) => {
    if (f.user1Id === currentUserId) return [f.user2Id];
    if (f.user2Id === currentUserId) return [f.user1Id];
    return [] as string[];
  });

  const friends = db.users.filter((u) => friendIds.includes(u.id)).map(sanitizeUser);
  return res.json({ friends });
});

app.get('/api/friends/requests', authMiddleware, (req, res) => {
  const currentUserId = (req as AuthedRequest).user.userId;
  const db = readDb();

  const incoming = db.friendRequests
    .filter((r) => r.toUserId === currentUserId && r.status === 'PENDING')
    .map((r) => {
      const fromUser = db.users.find((u) => u.id === r.fromUserId);
      return { ...r, fromUser: fromUser ? sanitizeUser(fromUser) : null };
    })
    .filter((r) => r.fromUser !== null);

  const outgoing = db.friendRequests
    .filter((r) => r.fromUserId === currentUserId && r.status === 'PENDING')
    .map((r) => {
      const toUser = db.users.find((u) => u.id === r.toUserId);
      return { ...r, toUser: toUser ? sanitizeUser(toUser) : null };
    })
    .filter((r) => r.toUser !== null);

  return res.json({ incoming, outgoing });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { toUserId } = req.body as { toUserId?: string };
  const fromUserId = (req as AuthedRequest).user.userId;
  const db = readDb();

  if (!toUserId || toUserId === fromUserId) {
    return res.status(400).json({ message: 'Invalid target user' });
  }

  const targetUser = db.users.find((u) => u.id === toUserId);
  if (!targetUser) return res.status(404).json({ message: 'Target user not found' });

  if (areFriends(db, fromUserId, toUserId)) {
    return res.status(400).json({ message: 'Already friends' });
  }

  const existing = db.friendRequests.find(
    (r) =>
      ((r.fromUserId === fromUserId && r.toUserId === toUserId) ||
        (r.fromUserId === toUserId && r.toUserId === fromUserId)) &&
      r.status === 'PENDING',
  );

  if (existing) return res.status(400).json({ message: 'Pending request already exists' });

  const friendRequest: FriendRequestRecord = {
    id: randomUUID(),
    fromUserId,
    toUserId,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  db.friendRequests.push(friendRequest);
  writeDb(db);

  return res.json({ request: friendRequest });
});

app.post('/api/friends/request/:requestId/accept', authMiddleware, (req, res) => {
  const currentUserId = (req as AuthedRequest).user.userId;
  const db = readDb();
  const requestItem = db.friendRequests.find((r) => r.id === req.params.requestId);

  if (!requestItem) return res.status(404).json({ message: 'Request not found' });
  if (requestItem.toUserId !== currentUserId) return res.status(403).json({ message: 'Not allowed' });
  if (requestItem.status !== 'PENDING') return res.status(400).json({ message: 'Request is not pending' });

  requestItem.status = 'ACCEPTED';
  db.friendships.push({
    id: randomUUID(),
    user1Id: requestItem.fromUserId,
    user2Id: requestItem.toUserId,
    createdAt: new Date().toISOString(),
  });
  writeDb(db);

  return res.json({ success: true });
});

app.post('/api/games', authMiddleware, (req, res) => {
  const { friendId } = req.body as { friendId?: string };
  const currentUserId = (req as AuthedRequest).user.userId;
  const db = readDb();

  if (!friendId) return res.status(400).json({ message: 'friendId is required' });

  if (!areFriends(db, currentUserId, friendId)) {
    return res.status(403).json({ message: 'You can only create games with friends' });
  }

  const game: ActiveGame = {
    id: randomUUID(),
    roomCode: makeRoomCode(),
    status: 'WAITING',
    players: [currentUserId, friendId],
    joined: new Set<string>(),
    currentRound: 0,
    submissions: {},
    roundDeadline: null,
    roundHistory: [],
    startedAt: null,
    winnerScore: null,
    timeoutHandle: null,
  };

  activeGames.set(game.id, game);
  persistActiveGame(game); // FIX #3

  return res.json({ game: buildPublicGameState(game.id, currentUserId) });
});

app.get('/api/games/:gameId', authMiddleware, (req, res) => {
  const currentUserId = (req as AuthedRequest).user.userId;
  const gameId = String(req.params.gameId);
  const game = activeGames.get(gameId);

  if (!game) return res.status(404).json({ message: 'Game not found or no longer active' });
  if (!game.players.includes(currentUserId)) return res.status(403).json({ message: 'Not allowed' });

  return res.json({ game: buildPublicGameState(gameId, currentUserId) });
});

app.get('/api/leaderboard', authMiddleware, (_req, res) => {
  const db = readDb();
  const leaderboard = db.games
    .filter((g) => g.status === 'COMPLETED' && Number.isFinite(g.finalScore))
    .sort((a, b) => a.finalScore - b.finalScore)
    .slice(0, 20)
    .map((g) => {
      const player1 = db.users.find((u) => u.id === g.player1Id);
      const player2 = db.users.find((u) => u.id === g.player2Id);
      return {
        id: g.id,
        roomCode: g.roomCode,
        finalScore: g.finalScore,
        endedAt: g.endedAt,
        players: [player1?.username ?? 'Unknown', player2?.username ?? 'Unknown'] as [string, string],
      };
    });

  return res.json({ leaderboard });
});

// ─── Socket.IO auth middleware ─────────────────────────────────────────────────

io.use((socket, next) => {
  try {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) { next(new Error('Unauthorized')); return; }
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    (socket as SocketWithUser).user = decoded;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

// ─── Socket.IO event handlers ─────────────────────────────────────────────────

io.on('connection', (socket) => {
  const authedSocket = socket as SocketWithUser;

  // ── game:join_room ──────────────────────────────────────────────────────────
  authedSocket.on('game:join_room', ({ gameId }: { gameId: string }) => {
    const game = activeGames.get(gameId);
    if (!game) {
      authedSocket.emit('game:error', { message: 'Game not found' });
      return;
    }

    const userId = authedSocket.user.userId;
    if (!game.players.includes(userId)) {
      authedSocket.emit('game:error', { message: 'You are not a player in this room' });
      return;
    }

    // FIX #6 — Detect reconnect: the game is already running and this user was
    // previously in the joined set.
    const isReconnect = game.status === 'ACTIVE' && game.joined.has(userId);

    authedSocket.join(game.id);
    game.joined.add(userId);

    if (isReconnect) {
      // Cancel the disconnect-grace timer so the game is not abandoned.
      const timerKey = `${gameId}:${userId}`;
      const timer = disconnectTimers.get(timerKey);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(timerKey);
      }
      // Notify the other player that their opponent is back.
      authedSocket.to(game.id).emit('game:opponent_reconnected', {
        username: authedSocket.user.username,
      });
    }

    // FIX #1 — Send each socket its own personalised state.
    emitPersonalizedSync(game.id);

    if (game.joined.size === 2 && game.status === 'WAITING') {
      game.status = 'ACTIVE';
      game.startedAt = new Date().toISOString();
      persistActiveGame(game); // FIX #3

      io.to(game.id).emit('game:started', {
        gameId: game.id,
        players: game.players.map((id) => {
          const user = getUserById(id);
          return { id, username: user?.username ?? 'Unknown' };
        }),
      });

      startRound(game.id);
    }
  });

  // ── game:submit_word ────────────────────────────────────────────────────────
  authedSocket.on('game:submit_word', ({ gameId, word }: { gameId: string; word: string }) => {
    const game = activeGames.get(gameId);
    if (!game || game.status !== 'ACTIVE') {
      authedSocket.emit('game:error', { message: 'Game is not active' });
      return;
    }

    const userId = authedSocket.user.userId;
    if (!game.players.includes(userId)) {
      authedSocket.emit('game:error', { message: 'Not your game' });
      return;
    }

    const cleanedWord = word.trim();
    if (!cleanedWord) {
      authedSocket.emit('game:error', { message: 'Word cannot be empty' });
      return;
    }

    if (cleanedWord.length > 32) {
      authedSocket.emit('game:error', { message: 'Word cannot exceed 32 characters' });
      return;
    }

    if (game.submissions[userId]) {
      authedSocket.emit('game:error', { message: 'You already submitted this round' });
      return;
    }

    game.submissions[userId] = cleanedWord;

    authedSocket.emit('game:submission_received', {
      gameId,
      roundNumber: game.currentRound,
      accepted: true,
    });

    // FIX #1 — Personalised sync so each player sees their own viewerHasSubmitted.
    emitPersonalizedSync(gameId);

    if (Object.keys(game.submissions).length === 2) {
      if (game.timeoutHandle) {
        clearTimeout(game.timeoutHandle);
        game.timeoutHandle = null;
      }
      resolveRound(gameId);
    }
  });

  // ── disconnect (FIX #2 + #6) ───────────────────────────────────────────────
  authedSocket.on('disconnect', () => {
    const userId = authedSocket.user.userId;

    for (const [gameId, game] of activeGames) {
      if (!game.players.includes(userId) || game.status !== 'ACTIVE') continue;

      // Tell the other player their opponent dropped.
      authedSocket.to(game.id).emit('game:opponent_disconnected', {
        username: authedSocket.user.username,
        gracePeriodMs: RECONNECT_GRACE_MS,
      });

      // Start the reconnect-grace timer.
      const timerKey = `${gameId}:${userId}`;
      const existing = disconnectTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        disconnectTimers.delete(timerKey);
        const stillActive = activeGames.get(gameId);
        if (!stillActive || stillActive.status !== 'ACTIVE') return;

        // Player failed to reconnect — end the game.
        stillActive.status = 'COMPLETED';
        stillActive.winnerScore = null;
        if (stillActive.timeoutHandle) {
          clearTimeout(stillActive.timeoutHandle);
          stillActive.timeoutHandle = null;
        }
        persistCompletedGame(stillActive);
        io.to(gameId).emit('game:abandoned', {
          gameId,
          reason: `${authedSocket.user.username} disconnected and did not reconnect.`,
        });
      }, RECONNECT_GRACE_MS);

      disconnectTimers.set(timerKey, timer);
    }
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

loadActiveGames(); // FIX #3 — restore in-progress games from db.json

httpServer.listen(PORT, () => {
  console.log(`connect.io server running on http://localhost:${PORT}`);
});
