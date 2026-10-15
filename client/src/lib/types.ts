export type GameStatus = 'WAITING' | 'ACTIVE' | 'COMPLETED';
export type GameOutcome = 'MATCHED' | 'UNMATCHED' | 'ABANDONED' | 'FORFEITED';

export type User = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

export type Friend = {
  id: string;
  username: string;
  online: boolean;
  friendsSince: string;
};

export type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

export type SearchResult = {
  id: string;
  username: string;
  online: boolean;
  relationship: Relationship;
  requestId: string | null;
};

export type FriendRequestView = {
  id: string;
  createdAt: string;
  user: { id: string; username: string; online: boolean };
};

export type RoundView = {
  roundNumber: number;
  player1Word: string | null;
  player2Word: string | null;
  matched: boolean;
  revealedAt: string;
};

export type PlayerView = {
  id: string;
  username: string;
  online: boolean;
  isYou: boolean;
};

export type GameStateView = {
  id: string;
  roomCode: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  finalScore: number | null;
  currentRound: number;
  maxRounds: number;
  roundDurationMs: number;
  roundDeadline: number | null;
  players: PlayerView[];
  youId: string;
  opponentId: string;
  youSubmitted: boolean;
  youWord: string | null;
  opponentSubmitted: boolean;
  opponentOnline: boolean;
  bothPresent: boolean;
  rounds: RoundView[];
};

export type GameSummary = {
  id: string;
  roomCode: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  finalScore: number | null;
  currentRound: number;
  createdAt: string;
  endedAt: string | null;
  opponent: { id: string; username: string; online: boolean };
  youInvited: boolean;
};

export type HistoryGame = GameSummary & {
  players: { id: string; username: string }[];
  rounds: RoundView[];
};

export type LeaderboardEntry = {
  rank: number;
  pairKey: string;
  players: { id: string; username: string }[];
  bestScore: number;
  games: number;
  lastPlayed: string | null;
};

export type PlayerStats = {
  gamesPlayed: number;
  gamesMatched: number;
  bestScore: number | null;
  averageScore: number | null;
  unmatched: number;
  abandoned: number;
  topPartners: { id: string; username: string; games: number; best: number | null }[];
};

/* ─── Socket payloads ─────────────────────────────────────────────────────── */

export type RoundStartedPayload = {
  gameId: string;
  roundNumber: number;
  deadlineAt: number;
  durationMs: number;
};

export type RoundRevealedPayload = {
  gameId: string;
  round: RoundView;
  rounds: RoundView[];
  isFinal: boolean;
};

export type GameEndedPayload = {
  gameId: string;
  outcome: GameOutcome;
  finalScore: number | null;
  rounds: RoundView[];
  reason: string | null;
  players: { id: string; username: string }[];
};

export type PresencePayload = {
  gameId: string;
  userId: string;
  username: string;
  online: boolean;
  graceMs?: number;
  /** True only when the partner was actually told — brief blips are silent. */
  announced?: boolean;
};

export type InvitePayload = {
  gameId: string;
  roomCode: string;
  from: { id: string; username: string };
};
