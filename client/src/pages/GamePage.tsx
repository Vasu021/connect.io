import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { Brand } from '../components/Brand';
import { Confetti } from '../components/Confetti';
import { CountdownRing } from '../components/CountdownRing';
import { Reveal } from '../components/Reveal';
import { RoundTrail } from '../components/RoundTrail';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { outcomeLabel, scoreHeadline } from '../lib/format';
import { useSocket, useSocketEvent } from '../lib/socket';
import { useToast } from '../lib/toasts';
import type {
  GameEndedPayload,
  GameStateView,
  PresencePayload,
  RoundRevealedPayload,
  RoundStartedPayload,
  RoundView,
} from '../lib/types';

/** Leave emits waiting out their grace window, keyed by game id. */
const pendingLeaves = new Map<string, number>();

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();

  const [state, setState] = useState<GameStateView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reveal, setReveal] = useState<RoundView | null>(null);
  const [ended, setEnded] = useState<GameEndedPayload | null>(null);
  const [word, setWord] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [celebrating, setCelebrating] = useState(false);
  const [rematching, setRematching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Initial load ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    api
      .get<{ game: GameStateView }>(`/api/games/${gameId}`)
      .then((data) => {
        if (cancelled) return;
        setState(data.game);
        if (data.game.status === 'COMPLETED') {
          setEnded({
            gameId: data.game.id,
            outcome: data.game.outcome ?? 'UNMATCHED',
            finalScore: data.game.finalScore,
            rounds: data.game.rounds,
            reason: null,
            players: data.game.players,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not open this game');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  /* ── Join the room, and rejoin after any reconnect ────────────────────── */

  useEffect(() => {
    if (!socket || !gameId) return;

    // A remount (React StrictMode in development, or a quick re-render) would
    // otherwise fire the queued "I left" from the previous cleanup.
    const queued = pendingLeaves.get(gameId);
    if (queued !== undefined) {
      window.clearTimeout(queued);
      pendingLeaves.delete(gameId);
    }

    const join = () => socket.emit('game:join', { gameId });
    if (socket.connected) join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
      // Tell the server we have left so our partner is not left waiting on a
      // player who has navigated away — but hold it briefly, so a remount can
      // cancel it before the other player ever hears about it.
      const handle = window.setTimeout(() => {
        pendingLeaves.delete(gameId);
        socket.emit('game:leave', { gameId });
      }, 150);
      pendingLeaves.set(gameId, handle);
    };
  }, [socket, gameId]);

  /* ── Live events ──────────────────────────────────────────────────────── */

  useSocketEvent<GameStateView>('game:state', (payload) => {
    if (payload.id !== gameId) return;
    setState(payload);
  });

  useSocketEvent<RoundStartedPayload>('round:started', (payload) => {
    if (payload.gameId !== gameId) return;
    setReveal(null);
    setWord('');
    setState((current) =>
      current
        ? {
            ...current,
            status: 'ACTIVE',
            currentRound: payload.roundNumber,
            roundDeadline: payload.deadlineAt,
            youSubmitted: false,
            youWord: null,
            opponentSubmitted: false,
          }
        : current,
    );
    // Put the caret back in the box so a player can just keep typing.
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  useSocketEvent<RoundRevealedPayload>('round:revealed', (payload) => {
    if (payload.gameId !== gameId) return;
    setReveal(payload.round);
    setState((current) =>
      current ? { ...current, rounds: payload.rounds, roundDeadline: null } : current,
    );
  });

  useSocketEvent<GameEndedPayload>('game:ended', (payload) => {
    if (payload.gameId !== gameId) return;
    setEnded(payload);
    setState((current) =>
      current
        ? {
            ...current,
            status: 'COMPLETED',
            outcome: payload.outcome,
            finalScore: payload.finalScore,
            rounds: payload.rounds,
            roundDeadline: null,
          }
        : current,
    );

    if (payload.outcome === 'MATCHED') {
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 3200);
    }
  });

  useSocketEvent<PresencePayload>('game:presence', (payload) => {
    if (payload.gameId !== gameId || payload.userId === user?.id) return;

    // The indicator always tracks the truth; the toast only fires for drops
    // long enough that the server actually announced them.
    setState((current) =>
      current ? { ...current, opponentOnline: payload.online } : current,
    );

    if (!payload.announced) return;

    if (payload.online) {
      toast.show(`@${payload.username} is back`, 'good');
    } else {
      const seconds = Math.round((payload.graceMs ?? 0) / 1000);
      toast.show(
        seconds > 0
          ? `@${payload.username} dropped — ${seconds}s to reconnect`
          : `@${payload.username} went offline`,
        'bad',
      );
    }
  });

  useSocketEvent<{ message: string }>('game:error', (payload) => {
    toast.show(payload.message, 'bad');
  });

  /* ── Countdown ────────────────────────────────────────────────────────── */

  const deadline = state?.roundDeadline ?? null;

  // The remaining time is derived during render rather than stored in state.
  // Storing it meant the first paint of a round showed 0s — an empty, red,
  // "urgent" ring that then swept back to full.
  useEffect(() => {
    if (deadline === null) return;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);

    return () => window.clearInterval(timer);
  }, [deadline]);

  /* ── Derived ──────────────────────────────────────────────────────────── */

  const youArePlayer1 = useMemo(() => state?.players[0]?.isYou ?? true, [state]);
  const you = useMemo(() => state?.players.find((p) => p.isYou), [state]);
  const them = useMemo(() => state?.players.find((p) => !p.isYou), [state]);
  const totalSeconds = Math.round((state?.roundDurationMs ?? 15000) / 1000);
  // Clamped so a `now` that lags a fresh deadline by one tick cannot read high.
  const secondsLeft =
    deadline === null
      ? 0
      : Math.min(totalSeconds, Math.max(0, Math.ceil((deadline - now) / 1000)));

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const candidate = word.trim();
      if (!socket || !gameId || !candidate) return;
      socket.emit('game:submit', { gameId, word: candidate });
    },
    [gameId, socket, word],
  );

  async function requestRematch() {
    if (!gameId || rematching) return;
    setRematching(true);

    try {
      const data = await api.post<{ gameId: string }>(`/api/games/${gameId}/rematch`);
      navigate(`/game/${data.gameId}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not start a rematch', 'bad');
    } finally {
      setRematching(false);
    }
  }

  function copyRoomCode() {
    if (!state) return;
    void navigator.clipboard
      ?.writeText(state.roomCode)
      .then(() => toast.show('Room code copied', 'good'))
      .catch(() => toast.show(`Room code: ${state.roomCode}`, 'info'));
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (loadError) {
    return (
      <div className="shell">
        <header className="topbar">
          <Brand />
          <Link className="btn btn-ghost btn-sm" to="/">
            Back to dashboard
          </Link>
        </header>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Cannot open this game</h2>
          <p className="muted">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!state || !you || !them) {
    return (
      <div className="shell">
        <header className="topbar">
          <Brand />
        </header>
        <div className="card arena-main">
          <div className="skeleton" style={{ height: 148, borderRadius: 999, width: 148, margin: '0 auto' }} />
          <div className="muted small">Opening the room…</div>
        </div>
      </div>
    );
  }

  const isOver = state.status === 'COMPLETED' && ended !== null;

  return (
    <div className="shell">
      {celebrating ? <Confetti /> : null}

      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <button className="btn btn-ghost btn-sm mono-code" onClick={copyRoomCode} title="Copy room code">
            {state.roomCode}
          </button>
          {!connected ? <span className="pill pill-warn">reconnecting…</span> : null}
          {state.status === 'ACTIVE' ? (
            <button
              className="btn btn-ghost btn-sm btn-danger"
              onClick={() => socket?.emit('game:forfeit', { gameId })}
            >
              End game
            </button>
          ) : null}
          <Link className="btn btn-ghost btn-sm" to="/">
            Leave
          </Link>
        </div>
      </header>

      <div className="arena">
        {isOver ? (
          <ResultCard
            ended={ended}
            youArePlayer1={youArePlayer1}
            onRematch={requestRematch}
            rematching={rematching}
          />
        ) : (
          <section className="card arena-main">
            <div className="versus">
              <div className="versus-side">
                <Avatar username={you.username} side="you" large />
                <span className="versus-name" style={{ color: 'var(--you)' }}>
                  you
                </span>
                {state.youSubmitted ? (
                  <span className="pill pill-you">locked in</span>
                ) : (
                  <span className="pill">thinking</span>
                )}
              </div>

              <div className={`versus-link${reveal?.matched ? ' is-connected' : ''}`} />

              <div className="versus-side">
                <Avatar username={them.username} side="them" large />
                <span className="versus-name" style={{ color: 'var(--them)' }}>
                  @{them.username}
                </span>
                {!state.opponentOnline ? (
                  <span className="pill pill-warn">offline</span>
                ) : state.opponentSubmitted ? (
                  <span className="pill pill-them">locked in</span>
                ) : (
                  <span className="pill pill-them">
                    <span className="thinking" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                )}
              </div>
            </div>

            {state.status === 'WAITING' ? (
              <WaitingPanel opponent={them.username} online={state.opponentOnline} roomCode={state.roomCode} />
            ) : reveal ? (
              <>
                <Reveal round={reveal} youArePlayer1={youArePlayer1} />
                <div className="status-line">
                  {reveal.matched
                    ? 'You landed on the same word.'
                    : 'Not this time — next round starting…'}
                </div>
              </>
            ) : deadline === null ? (
              // ACTIVE but no deadline yet: the round is still being set up.
              // Rendering the clock here would flash an empty, urgent-red ring.
              <div className="stack" style={{ alignItems: 'center', gap: 12 }}>
                <div className="ring-wrap">
                  <span className="ring-label faint">—</span>
                  <span className="ring-sub">getting ready</span>
                </div>
                <div className="status-line">Starting the round…</div>
              </div>
            ) : (
              <>
                <CountdownRing
                  secondsLeft={secondsLeft}
                  totalSeconds={totalSeconds}
                  caption={`round ${state.currentRound} / ${state.maxRounds}`}
                />

                {state.youSubmitted ? (
                  <div className="stack" style={{ alignItems: 'center' }}>
                    <div className="locked-word">
                      <span aria-hidden="true">🔒</span>
                      {state.youWord}
                    </div>
                    <div className="status-line">
                      {state.opponentSubmitted
                        ? 'Both in. Revealing…'
                        : `Waiting for @${them.username}…`}
                    </div>
                  </div>
                ) : (
                  <form className="word-form" onSubmit={submit}>
                    <input
                      ref={inputRef}
                      className="input word-input"
                      value={word}
                      maxLength={32}
                      onChange={(e) => setWord(e.target.value)}
                      placeholder="one word"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      aria-label="Your word for this round"
                    />
                    <button className="btn btn-primary" disabled={!word.trim()}>
                      Lock in
                    </button>
                  </form>
                )}

                {!state.youSubmitted ? (
                  <div className="status-line">
                    One word. No spaces. You both reveal at once.
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2>The trail</h2>
            <span className="small faint">
              {state.rounds.length} {state.rounds.length === 1 ? 'round' : 'rounds'}
            </span>
          </div>
          <RoundTrail rounds={state.rounds} youArePlayer1={youArePlayer1} />
        </section>
      </div>
    </div>
  );
}

/* ─── Sub-views ──────────────────────────────────────────────────────────── */

function WaitingPanel({
  opponent,
  online,
  roomCode,
}: {
  opponent: string;
  online: boolean;
  roomCode: string;
}) {
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 14 }}>
      <h2 style={{ fontSize: 22 }}>Waiting for @{opponent}</h2>
      <p className="muted small" style={{ maxWidth: '40ch' }}>
        The first round starts the moment you are both in the room.
      </p>
      <div className="row">
        <OnlineDot online={online} />
        <span className="small muted">
          {online ? `@${opponent} is online — they should be here any second` : `@${opponent} is offline`}
        </span>
      </div>
      <div className="pill">
        room <span className="mono-code">{roomCode}</span>
      </div>
    </div>
  );
}

function ResultCard({
  ended,
  youArePlayer1,
  onRematch,
  rematching,
}: {
  ended: GameEndedPayload;
  youArePlayer1: boolean;
  onRematch: () => void;
  rematching: boolean;
}) {
  const matched = ended.outcome === 'MATCHED' && ended.finalScore !== null;
  const score = ended.finalScore ?? 0;

  // Count the score up — it makes a small number feel like a result.
  const [shown, setShown] = useState(matched ? 1 : 0);

  useEffect(() => {
    if (!matched || score <= 1) {
      setShown(score);
      return;
    }

    let current = 1;
    setShown(1);
    const timer = window.setInterval(() => {
      current += 1;
      setShown(current);
      if (current >= score) window.clearInterval(timer);
    }, 90);

    return () => window.clearInterval(timer);
  }, [matched, score]);

  const finalRound = ended.rounds[ended.rounds.length - 1];
  const sharedWord = matched && finalRound ? (youArePlayer1 ? finalRound.player1Word : finalRound.player2Word) : null;

  return (
    <section className="card result">
      <div className={`score-orb${matched ? '' : ' is-unscored'}`}>
        <span className="score-number">{matched ? shown : '—'}</span>
        <span className="score-caption">{matched ? 'rounds' : outcomeLabel(ended.outcome)}</span>
      </div>

      {matched ? (
        <>
          <h1 className="result-headline">{scoreHeadline(score)}</h1>
          <p className="result-sub">
            You both said <strong style={{ color: 'var(--match)' }}>{sharedWord}</strong>. That score
            belongs to the two of you — it is on the leaderboard now.
          </p>
        </>
      ) : (
        <>
          <h1 className="result-headline">
            {ended.outcome === 'UNMATCHED'
              ? 'You ran out of rounds'
              : ended.outcome === 'ABANDONED'
                ? 'Game abandoned'
                : 'Game ended early'}
          </h1>
          <p className="result-sub">
            {ended.reason ??
              'No match this time, so there is no score — only a matched game counts.'}
          </p>
        </>
      )}

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary btn-lg" onClick={onRematch} disabled={rematching}>
          {rematching ? 'Starting…' : 'Play again'}
        </button>
        <Link className="btn btn-lg" to="/">
          Dashboard
        </Link>
      </div>
    </section>
  );
}
