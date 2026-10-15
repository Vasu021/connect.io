import type { GameOutcome, GamePlayerStatus, GameStatus } from '@prisma/client';
import type { WordImageView } from '../images/store.js';

export type { WordImageView };

export type ConnectionView = {
  /** 1 for the first group out of the circle, 2 for the next, and so on. */
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
  /** Connections that formed in this round. */
  formed: ConnectionView[];
};

export type PlayerView = {
  id: string;
  username: string;
  online: boolean;
  isYou: boolean;
  status: GamePlayerStatus;
  placement: number | null;
  connectedAtRound: number | null;
  /**
   * Whether this player has locked a word in for the round in progress.
   * Deliberately never the word itself — see the note on GameStateView.
   */
  hasSubmitted: boolean;
  /** Stable position around the circle, assigned at game start. */
  seat: number;
};

/**
 * What a single player is allowed to see.
 *
 * The only word of the current round in here is the viewer's own (`youWord`).
 * Every other player contributes `hasSubmitted` and nothing more — with eight
 * players there are seven ways to leak a pending word, and any one of them
 * would make the game trivially cheatable from devtools.
 *
 * `playedWords` is different: those words were revealed to the whole room when
 * their round resolved, so publishing them is correct — and necessary, since a
 * word already played can never be played again.
 */
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
  /** Epoch milliseconds, or null between rounds. */
  roundDeadline: number | null;
  players: PlayerView[];
  youId: string;
  youStatus: GamePlayerStatus;
  youSubmitted: boolean;
  youWord: string | null;
  activeCount: number;
  connections: ConnectionView[];
  rounds: RoundView[];
  /** Every word already burned in this game, normalised. */
  playedWords: string[];
  /**
   * Pictures for words whose round has already revealed, keyed by the
   * normalised word. Never contains the round in progress — an image for an
   * unrevealed word would give it away.
   */
  images: Record<string, WordImageView>;
  /** The player left alone when the circle closed, if there was one. */
  wildcardId: string | null;
};

export type RoomMemberView = {
  id: string;
  username: string;
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
  /** Seconds per round, as the host has it set. */
  roundDurationMs: number;
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED';
  hostId: string;
  youAreHost: boolean;
  members: RoomMemberView[];
  /** Set once the host starts, so clients know where to go. */
  activeGameId: string | null;
  createdAt: string;
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
  /** The viewer's own placement in this game, if they connected. */
  yourPlacement: number | null;
};
