import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Socket, io } from 'socket.io-client';
import { API_BASE, api, getToken } from '../lib/api';
import { EndedPayload, GameState, RevealPayload, User } from '../types';

type Props = {
  user: User;
};

type GameResponse = {
  game: GameState;
};

type RoundStartedPayload = {
  gameId: string;
  roundNumber: number;
  deadlineAt: number;
  roundHistory: GameState['roundHistory'];
};

type ErrorPayload = {
  message: string;
};

export default function GamePage({ user }: Props) {
  const { gameId } = useParams<{ gameId: string }>();
  const socketRef = useRef<Socket | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [word, setWord] = useState('');
  const [message, setMessage] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [revealedRound, setRevealedRound] = useState<RevealPayload | null>(null);

  useEffect(() => {
    if (!gameId) {
      setMessage('Missing game id');
      return;
    }

    api<GameResponse>(`/api/games/${gameId}`)
      .then((data) => setGame(data.game))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Failed to load game'));
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;

    const socket = io(API_BASE, {
      auth: {
        token: getToken(),
      },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('game:join_room', { gameId });
    });

    socket.on('game:error', (payload: ErrorPayload) => {
      setMessage(payload.message);
    });

    socket.on('game:state_sync', (payload: GameState) => {
      setGame(payload);
    });

    socket.on('game:started', () => {
      setMessage('Both players joined. Game started.');
    });

    socket.on('game:round_started', (payload: RoundStartedPayload) => {
      setMessage(`Round ${payload.roundNumber} started.`);
      setRevealedRound(null);
      setWord('');
      setGame((prev) =>
        prev
          ? {
              ...prev,
              currentRound: payload.roundNumber,
              roundDeadline: payload.deadlineAt,
              roundHistory: payload.roundHistory,
              viewerHasSubmitted: false,
              status: 'ACTIVE',
            }
          : prev,
      );
    });

    socket.on('game:submission_received', () => {
      setMessage('Word submitted. Waiting for the reveal.');
      setGame((prev) => (prev ? { ...prev, viewerHasSubmitted: true } : prev));
    });

    socket.on('game:round_revealed', (payload: RevealPayload) => {
      setRevealedRound(payload);
      setMessage(
        payload.matched
          ? `Match found in round ${payload.roundNumber}.`
          : `No match in round ${payload.roundNumber}. Next round is coming.`,
      );
      setGame((prev) => (prev ? { ...prev, roundHistory: payload.roundHistory } : prev));
    });

    socket.on('game:ended', (payload: EndedPayload) => {
      setMessage(`Game ended. Final score: ${payload.finalScore}`);
      setGame((prev) =>
        prev
          ? {
              ...prev,
              status: 'COMPLETED',
              winnerScore: payload.finalScore,
              roundHistory: payload.roundHistory,
            }
          : prev,
      );
    });

    // FIX #2 + #6 — Opponent disconnect / reconnect / abandon events.
    socket.on('game:opponent_disconnected', (payload: { username: string; gracePeriodMs: number }) => {
      const secs = Math.round(payload.gracePeriodMs / 1000);
      setMessage(`@${payload.username} disconnected. Waiting ${secs}s for them to reconnect…`);
    });

    socket.on('game:opponent_reconnected', (payload: { username: string }) => {
      setMessage(`@${payload.username} reconnected. Game continues!`);
    });

    socket.on('game:abandoned', (payload: { gameId: string; reason: string }) => {
      setMessage(`Game abandoned — ${payload.reason}`);
      setGame((prev) => (prev ? { ...prev, status: 'COMPLETED' } : prev));
    });

    return () => {
      socket.disconnect();
    };
  }, [gameId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft(() => {
        if (!game?.roundDeadline) return 15;
        return Math.max(0, Math.ceil((game.roundDeadline - Date.now()) / 1000));
      });
    }, 250);

    return () => window.clearInterval(timer);
  }, [game?.roundDeadline]);

  const playerNames = useMemo(() => game?.players.map((player) => player.username) ?? [], [game]);

  function submitWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gameId || !word.trim()) return;
    socketRef.current?.emit('game:submit_word', { gameId, word });
  }

  return (
    <div className="page-shell">
      <div className="topbar">
        <div>
          <h1>Game room</h1>
          <p className="muted">Player: @{user.username}</p>
        </div>
        <a href="/" className="ghost-btn anchor-btn">
          Back to dashboard
        </a>
      </div>

      {message ? <div className="notice">{message}</div> : null}

      {!game ? (
        <div className="card">Loading room...</div>
      ) : (
        <div className="game-layout">
          <section className="card">
            <h2>Room details</h2>
            <div className="meta-grid">
              <div>
                <div className="muted small">Room code</div>
                <strong>{game.roomCode}</strong>
              </div>
              <div>
                <div className="muted small">Status</div>
                <strong>{game.status}</strong>
              </div>
              <div>
                <div className="muted small">Round</div>
                <strong>{game.currentRound || 0}</strong>
              </div>
              <div>
                <div className="muted small">Timer</div>
                <strong>{secondsLeft}s</strong>
              </div>
            </div>
            <div className="players-row">
              {playerNames.map((name) => (
                <span className="pill" key={name}>
                  @{name}
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Submit your word</h2>
            {game.status === 'WAITING' ? (
              <div className="muted">Waiting for both players to open this room.</div>
            ) : game.status === 'COMPLETED' ? (
              <div>
                <div className="score-badge large-badge">Final score {game.winnerScore}</div>
              </div>
            ) : (
              <form className="stack" onSubmit={submitWord}>
                <input
                  placeholder="Type one word"
                  value={word}
                  maxLength={32}
                  onChange={(e) => setWord(e.target.value)}
                  disabled={game.viewerHasSubmitted}
                />
                <button className="primary-btn" disabled={game.viewerHasSubmitted}>
                  {game.viewerHasSubmitted ? 'Submitted' : 'Submit word'}
                </button>
              </form>
            )}
          </section>

          <section className="card">
            <h2>Latest reveal</h2>
            {!revealedRound ? (
              <div className="muted">No reveal yet for this round.</div>
            ) : (
              <div className="reveal-grid">
                <div className="reveal-box">
                  <div className="muted small">{playerNames[0] ?? 'Player 1'}</div>
                  <strong>{revealedRound.player1Word || '—'}</strong>
                </div>
                <div className="reveal-box">
                  <div className="muted small">{playerNames[1] ?? 'Player 2'}</div>
                  <strong>{revealedRound.player2Word || '—'}</strong>
                </div>
                <div className="result-banner">{revealedRound.matched ? 'Connected!' : 'Not matched'}</div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Round history</h2>
            <div className="list">
              {game.roundHistory.length ? (
                game.roundHistory.map((round) => (
                  <div className="list-row" key={round.roundNumber}>
                    <div>
                      <strong>Round {round.roundNumber}</strong>
                      <div className="muted small">
                        {round.player1Word || '—'} / {round.player2Word || '—'}
                      </div>
                    </div>
                    <span className={`pill ${round.matched ? 'pill-success' : ''}`}>
                      {round.matched ? 'Match' : 'No match'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="muted">No rounds resolved yet.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
