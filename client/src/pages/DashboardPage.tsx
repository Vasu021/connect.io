import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { Brand } from '../components/Brand';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { useSocket, useSocketEvent } from '../lib/socket';
import { useToast } from '../lib/toasts';
import type {
  Friend,
  FriendRequestView,
  GameSummary,
  InvitePayload,
  LeaderboardEntry,
  PlayerStats,
  SearchResult,
} from '../lib/types';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const toast = useToast();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestView[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestView[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [roomCode, setRoomCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [freshInvites, setFreshInvites] = useState<Set<string>>(new Set());

  const userId = user?.id;

  const refresh = useCallback(async () => {
    if (!userId) return;

    try {
      const [friendsData, requestsData, gamesData, boardData, statsData] = await Promise.all([
        api.get<{ friends: Friend[] }>('/api/friends'),
        api.get<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>(
          '/api/friends/requests',
        ),
        api.get<{ games: GameSummary[] }>('/api/games/active'),
        api.get<{ leaderboard: LeaderboardEntry[] }>('/api/games/leaderboard'),
        api.get<{ stats: PlayerStats }>(`/api/users/${userId}/stats`),
      ]);

      setFriends(friendsData.friends);
      setIncoming(requestsData.incoming);
      setOutgoing(requestsData.outgoing);
      setGames(gamesData.games);
      setLeaderboard(boardData.leaderboard);
      setStats(statsData.stats);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not load your dashboard', 'bad');
    } finally {
      setLoading(false);
    }
  }, [toast, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Debounced search so typing does not hammer the endpoint.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ users: SearchResult[] }>(`/api/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => setResults(data.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query]);

  /* ── Live updates ─────────────────────────────────────────────────────── */

  const searchRef = useRef(query);
  searchRef.current = query;

  useSocketEvent<InvitePayload>('game:invited', (payload) => {
    toast.show(`@${payload.from.username} wants to play`, 'good');
    setFreshInvites((current) => new Set(current).add(payload.gameId));
    void refresh();
  });

  useSocketEvent('games:changed', () => void refresh());
  useSocketEvent('friend:changed', () => void refresh());

  useSocketEvent<{ from: { username: string } }>('friend:request_received', (payload) => {
    toast.show(`@${payload.from.username} sent you a friend request`, 'info');
  });

  useSocketEvent<{ by: { username: string } }>('friend:request_accepted', (payload) => {
    toast.show(`@${payload.by.username} accepted your request`, 'good');
  });

  // Presence is high-frequency, so patch it in place instead of refetching.
  useSocketEvent<{ userId: string; online: boolean }>('presence:friend', (payload) => {
    setFriends((current) =>
      current.map((friend) =>
        friend.id === payload.userId ? { ...friend, online: payload.online } : friend,
      ),
    );
    setGames((current) =>
      current.map((game) =>
        game.opponent.id === payload.userId
          ? { ...game, opponent: { ...game.opponent, online: payload.online } }
          : game,
      ),
    );
  });

  /* ── Actions ──────────────────────────────────────────────────────────── */

  async function act(work: () => Promise<unknown>, success?: string) {
    try {
      await work();
      if (success) toast.show(success, 'good');
      await refresh();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'That did not work', 'bad');
    }
  }

  async function startGame(friendId: string, username: string) {
    try {
      const data = await api.post<{ game: { id: string }; reused: boolean }>('/api/games', {
        friendId,
      });
      if (data.reused) toast.show(`Re-opening your room with @${username}`, 'info');
      navigate(`/game/${data.game.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not start that game', 'bad');
    }
  }

  async function joinByCode(event: FormEvent) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code.length !== 6 || joining) return;

    setJoining(true);
    try {
      const data = await api.post<{ gameId: string }>('/api/games/join', { roomCode: code });
      navigate(`/game/${data.gameId}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not find that room', 'bad');
    } finally {
      setJoining(false);
    }
  }

  const pendingInvites = useMemo(
    () => games.filter((game) => game.status === 'WAITING' && !game.youInvited),
    [games],
  );

  if (!user) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="pill">
            <OnlineDot online={connected} label={connected ? 'Connected' : 'Reconnecting'} />
            {connected ? 'live' : 'reconnecting'}
          </span>
          <Link className="btn btn-ghost btn-sm" to="/history">
            History
          </Link>
          <Link className="btn btn-ghost btn-sm" to={`/player/${user.id}`}>
            @{user.username}
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      {pendingInvites.length > 0 ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          {pendingInvites.map((game) => (
            <div
              key={game.id}
              className={`invite${freshInvites.has(game.id) ? ' invite-pulse' : ''}`}
            >
              <div className="row">
                <Avatar username={game.opponent.username} side="them" />
                <div>
                  <strong>@{game.opponent.username}</strong> invited you to connect
                  <div className="small muted">
                    Room <span className="mono-code">{game.roomCode}</span> ·{' '}
                    {timeAgo(game.createdAt)}
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => navigate(`/game/${game.id}`)}>
                Join game
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="dashboard-grid">
        {/* ── Your games ───────────────────────────────────────────────── */}
        <section className="card card-accent-you">
          <div className="card-head">
            <h2>Your games</h2>
            <span className="small faint">{games.length} open</span>
          </div>

          {loading ? (
            <div className="stack">
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : games.length === 0 ? (
            <div className="empty">
              No games open. Pick a friend below and start one.
            </div>
          ) : (
            <div className="rows">
              {games.map((game) => (
                <div className="list-row" key={game.id}>
                  <div className="row-main">
                    <Avatar username={game.opponent.username} side="them" />
                    <div className="row-label">
                      <div className="row-name">@{game.opponent.username}</div>
                      <div className="small muted">
                        {game.status === 'ACTIVE'
                          ? `Round ${game.currentRound} in progress`
                          : game.youInvited
                            ? 'Waiting for them to join'
                            : 'Waiting for you'}
                      </div>
                    </div>
                  </div>
                  <div className="list-row-actions">
                    {game.status === 'ACTIVE' ? (
                      <span className="pill pill-live">
                        <OnlineDot online />
                        live
                      </span>
                    ) : null}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate(`/game/${game.id}`)}
                    >
                      {game.status === 'ACTIVE' ? 'Resume' : 'Open'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="row" onSubmit={joinByCode} style={{ marginTop: 14 }}>
            <input
              className="input mono-code"
              value={roomCode}
              maxLength={6}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              aria-label="Join a room by code"
            />
            <button className="btn btn-sm" disabled={roomCode.trim().length !== 6 || joining}>
              Join
            </button>
          </form>
        </section>

        {/* ── Friends ──────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Friends</h2>
            <span className="small faint">
              {friends.filter((f) => f.online).length} online
            </span>
          </div>

          {loading ? (
            <div className="stack">
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : friends.length === 0 ? (
            <div className="empty">
              No friends yet. Search for someone and send a request.
            </div>
          ) : (
            <div className="rows">
              {friends.map((friend) => (
                <div className="list-row" key={friend.id}>
                  <div className="row-main">
                    <Avatar username={friend.username} />
                    <div className="row-label">
                      <div className="row-name row">
                        <OnlineDot online={friend.online} />
                        <Link to={`/player/${friend.id}`}>@{friend.username}</Link>
                      </div>
                      <div className="small faint">
                        {friend.online ? 'Online now' : `Friends since ${timeAgo(friend.friendsSince)}`}
                      </div>
                    </div>
                  </div>
                  <div className="list-row-actions">
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() =>
                        void act(
                          () => api.del(`/api/friends/${friend.id}`),
                          `Removed @${friend.username}`,
                        )
                      }
                      title={`Remove @${friend.username}`}
                    >
                      Remove
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void startGame(friend.id, friend.username)}
                    >
                      Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Find people ──────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Find people</h2>
          </div>

          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username"
            aria-label="Search for players"
          />

          <div className="rows" style={{ marginTop: 8 }}>
            {searching ? <div className="empty">Searching…</div> : null}
            {!searching && query.trim() && results.length === 0 ? (
              <div className="empty">Nobody matches “{query.trim()}”.</div>
            ) : null}

            {results.map((result) => (
              <div className="list-row" key={result.id}>
                <div className="row-main">
                  <Avatar username={result.username} />
                  <div className="row-label">
                    <div className="row-name row">
                      <OnlineDot online={result.online} />
                      <Link to={`/player/${result.id}`}>@{result.username}</Link>
                    </div>
                  </div>
                </div>

                {result.relationship === 'friend' ? (
                  <span className="pill pill-match">Friend</span>
                ) : result.relationship === 'request_sent' ? (
                  <span className="pill">Requested</span>
                ) : result.relationship === 'request_received' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      void act(
                        () => api.post(`/api/friends/requests/${result.requestId}/accept`),
                        `You and @${result.username} are now friends`,
                      )
                    }
                  >
                    Accept
                  </button>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void act(
                        () => api.post('/api/friends/request', { toUserId: result.id }),
                        `Request sent to @${result.username}`,
                      )
                    }
                  >
                    Add friend
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Requests ─────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Requests</h2>
            {incoming.length > 0 ? (
              <span className="pill pill-you">{incoming.length} waiting</span>
            ) : null}
          </div>

          {incoming.length === 0 && outgoing.length === 0 ? (
            <div className="empty">No pending requests.</div>
          ) : null}

          {incoming.length > 0 ? (
            <>
              <div className="tiny" style={{ marginBottom: 6 }}>
                Incoming
              </div>
              <div className="rows">
                {incoming.map((request) => (
                  <div className="list-row" key={request.id}>
                    <div className="row-main">
                      <Avatar username={request.user.username} />
                      <div className="row-label">
                        <div className="row-name">@{request.user.username}</div>
                        <div className="small faint">{timeAgo(request.createdAt)}</div>
                      </div>
                    </div>
                    <div className="list-row-actions">
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() =>
                          void act(() =>
                            api.post(`/api/friends/requests/${request.id}/reject`),
                          )
                        }
                      >
                        Ignore
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() =>
                          void act(
                            () => api.post(`/api/friends/requests/${request.id}/accept`),
                            `You and @${request.user.username} are now friends`,
                          )
                        }
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {outgoing.length > 0 ? (
            <>
              <div className="tiny" style={{ margin: '14px 0 6px' }}>
                Sent
              </div>
              <div className="rows">
                {outgoing.map((request) => (
                  <div className="list-row" key={request.id}>
                    <div className="row-main">
                      <Avatar username={request.user.username} />
                      <div className="row-label">
                        <div className="row-name">@{request.user.username}</div>
                        <div className="small faint">{timeAgo(request.createdAt)}</div>
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void act(() => api.del(`/api/friends/requests/${request.id}`))}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {/* ── Leaderboard ──────────────────────────────────────────────── */}
        <section className="card span-2">
          <div className="card-head">
            <h2>Closest pairs</h2>
            <span className="small faint">Lower is better</span>
          </div>

          {leaderboard.length === 0 ? (
            <div className="empty">
              No pair has connected yet. Be the first — a score of 1 is the brag.
            </div>
          ) : (
            <div className="rows">
              {leaderboard.map((entry) => (
                <div className="list-row" key={entry.pairKey}>
                  <div className="row-main">
                    <span className={`rank rank-${entry.rank}`}>{entry.rank}</span>
                    <div className="row-label">
                      <div className="row-name">
                        {entry.players.map((player, index) => (
                          <span key={player.id}>
                            {index > 0 ? <span className="faint"> + </span> : null}
                            <Link to={`/player/${player.id}`}>@{player.username}</Link>
                          </span>
                        ))}
                      </div>
                      <div className="small faint">
                        {entry.games} {entry.games === 1 ? 'game' : 'games'}
                        {entry.lastPlayed ? ` · ${timeAgo(entry.lastPlayed)}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="score-chip">{entry.bestScore}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Your record ──────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Your record</h2>
            <Link className="small" to={`/player/${user.id}`}>
              Details
            </Link>
          </div>

          {stats ? (
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-value is-best">{stats.bestScore ?? '—'}</div>
                <div className="tiny">Best score</div>
              </div>
              <div className="stat">
                <div className="stat-value">{stats.gamesMatched}</div>
                <div className="tiny">Connected</div>
              </div>
              <div className="stat">
                <div className="stat-value">{stats.gamesPlayed}</div>
                <div className="tiny">Played</div>
              </div>
            </div>
          ) : (
            <div className="skeleton" />
          )}
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="card span-2">
          <div className="card-head">
            <h2>How it works</h2>
          </div>
          <div className="how">
            <div className="how-step">
              <span>Both of you get 15 seconds to type one word — submitted blind.</span>
            </div>
            <div className="how-step">
              <span>The words reveal at the same time. Same word? The game ends.</span>
            </div>
            <div className="how-step">
              <span>
                Your score is the round you landed on. <strong>Lower is better.</strong>
              </span>
            </div>
            <div className="how-step">
              <span>There is no winner between you — you are both playing against the gap.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
