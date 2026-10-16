import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { ANIMALS, AVATAR_IDS, type AvatarId } from '../components/AnimalAvatar';
import { Brand } from '../components/Brand';
import { MadeBy } from '../components/MadeBy';
import { ApiError, api } from '../lib/api';
import { useToast } from '../lib/toasts';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { PlayerStats } from '../lib/types';

type Profile = {
  user: {
    id: string;
    username: string;
    avatar: string | null;
    createdAt: string;
    online: boolean;
  };
  stats: PlayerStats;
};

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  /** Only you can change your own face. */
  async function chooseAvatar(avatar: AvatarId | null) {
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/api/users/me/avatar', { avatar });
      setProfile((current) =>
        current ? { ...current, user: { ...current.user, avatar } } : current,
      );
      // Refresh the session so the header and every other card update too.
      await refresh();
      toast.show(avatar ? `You are a ${ANIMALS[avatar].label.toLowerCase()} now` : 'Back to initials', 'good');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not change your picture', 'bad');
    } finally {
      setSaving(false);
    }
  }

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
              <Avatar
                username={profile.user.username}
                avatar={profile.user.avatar}
                side={isYou ? 'you' : 'them'}
                large
              />
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

          {isYou ? (
            <section className="card span-2">
              <div className="card-head">
                <h2>Your picture</h2>
                {profile.user.avatar ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void chooseAvatar(null)}
                    disabled={saving}
                  >
                    Use initials
                  </button>
                ) : null}
              </div>

              <div className="avatar-picker">
                {AVATAR_IDS.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className="avatar-option"
                    aria-pressed={profile.user.avatar === id}
                    aria-label={ANIMALS[id].label}
                    disabled={saving}
                    onClick={() => void chooseAvatar(id)}
                  >
                    <Avatar username={profile.user.username} avatar={id} large />
                    <span className="avatar-option-label">{ANIMALS[id].label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card span-2">
            <div className="card-head">
              <h2>Record</h2>
              <span className="small faint">Connect early, close fast</span>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-value is-best">{profile.stats.bestScore ?? '—'}</div>
                <div className="tiny">Best circle</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.firstPlaceFinishes}</div>
                <div className="tiny">1st connections</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.averagePlacement ?? '—'}</div>
                <div className="tiny">Avg placement</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.fastestConnection ?? '—'}</div>
                <div className="tiny">Fastest connect</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.gamesConnected}</div>
                <div className="tiny">Connected</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.gamesPlayed}</div>
                <div className="tiny">Played</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.perfectCircles}</div>
                <div className="tiny">Perfect circles</div>
              </div>
              <div className="stat">
                <div className="stat-value">{profile.stats.wildcards}</div>
                <div className="tiny">Wildcards</div>
              </div>
            </div>
          </section>

          <section className="card span-2">
            <div className="card-head">
              <h2>Closest minds</h2>
              <span className="small faint">People they connect with most</span>
            </div>

            {profile.stats.topPartners.length === 0 ? (
              <div className="empty">
                No connections yet — a placement needs two people who said the same word.
              </div>
            ) : (
              <div className="rows">
                {profile.stats.topPartners.map((partner, index) => (
                  <div className="list-row" key={partner.id}>
                    <div className="row-main">
                      <span className={`rank rank-${index + 1}`}>{index + 1}</span>
                      <Avatar username={partner.username} avatar={partner.avatar} />
                      <div className="row-label">
                        <div className="row-name">
                          <Link to={`/player/${partner.id}`}>@{partner.username}</Link>
                        </div>
                        <div className="small faint">
                          connected {partner.times} {partner.times === 1 ? 'time' : 'times'}
                          {partner.fastest !== null ? ` · fastest round ${partner.fastest}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className="score-chip">{partner.times}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <MadeBy />
    </div>
  );
}
