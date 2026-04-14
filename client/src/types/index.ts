export type User = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
};

export type IncomingRequest = FriendRequest & {
  fromUser: User;
};

export type OutgoingRequest = FriendRequest & {
  toUser: User;
};

export type RoundRecord = {
  roundNumber: number;
  player1Word: string | null;
  player2Word: string | null;
  matched: boolean;
  revealedAt: string;
};

export type PublicPlayer = {
  id: string;
  username: string;
};

export type GameState = {
  id: string;
  roomCode: string;
  status: 'WAITING' | 'ACTIVE' | 'COMPLETED';
  currentRound: number;
  players: PublicPlayer[];
  roundDeadline: number | null;
  submissionsCount: number;
  viewerHasSubmitted: boolean;
  roundHistory: RoundRecord[];
  winnerScore: number | null;
};

export type RevealPayload = {
  gameId: string;
  roundNumber: number;
  player1Word: string | null;
  player2Word: string | null;
  matched: boolean;
  roundHistory: RoundRecord[];
};

export type EndedPayload = {
  gameId: string;
  finalScore: number;
  roundHistory: RoundRecord[];
  leaderboardUpdated: boolean;
};

export type LeaderboardEntry = {
  id: string;
  roomCode: string;
  finalScore: number;
  endedAt: string;
  players: [string, string];
};
