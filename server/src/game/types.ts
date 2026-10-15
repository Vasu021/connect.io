import type { GameOutcome, GameStatus } from '@prisma/client';

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

/**
 * What a single player is allowed to see. Crucially this never carries the
 * opponent's pending word — only whether they have locked one in — otherwise
 * the whole game would be trivially cheatable from devtools.
 */
export type GameStateView = {
  id: string;
  roomCode: string;
  status: GameStatus;
  outcome: GameOutcome | null;
  finalScore: number | null;
  currentRound: number;
  maxRounds: number;
  roundDurationMs: number;
  /** Epoch milliseconds, or null between rounds. */
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
  /** True when the viewer created the game and is waiting on the other player. */
  youInvited: boolean;
};
