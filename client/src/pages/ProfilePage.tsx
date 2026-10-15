import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { Brand } from '../components/Brand';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { PlayerStats } from '../lib/types';

type Profile = {
  user: { id: string; username: string; createdAt: string; online: boolean };
  stats: PlayerStats;
};

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    api
      .get<Profile>(`/api/users/${userId}/stats`)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load profile');
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isYou = user?.id === userId;

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <Link className="btn btn-ghost btn-sm" to="/">
          Back to dashboard
        </Link>
      </header>

      {error ? (
        <div className="card">
          <p className="muted">{error}</p>
        </div>
      ) : !profile ? (
        <div className="card">
          <div className="skeleton" />
        </div>
      ) : (
        <div className="dashboard-grid">
          <section className="card span-2">
            <div className="row" style={{ gap: 16 }}>
              <Avatar username={profile.user.username} side={isYou ? 'you' : 'them'} large />
              <div>
                <h1 style={{ fontSize: 26 }}>@{profile.user.username}</h1>
                <div className="row small muted">
                  <OnlineDot online={profile.user.online} />
                  {profile.user.online ? 'Online now' : 'Offline'}
                  <span className="faint">· joined {timeAgo(profile.user.createdAt)}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card span-2">
            <div className="card-head">
              <h2>Record</h2>
              <span className="small faint">A lower best score is a closer mind</span>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-value is-best">{profile.stats.bestScore ?? '—'}</div>
                <div className="tiny">Best score</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.averageScore ?? '—'}</div>
                <div className="tiny">Average</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.gamesMatched}</div>
                <div className="tiny">Connected</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.gamesPlayed}</div>
                <div className="tiny">Played</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.unmatched}</div>
                <div className="tiny">No match</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.abandoned}</div>
                <div className="tiny">Unfinished</div>
              </div>
            </div>
          </section>

          <section className="card span-2">
            <div className="card-head">
              <h2>Closest partners</h2>
              <span className="small faint">Best score together</span>
            </div>

            {profile.stats.topPartners.length === 0 ? (
              <div className="empty">
                No connected games yet — a score needs two people who actually matched.
              </div>
            ) : (
              <div className="rows">
                {profile.stats.topPartners.map((partner, index) => (
                  <div className="list-row" key={partner.id}>
                    <div className="row-main">
                      <span className={`rank rank-${index + 1}`}>{index + 1}</span>
                      <div className="row-label">
                        <div className="row-name">
                          <Link to={`/player/${partner.id}`}>@{partner.username}</Link>
                        </div>
                        <div className="small faint">
                          {partner.games} {partner.games === 1 ? 'game' : 'games'} together
                        </div>
                      </div>
                    </div>
                    <span className="score-chip">{partner.best}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
