import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { Brand } from '../components/Brand';
import { MadeBy } from '../components/MadeBy';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { ordinal, placementColor } from '../lib/placement';
import { useSocket, useSocketEvent } from '../lib/socket';
import { useToast } from '../lib/toasts';
import type {
  Friend,
  FriendRequestView,
  GameSummary,
  LeaderboardResponse,
  PlayerStats,
  RoomInvitedPayload,
  RoomInviteView,
  RoomView,
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
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [invites, setInvites] = useState<RoomInviteView[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardSize, setBoardSize] = useState<number | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joining, setJoining] = useState(false);

  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomSize, setNewRoomSize] = useState(8);
  const [creating, setCreating] = useState(false);

  const userId = user?.id;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [friendsData, requestsData, roomsData, invitesData, gamesData, statsData] =
        await Promise.all([
          api.get<{ friends: Friend[] }>('/api/friends'),
          api.get<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>(
            '/api/friends/requests',
          ),
          api.get<{ rooms: RoomView[] }>('/api/rooms/mine'),
          api.get<{ invites: RoomInviteView[] }>('/api/rooms/invites'),
          api.get<{ games: GameSummary[] }>('/api/games/active'),
          api.get<{ stats: PlayerStats }>(`/api/users/${userId}/stats`),
        ]);

      setFriends(friendsData.friends);
      setIncoming(requestsData.incoming);
      setOutgoing(requestsData.outgoing);
      setRooms(roomsData.rooms);
      setInvites(invitesData.invites);
      setGames(gamesData.games);
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

  /**
   * Socket events arrive in bursts — a connection forming fans out to everyone
   * in the room at once. Refetching six endpoints per event meant eight players
   * on one network could generate hundreds of requests in seconds, so changes
   * are coalesced into a single refetch.
   */
  const refreshTimer = useRef<number | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 350);
  }, [refresh]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  useEffect(() => {
    const path = boardSize ? `/api/games/leaderboard?size=${boardSize}` : '/api/games/leaderboard';
    api
      .get<LeaderboardResponse>(path)
      .then(setBoard)
      .catch(() => undefined);
  }, [boardSize]);

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

  useSocketEvent<RoomInvitedPayload>('room:invited', (payload) => {
    toast.show(`@${payload.from.username} invited you to a room`, 'good');
    scheduleRefresh();
  });

  useSocketEvent('rooms:changed', scheduleRefresh);
  useSocketEvent('games:changed', scheduleRefresh);
  useSocketEvent('friend:changed', scheduleRefresh);

  useSocketEvent<{ from: { username: string } }>('friend:request_received', (payload) => {
    toast.show(`@${payload.from.username} sent you a friend request`, 'info');
  });

  useSocketEvent<{ by: { username: string } }>('friend:request_accepted', (payload) => {
    toast.show(`@${payload.by.username} accepted your request`, 'good');
  });

  useSocketEvent<{ userId: string; online: boolean }>('presence:friend', (payload) => {
    setFriends((current) =>
      current.map((friend) =>
        friend.id === payload.userId ? { ...friend, online: payload.online } : friend,
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

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);

    try {
      const data = await api.post<{ room: RoomView }>('/api/rooms', {
        maxPlayers: newRoomSize,
        ...(newRoomName.trim() ? { name: newRoomName.trim() } : {}),
        ...(newRoomPassword.trim() ? { password: newRoomPassword.trim() } : {}),
      });
      navigate(`/room/${data.room.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not create the room', 'bad');
      setCreating(false);
    }
  }

  async function joinByCode(event: FormEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6 || joining) return;

    setJoining(true);
    try {
      const data = await api.post<{ room: RoomView }>('/api/rooms/join', {
        code,
        ...(joinPassword.trim() ? { password: joinPassword.trim() } : {}),
      });
      navigate(`/room/${data.room.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not find that room', 'bad');
    } finally {
      setJoining(false);
    }
  }

  async function acceptInvite(invite: RoomInviteView) {
    try {
      // An invite is the authorisation: no password needed.
      const data = await api.post<{ room: RoomView }>('/api/rooms/join', {
        code: invite.room.code,
      });
      navigate(`/room/${data.room.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not join that room', 'bad');
    }
  }

  async function quickPlay(friendId: string, username: string) {
    try {
      const data = await api.post<{ room: RoomView }>('/api/rooms/quick', { friendId });
      toast.show(`Invited @${username}`, 'good');
      navigate(`/room/${data.room.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not start that game', 'bad');
    }
  }

  const sizes = useMemo(() => board?.availableSizes ?? [], [board]);

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

      {invites.length > 0 ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          {invites.map((invite) => (
            <div className="invite invite-pulse" key={invite.id}>
              <div className="row">
                <Avatar username={invite.from.username} side="them" />
                <div>
                  <strong>@{invite.from.username}</strong> invited you to{' '}
                  {invite.room.name ?? 'a circle'}
                  <div className="small muted">
                    {invite.room.memberCount} / {invite.room.maxPlayers} seats · room{' '}
                    <span className="mono-code">{invite.room.code}</span> ·{' '}
                    {timeAgo(invite.createdAt)}
                  </div>
                </div>
              </div>
              <div className="row">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void act(() => api.post(`/api/rooms/${invite.room.id}/decline`))}
                >
                  Decline
                </button>
                <button className="btn btn-primary" onClick={() => void acceptInvite(invite)}>
                  Join room
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="dash">
        {/* Actions: start or resume a game. */}
        <div className="dash-col">
        {/* ── Play ─────────────────────────────────────────────────────── */}
        <section className="card card-accent-you">
          <div className="card-head">
            <h2>New circle</h2>
            <span className="small faint">2–8 players</span>
          </div>

          <form className="stack" onSubmit={createRoom}>
            <input
              className="input"
              value={newRoomName}
              maxLength={40}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name (optional)"
              aria-label="Room name"
            />
            <input
              className="input"
              type="password"
              value={newRoomPassword}
              maxLength={72}
              onChange={(e) => setNewRoomPassword(e.target.value)}
              placeholder="Password (optional)"
              aria-label="Room password"
            />
            <div className="row spread row-wrap">
              <span className="tiny">Max players</span>
              <div className="segmented">
                {[2, 3, 4, 5, 6, 7, 8].map((size) => (
                  <button
                    type="button"
                    key={size}
                    aria-pressed={newRoomSize === size}
                    onClick={() => setNewRoomSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary btn-block" disabled={creating}>
              {creating ? 'Creating…' : 'Create room'}
            </button>
          </form>

          <form className="row" onSubmit={joinByCode} style={{ marginTop: 14 }}>
            <input
              className="input mono-code"
              value={joinCode}
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              aria-label="Join a room by code"
              style={{ flex: 1 }}
            />
            <input
              className="input"
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="Password"
              aria-label="Room password"
              style={{ flex: 1 }}
            />
            <button className="btn btn-sm" disabled={joinCode.trim().length !== 6 || joining}>
              Join
            </button>
          </form>
        </section>

        {/* ── In progress ──────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>In progress</h2>
            <span className="small faint">{rooms.length + games.length} open</span>
          </div>

          {loading ? (
            <div className="stack">
              <div className="skeleton" />
            </div>
          ) : rooms.length === 0 && games.length === 0 ? (
            <div className="empty">Nothing running. Create a circle or join one.</div>
          ) : (
            <div className="rows">
              {rooms.map((room) => (
                <div className="list-row" key={room.id}>
                  <div className="row-main">
                    <span className="rank">{room.members.length}</span>
                    <div className="row-label">
                      <div className="row-name">{room.name ?? 'Circle'}</div>
                      <div className="small muted">
                        {room.status === 'IN_GAME' ? 'Game running' : 'Waiting in the lobby'} ·{' '}
                        <span className="mono-code">{room.code}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      navigate(
                        room.activeGameId ? `/game/${room.activeGameId}` : `/room/${room.id}`,
                      )
                    }
                  >
                    {room.activeGameId ? 'Rejoin' : 'Open'}
                  </button>
                </div>
              ))}

              {games
                .filter((game) => !rooms.some((room) => room.activeGameId === game.id))
                .map((game) => (
                  <div className="list-row" key={game.id}>
                    <div className="row-main">
                      <span className="rank">{game.playerCount}</span>
                      <div className="row-label">
                        <div className="row-name">Round {game.currentRound}</div>
                        <div className="small muted">
                          <span className="mono-code">{game.roomCode}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate(`/game/${game.id}`)}
                    >
                      Rejoin
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>
        </div>

        {/* People: who you can play with, and who wants to. */}
        <div className="dash-col">
        {/* ── Friends ──────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Friends</h2>
            <span className="small faint">{friends.filter((f) => f.online).length} online</span>
          </div>

          {loading ? (
            <div className="skeleton" />
          ) : friends.length === 0 ? (
            <div className="empty">
              No friends yet — but you do not need any. Anyone can join your room.
            </div>
          ) : (
            <div className="rows rows-scroll">
              {friends.map((friend) => (
                <div className="list-row" key={friend.id}>
                  <div className="row-main">
                    <Avatar username={friend.username} avatar={friend.avatar} />
                    <div className="row-label">
                      <div className="row-name row">
                        <OnlineDot online={friend.online} />
                        <Link to={`/player/${friend.id}`}>@{friend.username}</Link>
                      </div>
                      <div className="small faint">
                        {friend.online ? 'Online now' : `Friends ${timeAgo(friend.friendsSince)}`}
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
                    >
                      Remove
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void quickPlay(friend.id, friend.username)}
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

          <div className="rows rows-scroll" style={{ marginTop: 8 }}>
            {searching ? <div className="empty">Searching…</div> : null}
            {!searching && query.trim() && results.length === 0 ? (
              <div className="empty">Nobody matches “{query.trim()}”.</div>
            ) : null}

            {results.map((result) => (
              <div className="list-row" key={result.id}>
                <div className="row-main">
                  <Avatar username={result.username} avatar={result.avatar} />
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
                      <Avatar username={request.user.username} avatar={request.user.avatar} />
                      <div className="row-label">
                        <div className="row-name">@{request.user.username}</div>
                        <div className="small faint">{timeAgo(request.createdAt)}</div>
                      </div>
                    </div>
                    <div className="list-row-actions">
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() =>
                          void act(() => api.post(`/api/friends/requests/${request.id}/reject`))
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
                      <Avatar username={request.user.username} avatar={request.user.avatar} />
                      <div className="row-label">
                        <div className="row-name">@{request.user.username}</div>
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
        </div>

        {/* You: your record, and the rules if you are new. */}
        <div className="dash-col dash-col-info">
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
                <div className="tiny">Best circle</div>
              </div>
              <div className="stat">
                <div
                  className="stat-value"
                  style={{ color: stats.firstPlaceFinishes ? placementColor(1) : undefined }}
                >
                  {stats.firstPlaceFinishes}
                </div>
                <div className="tiny">1st connections</div>
              </div>
              <div className="stat">
                <div className="stat-value">{stats.gamesPlayed}</div>
                <div className="tiny">Played</div>
              </div>
            </div>
          ) : (
            <div className="skeleton" />
          )}

          {stats && stats.averagePlacement !== null ? (
            <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
              You usually connect {ordinal(Math.round(stats.averagePlacement))}.
            </p>
          ) : null}
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>How it works</h2>
          </div>
          <div className="how">
            <div className="how-step">
              <span>
                2–8 players. Everyone types one word in 15 seconds, blind. All words reveal at once.
              </span>
            </div>
            <div className="how-step">
              <span>
                Say the same word as anyone else and you <strong>connect</strong> — you leave the
                circle together as Connection #1, then #2, and so on.
              </span>
            </div>
            <div className="how-step">
              <span>
                A word played once can never be played again, so you have to find a new middle
                every round.
              </span>
            </div>
            <div className="how-step">
              <span>
                Play until everyone is connected or one player is left alone.{' '}
                <strong>Fewer rounds is better</strong> — and nobody left over is a perfect circle.
              </span>
            </div>
          </div>
        </section>
      </div>
      </div>

      {/* Full width: the leaderboard is a wide list and reads badly in a column. */}
      <div className="dash-wide">
        {/* ── Leaderboard ──────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Fastest circles</h2>
            <div className="segmented">
              <button aria-pressed={boardSize === null} onClick={() => setBoardSize(null)}>
                All
              </button>
              {sizes.map((size) => (
                <button
                  key={size.playerCount}
                  aria-pressed={boardSize === size.playerCount}
                  onClick={() => setBoardSize(size.playerCount)}
                >
                  {size.playerCount}p
                </button>
              ))}
            </div>
          </div>

          {!board || board.leaderboard.length === 0 ? (
            <div className="empty">
              No circle has closed yet. A score of 1 is the brag.
            </div>
          ) : (
            <div className="rows">
              {board.leaderboard.map((entry) => (
                <div className="list-row" key={entry.groupKey}>
                  <div className="row-main">
                    <span className={`rank rank-${entry.rank}`}>{entry.rank}</span>
                    <div className="row-label">
                      <div className="row-name">
                        {entry.players.map((player, index) => (
                          <span key={player.id}>
                            {index > 0 ? <span className="faint"> · </span> : null}
                            <Link to={`/player/${player.id}`}>@{player.username}</Link>
                          </span>
                        ))}
                      </div>
                      <div className="small faint">
                        {entry.playerCount} players
                        {entry.games > 1 ? ` · best of ${entry.games}` : ''}
                        {entry.perfectCircle ? ' · perfect circle' : ''}
                        {entry.endedAt ? ` · ${timeAgo(entry.endedAt)}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="score-chip">{entry.finalScore}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <MadeBy />
    </div>
  );
}
