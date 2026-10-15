import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Standings } from '../components/Standings';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { outcomeLabel, timeAgo } from '../lib/format';
import { ordinal, placementColor } from '../lib/placement';
import type { HistoryGame } from '../lib/types';

export default function HistoryPage() {
  const { user } = useAuth();
  const [games, setGames] = useState<HistoryGame[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ games: HistoryGame[] }>('/api/games/history?limit=30')
      .then((data) => {
        if (cancelled) return;
        setGames(data.games);
        setOpenId(data.games[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <Link className="btn btn-ghost btn-sm" to="/">
          Back to dashboard
        </Link>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Your games</h2>
          <span className="small faint">{games.length} finished</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          The words everyone burned on the way are the interesting part — open a game to read the
          whole circle.
        </p>
      </div>

      {error ? (
        <div className="card">
          <p className="muted">{error}</p>
        </div>
      ) : loading ? (
        <div className="card stack">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : games.length === 0 ? (
        <div className="card">
          <div className="empty">No finished games yet. Go close a circle.</div>
        </div>
      ) : (
        <div className="stack">
          {games.map((game) => {
            const open = openId === game.id;
            const matched = game.outcome === 'MATCHED' && game.finalScore !== null;
            const others = game.players.filter((player) => player.id !== user?.id);

            return (
              <section className="card" key={game.id}>
                <button
                  className="list-row"
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: 0,
                  }}
                  onClick={() => setOpenId(open ? null : game.id)}
                  aria-expanded={open}
                >
                  <div className="row-main">
                    <span className={`score-chip${matched ? '' : ' is-neutral'}`}>
                      {matched ? game.finalScore : '—'}
                    </span>
                    <div className="row-label">
                      <div className="row-name">
                        {game.playerCount} players
                        <span className="faint small"> · {outcomeLabel(game.outcome)}</span>
                        {game.perfectCircle ? (
                          <span className="pill pill-match" style={{ marginLeft: 8 }}>
                            perfect
                          </span>
                        ) : null}
                      </div>
                      <div className="small faint">
                        {others.map((player) => `@${player.username}`).join(', ')} ·{' '}
                        {timeAgo(game.endedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="list-row-actions">
                    {game.yourPlacement ? (
                      <span
                        className="placement"
                        style={{ background: placementColor(game.yourPlacement) }}
                        title={`You connected ${ordinal(game.yourPlacement)}`}
                      >
                        {game.yourPlacement}
                      </span>
                    ) : null}
                    <span className="pill">{open ? 'Hide' : 'Open'}</span>
                  </div>
                </button>

                {open ? (
                  <div className="stack" style={{ marginTop: 14 }}>
                    <Standings
                      connections={game.connections}
                      players={game.players.map((player) => ({
                        ...player,
                        isYou: player.id === user?.id,
                      }))}
                    />

                    <div>
                      <div className="tiny" style={{ marginBottom: 6 }}>
                        Round by round
                      </div>
                      <div className="trail">
                        {game.rounds.map((round) => (
                          <div
                            className={`trail-row${round.formed.length ? ' is-matched' : ''}`}
                            key={round.roundNumber}
                            style={{ gridTemplateColumns: '34px 1fr' }}
                          >
                            <span className="trail-num">{round.roundNumber}</span>
                            <div className="row row-wrap" style={{ gap: 6 }}>
                              {round.submissions.map((submission) => {
                                const player = game.players.find(
                                  (candidate) => candidate.id === submission.userId,
                                );
                                return (
                                  <span
                                    className="pill"
                                    key={submission.userId}
                                    style={
                                      submission.matched ? { color: 'var(--match)' } : undefined
                                    }
                                  >
                                    {player?.id === user?.id ? 'you' : player?.username}:{' '}
                                    {submission.word}
                                  </span>
                                );
                              })}
                              {round.submissions.length === 0 ? (
                                <span className="faint small">nobody spoke</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
