import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { RoundTrail } from '../components/RoundTrail';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { outcomeLabel, timeAgo } from '../lib/format';
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
        // Open the most recent game so the page is not a wall of closed rows.
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
          The words you burned getting there are the interesting part — open a game to read the
          trail.
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
          <div className="empty">No finished games yet. Go connect with someone.</div>
        </div>
      ) : (
        <div className="stack">
          {games.map((game) => {
            const open = openId === game.id;
            const youArePlayer1 = game.players[0]?.id === user?.id;
            const matched = game.outcome === 'MATCHED' && game.finalScore !== null;

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
                        vs @{game.opponent.username}
                        <span className="faint small"> · {outcomeLabel(game.outcome)}</span>
                      </div>
                      <div className="small faint">
                        {game.rounds.length} {game.rounds.length === 1 ? 'round' : 'rounds'} ·{' '}
                        {timeAgo(game.endedAt)} · room{' '}
                        <span className="mono-code">{game.roomCode}</span>
                      </div>
                    </div>
                  </div>
                  <span className="pill">{open ? 'Hide' : 'Trail'}</span>
                </button>

                {open ? (
                  <div style={{ marginTop: 14 }}>
                    <RoundTrail rounds={game.rounds} youArePlayer1={youArePlayer1} />
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
