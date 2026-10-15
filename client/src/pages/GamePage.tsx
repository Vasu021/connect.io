import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Circle } from '../components/Circle';
import { Confetti } from '../components/Confetti';
import { CountdownRing } from '../components/CountdownRing';
import { PlayedWords } from '../components/PlayedWords';
import { LastRound, RoundHistory } from '../components/RoundHistory';
import { PixabayCredit, WordImage } from '../components/WordImage';
import { Standings } from '../components/Standings';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { normalizeWord } from '../lib/format';
import { ordinal, placementColor } from '../lib/placement';
import { useSocket, useSocketEvent } from '../lib/socket';
import { useToast } from '../lib/toasts';
import type {
  ConnectionFormedPayload,
  GameEndedPayload,
  GameStateView,
  PlayerLeftPayload,
  PlayerView,
  PresencePayload,
  RoundRevealedPayload,
  RoundStartedPayload,
  WordImagePayload,
  WordImageView,
} from '../lib/types';

/** Leave emits waiting out their grace window, keyed by game id. */
const pendingLeaves = new Map<string, number>();

/** How long the result stays up before everyone is returned to the dashboard. */
const REDIRECT_SECONDS = 25;

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();

  const [state, setState] = useState<GameStateView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [revealed, setRevealed] = useState<Map<string, { word: string; matched: boolean }> | null>(
    null,
  );
  const [ended, setEnded] = useState<GameEndedPayload | null>(null);
  const [word, setWord] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [celebrating, setCelebrating] = useState(false);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);

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
            perfectCircle: data.game.perfectCircle,
            connections: data.game.connections,
            wildcardId: data.game.wildcardId,
            reason: null,
            players: data.game.players.map((player) => ({
              id: player.id,
              username: player.username,
              status: player.status,
              placement: player.placement,
              connectedAtRound: player.connectedAtRound,
            })),
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

    // A remount (React StrictMode in development) must not fire the queued
    // "I left" from the previous cleanup.
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
    setRevealed(null);
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
            players: current.players.map((player) => ({ ...player, hasSubmitted: false })),
          }
        : current,
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  useSocketEvent<RoundRevealedPayload>('round:revealed', (payload) => {
    if (payload.gameId !== gameId) return;

    setRevealed(
      new Map(
        payload.round.submissions.map((submission) => [
          submission.userId,
          { word: submission.word, matched: submission.matched },
        ]),
      ),
    );

    setState((current) =>
      current
        ? {
            ...current,
            rounds: [...current.rounds.filter((r) => r.roundNumber !== payload.round.roundNumber), payload.round],
            playedWords: payload.playedWords,
            images: { ...current.images, ...payload.images },
            roundDeadline: null,
          }
        : current,
    );
  });

  useSocketEvent<WordImagePayload>('word:image', (payload) => {
    if (payload.gameId !== gameId) return;
    setState((current) =>
      current
        ? { ...current, images: { ...current.images, [payload.image.word]: payload.image } }
        : current,
    );
  });

  useSocketEvent<ConnectionFormedPayload>('connection:formed', (payload) => {
    if (payload.gameId !== gameId) return;
    const yours = payload.connection.memberIds.includes(user?.id ?? '');
    toast.show(
      yours
        ? `You connected on "${payload.connection.word}" — ${ordinal(payload.connection.placement)}!`
        : `Connection #${payload.connection.placement}: "${payload.connection.word}"`,
      yours ? 'good' : 'info',
    );
  });

  useSocketEvent<PlayerLeftPayload>('player:left', (payload) => {
    if (payload.gameId !== gameId) return;
    toast.show(
      payload.reason === 'idle'
        ? `@${payload.username} went quiet and left the circle`
        : `@${payload.username} dropped out`,
      'bad',
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
            perfectCircle: payload.perfectCircle,
            connections: payload.connections,
            wildcardId: payload.wildcardId,
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
    if (!payload.announced) return;
    toast.show(
      payload.online
        ? `@${payload.username} is back`
        : `@${payload.username} dropped — ${Math.round((payload.graceMs ?? 0) / 1000)}s to reconnect`,
      payload.online ? 'good' : 'bad',
    );
  });

  useSocketEvent<{ message: string }>('game:error', (payload) => {
    toast.show(payload.message, 'bad');
  });

  /* ── Countdown, derived during render ─────────────────────────────────── */

  const deadline = state?.roundDeadline ?? null;

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [deadline]);

  /* ── Redirect everyone home once the room is gone ─────────────────────── */

  useEffect(() => {
    if (!ended) return;
    setRedirectIn(REDIRECT_SECONDS);

    const timer = window.setInterval(() => {
      setRedirectIn((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          navigate('/', { replace: true });
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [ended, navigate]);

  /* ── Derived ──────────────────────────────────────────────────────────── */

  const totalSeconds = Math.round((state?.roundDurationMs ?? 15000) / 1000);
  const secondsLeft =
    deadline === null
      ? 0
      : Math.min(totalSeconds, Math.max(0, Math.ceil((deadline - now) / 1000)));

  // The last resolved round. Its words stay on screen while everyone thinks —
  // you cannot aim for the middle of words you had three seconds to memorise.
  const lastRound = state?.rounds[state.rounds.length - 1] ?? null;

  const seatWords = useMemo(() => {
    if (revealed) return revealed;
    if (!lastRound) return undefined;
    return new Map(
      lastRound.submissions.map((submission) => [
        submission.userId,
        { word: submission.word, matched: submission.matched },
      ]),
    );
  }, [revealed, lastRound]);

  const showingPreviousWords = revealed === null && lastRound !== null;

  const trimmed = word.trim();
  const alreadyPlayed = useMemo(() => {
    if (!trimmed || !state) return false;
    const needle = trimmed.toLowerCase();
    return state.playedWords.some((played) => played.toLowerCase() === needle);
  }, [trimmed, state]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!socket || !gameId || !trimmed || alreadyPlayed) return;
      socket.emit('game:submit', { gameId, word: trimmed });
    },
    [alreadyPlayed, gameId, socket, trimmed],
  );

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

  if (!state) {
    return (
      <div className="shell">
        <header className="topbar">
          <Brand />
        </header>
        <div className="card arena-main">
          <div className="muted small">Opening the circle…</div>
        </div>
      </div>
    );
  }

  const isOver = state.status === 'COMPLETED' && ended !== null;
  const youAreOut = state.youStatus !== 'ACTIVE';

  return (
    <div className="shell">
      {celebrating ? <Confetti /> : null}

      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="pill mono-code">{state.roomCode}</span>
          {isOver ? (
            <span className="pill">{state.players.length} players</span>
          ) : (
            <span className="pill">
              {state.activeCount} of {state.players.length} still in
            </span>
          )}
          {!connected ? <span className="pill pill-warn">reconnecting…</span> : null}
          <Link className="btn btn-ghost btn-sm" to="/">
            Leave
          </Link>
        </div>
      </header>

      <div className="arena">
        <section className="card arena-main">
          <Circle
            players={state.players}
            connections={state.connections}
            revealed={seatWords}
            wordsArePrevious={showingPreviousWords}
            images={state.images}
            wildcardId={isOver ? state.wildcardId : null}
          >
            {isOver ? (
              <CentreResult ended={ended} />
            ) : state.status === 'WAITING' ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="ring-label faint">—</div>
                <div className="tiny">getting ready</div>
              </div>
            ) : deadline === null ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="ring-label faint">—</div>
                <div className="tiny">revealing</div>
              </div>
            ) : (
              <CountdownRing
                secondsLeft={secondsLeft}
                totalSeconds={totalSeconds}
                caption={`round ${state.currentRound} / ${state.maxRounds}`}
              />
            )}
          </Circle>

          {isOver ? (
            <Result
              ended={ended}
              players={state.players}
              redirectIn={redirectIn}
              images={state.images}
            />
          ) : state.status === 'WAITING' ? (
            <div className="status-line">Waiting for everyone to arrive…</div>
          ) : revealed ? (
            <RevealSummary
              revealed={revealed}
              players={state.players}
              formed={state.rounds[state.rounds.length - 1]?.formed ?? []}
            />
          ) : youAreOut ? (
            <SpectatorPanel status={state.youStatus} placement={state.youStatus === 'CONNECTED' ? state.players.find((p) => p.isYou)?.placement ?? null : null} />
          ) : state.youSubmitted ? (
            <div className="stack" style={{ alignItems: 'center' }}>
              <div className="locked-word">
                <span aria-hidden="true">🔒</span>
                {state.youWord}
              </div>
              <div className="status-line">
                {state.players.filter((p) => p.status === 'ACTIVE' && p.hasSubmitted).length} of{' '}
                {state.activeCount} locked in
              </div>
              {lastRound ? (
                <LastRound round={lastRound} players={state.players} images={state.images} />
              ) : null}
            </div>
          ) : (
            <>
              <form className="word-form" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className={`input word-input${alreadyPlayed ? ' input-error' : ''}`}
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
                <button className="btn btn-primary" disabled={!trimmed || alreadyPlayed}>
                  Lock in
                </button>
              </form>
              {lastRound ? (
                <LastRound round={lastRound} players={state.players} images={state.images} />
              ) : null}

              {Object.keys(state.images).length > 0 ? <PixabayCredit /> : null}

              <div className="status-line">
                {alreadyPlayed ? (
                  <span style={{ color: 'var(--danger)' }}>
                    “{trimmed}” has already been played — find another.
                  </span>
                ) : lastRound ? (
                  'Aim for the middle of what everyone just said.'
                ) : (
                  'One new word. Match anyone else and you both connect.'
                )}
              </div>
            </>
          )}
        </section>

        <div className="dashboard-grid">
          <section className="card">
            <div className="card-head">
              <h2>Every round</h2>
              <span className="small faint">{state.rounds.length} played</span>
            </div>
            <RoundHistory rounds={state.rounds} players={state.players} />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Connections</h2>
              <span className="small faint">{state.connections.length} so far</span>
            </div>
            <Standings connections={state.connections} players={state.players} />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Played words</h2>
              <span className="small faint">{state.playedWords.length} burned</span>
            </div>
            <PlayedWords words={state.playedWords} />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-views ──────────────────────────────────────────────────────────── */

function CentreResult({ ended }: { ended: GameEndedPayload }) {
  const matched = ended.outcome === 'MATCHED' && ended.finalScore !== null;
  return (
    <div className="stack" style={{ gap: 2 }}>
      <div
        className="ring-label"
        style={{ color: matched ? 'var(--match)' : 'var(--text-faint)' }}
      >
        {matched ? ended.finalScore : '—'}
      </div>
      <div className="tiny">{matched ? 'rounds' : 'no score'}</div>
    </div>
  );
}

function SpectatorPanel({
  status,
  placement,
}: {
  status: 'CONNECTED' | 'LEFT' | 'ACTIVE';
  placement: number | null;
}) {
  if (status === 'LEFT') {
    return <div className="status-line">You are out of this game — watching the rest.</div>;
  }

  return (
    <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
      {placement ? (
        <div className="row">
          <span className="placement placement-lg" style={{ background: placementColor(placement) }}>
            {placement}
          </span>
          <strong>You connected {ordinal(placement)}</strong>
        </div>
      ) : null}
      <div className="status-line">Sit back — the rest are still looking for each other.</div>
    </div>
  );
}

function RevealSummary({
  revealed,
  players,
  formed,
}: {
  revealed: Map<string, { word: string; matched: boolean }>;
  players: PlayerView[];
  formed: { placement: number; word: string; memberIds: string[] }[];
}) {
  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    return player?.isYou ? 'you' : (player?.username ?? 'player');
  };

  return (
    <div className="stack" style={{ gap: 10, alignItems: 'center' }}>
      {formed.length > 0 ? (
        <div className="row row-wrap" style={{ justifyContent: 'center' }}>
          {formed.map((connection) => (
            <span
              className="pill"
              key={connection.placement}
              style={{
                borderColor: placementColor(connection.placement),
                color: placementColor(connection.placement),
              }}
            >
              #{connection.placement} “{connection.word}” — {connection.memberIds.map(nameOf).join(', ')}
            </span>
          ))}
        </div>
      ) : (
        <div className="status-line">No connections this round. Keep going.</div>
      )}

      {/* The circle hides word bubbles on narrow screens, so list them here. */}
      <div className="row row-wrap" style={{ justifyContent: 'center', gap: 6 }}>
        {[...revealed.entries()].map(([userId, entry]) => (
          <span
            className="pill"
            key={userId}
            style={entry.matched ? { color: 'var(--match)' } : undefined}
          >
            {nameOf(userId)}: {entry.word}
          </span>
        ))}
      </div>
    </div>
  );
}

function Result({
  ended,
  players,
  redirectIn,
  images,
}: {
  ended: GameEndedPayload;
  players: PlayerView[];
  redirectIn: number;
  images: Record<string, WordImageView>;
}) {
  const matched = ended.outcome === 'MATCHED' && ended.finalScore !== null;
  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    return player?.isYou ? 'you' : (player?.username ?? 'player');
  };

  const wildcard = ended.wildcardId ? nameOf(ended.wildcardId) : null;

  return (
    <div className="result" style={{ padding: '10px 0 0' }}>
      {ended.perfectCircle ? (
        <span className="perfect-banner">✦ Perfect circle — nobody left behind</span>
      ) : null}

      <h1 className="result-headline">
        {matched
          ? `The circle closed in ${ended.finalScore} ${ended.finalScore === 1 ? 'round' : 'rounds'}`
          : ended.outcome === 'UNMATCHED'
            ? 'You ran out of rounds'
            : ended.outcome === 'ABANDONED'
              ? 'Game abandoned'
              : 'Game ended early'}
      </h1>

      {ended.reason ? <p className="result-sub">{ended.reason}</p> : null}

      {ended.connections.length > 0 ? (
        <div className="podium">
          {ended.connections.map((connection) => (
            <div
              className="podium-row"
              key={connection.placement}
              style={{ borderLeftColor: placementColor(connection.placement) }}
            >
              <span
                className="placement placement-lg"
                style={{ background: placementColor(connection.placement) }}
              >
                {connection.placement}
              </span>
              <WordImage image={images[normalizeWord(connection.word)]} size="podium" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  className="podium-word"
                  style={{ color: placementColor(connection.placement) }}
                >
                  {connection.word}
                </div>
                <div className="small muted">{connection.memberIds.map(nameOf).join(' · ')}</div>
              </div>
              <span className="pill">round {connection.roundNumber}</span>
            </div>
          ))}

          {wildcard ? (
            <div className="podium-row" style={{ borderLeftColor: 'var(--warn)' }}>
              <span className="placement placement-lg" style={{ background: 'var(--warn)' }}>
                ★
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="podium-word" style={{ color: 'var(--warn)' }}>
                  Wildcard
                </div>
                <div className="small muted">
                  {wildcard} — nobody else was in that head
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary btn-lg" to="/">
          Back to dashboard
        </Link>
      </div>
      <p className="redirect-note">
        The room is closed. Returning you home in {redirectIn}s.
      </p>
      {Object.keys(images).length > 0 ? <PixabayCredit /> : null}
    </div>
  );
}
