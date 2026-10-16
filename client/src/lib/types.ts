export type GameStatus = 'WAITING' | 'ACTIVE' | 'COMPLETED';
export type GameOutcome = 'MATCHED' | 'UNMATCHED' | 'ABANDONED' | 'FORFEITED';
export type PlayerStatus = 'ACTIVE' | 'CONNECTED' | 'LEFT';
export type RoomStatus = 'LOBBY' | 'IN_GAME' | 'CLOSED';

export type User = {
  id: string;
  username: string;
  email: string;
  /** One of the preset animal ids, or null for initials. */
  avatar: string | null;
  createdAt: string;
};

export type Friend = {
  id: string;
  username: string;
  avatar: string | null;
  online: boolean;
  friendsSince: string;
};

export type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

export type SearchResult = {
  id: string;
  username: string;
  avatar: string | null;
  online: boolean;
  relationship: Relationship;
  requestId: string | null;
};

export type FriendRequestView = {
  id: string;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null; online: boolean };
};

/* ─── Rooms ───────────────────────────────────────────────────────────────── */

export type RoomMemberView = {
  id: string;
  username: string;
  avatar: string | null;
  online: boolean;
  isHost: boolean;
  isYou: boolean;
};

export type RoomView = {
  id: string;
  code: string;
  name: string | null;
  hasPassword: boolean;
  maxPlayers: number;
  /** Milliseconds per round, as the host has it set. */
  roundDurationMs: number;
  status: RoomStatus;
  hostId: string;
  youAreHost: boolean;
  members: RoomMemberView[];
  activeGameId: string | null;
  createdAt: string;
};

export type RoomInviteView = {
  id: string;
  createdAt: string;
  from: { id: string; username: string };
  room: {
    id: string;
    code: string;
    name: string | null;
    maxPlayers: number;
    hasPassword: boolean;
    memberCount: number;
  };
};

/* ─── Game ────────────────────────────────────────────────────────────────── */

export type WordImageView = {
  id: string;
  word: string;
  photographer: string | null;
  photographerUrl: string | null;
  pageUrl: string | null;
  tags: string | null;
  width: number | null;
  height: number | null;
};

export type ConnectionView = {
  placement: number;
  word: string;
  roundNumber: number;
  memberIds: string[];
};

export type SubmissionView = {
  userId: string;
  word: string;
  matched: boolean;
};

export type RoundView = {
  roundNumber: number;
  revealedAt: string;
  submissions: SubmissionView[];
  formed: ConnectionView[];
};

export type PlayerView = {
  id: string;
  username: string;
  avatar: string | null;
  online: boolean;
  isYou: boolean;
  status: PlayerStatus;
  placement: number | null;
  connectedAtRound: number | null;
  hasSubmitted: boolean;
  seat: number;
};

export type GameStateView = {
  id: string;
  roomId: string;
  roomCode: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  finalScore: number | null;
  perfectCircle: boolean;
  currentRound: number;
  maxRounds: number;
  roundDurationMs: number;
  roundDeadline: number | null;
  players: PlayerView[];
  youId: string;
  youStatus: PlayerStatus;
  youSubmitted: boolean;
  youWord: string | null;
  activeCount: number;
  connections: ConnectionView[];
  rounds: RoundView[];
  playedWords: string[];
  /**
   * Pictures for revealed words only, keyed by the normalised word. The server
   * never includes the round in progress — an image would give the word away.
   */
  images: Record<string, WordImageView>;
  wildcardId: string | null;
};

export type GameSummary = {
  id: string;
  roomCode: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  finalScore: number | null;
  playerCount: number;
  perfectCircle: boolean;
  currentRound: number;
  createdAt: string;
  endedAt: string | null;
  players: { id: string; username: string }[];
  yourPlacement: number | null;
};

export type HistoryGame = GameSummary & {
  connections: ConnectionView[];
  rounds: RoundView[];
};

export type LeaderboardEntry = {
  rank: number;
  /** Identifies the set of players, so a group appears once at its best. */
  groupKey: string;
  games: number;
  gameId: string;
  roomCode: string;
  finalScore: number;
  playerCount: number;
  perfectCircle: boolean;
  endedAt: string | null;
  players: { id: string; username: string; placement: number | null }[];
};

export type LeaderboardResponse = {
  availableSizes: { playerCount: number; games: number }[];
  leaderboard: LeaderboardEntry[];
};

export type PlayerStats = {
  gamesPlayed: number;
  gamesConnected: number;
  bestScore: number | null;
  averageScore: number | null;
  firstPlaceFinishes: number;
  averagePlacement: number | null;
  fastestConnection: number | null;
  perfectCircles: number;
  wildcards: number;
  unfinished: number;
  topPartners: {
    id: string;
    username: string;
    avatar: string | null;
    times: number;
    fastest: number | null;
  }[];
};

/* ─── Socket payloads ─────────────────────────────────────────────────────── */

export type RoundStartedPayload = {
  gameId: string;
  roundNumber: number;
  deadlineAt: number;
  durationMs: number;
  activeCount: number;
};

export type RoundRevealedPayload = {
  gameId: string;
  round: RoundView;
  images: Record<string, WordImageView>;
  playedWords: string[];
  remaining: number;
  isFinal: boolean;
};

export type ConnectionFormedPayload = {
  gameId: string;
  connection: ConnectionView;
};

export type GameEndedPayload = {
  gameId: string;
  outcome: GameOutcome;
  finalScore: number | null;
  perfectCircle: boolean;
  connections: ConnectionView[];
  wildcardId: string | null;
  reason: string | null;
  players: {
    id: string;
    username: string;
    status: PlayerStatus;
    placement: number | null;
    connectedAtRound: number | null;
  }[];
};

export type PlayerLeftPayload = {
  gameId: string;
  userId: string;
  username: string;
  remaining: number;
  reason?: string;
};

export type PresencePayload = {
  gameId: string;
  userId: string;
  username: string;
  online: boolean;
  graceMs?: number;
  announced?: boolean;
};

export type WordImagePayload = {
  gameId: string;
  image: WordImageView;
};

export type RoomInvitedPayload = {
  roomId: string;
  code: string;
  name: string | null;
  hasPassword: boolean;
  from: { id: string; username: string };
};

export type RoomGameStartedPayload = {
  roomId: string;
  gameId: string;
};
