import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, OnlineDot } from '../components/Avatar';
import { Brand } from '../components/Brand';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSocket, useSocketEvent } from '../lib/socket';
import { useToast } from '../lib/toasts';
import type { Friend, RoomGameStartedPayload, RoomView, SearchResult } from '../lib/types';

type InviteTab = 'friends' | 'search';

/** Presets the host picks from; the server accepts anything from 5s to 2min. */
const ROUND_SECONDS = [10, 15, 20, 30, 45, 60];

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();

  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const [tab, setTab] = useState<InviteTab>('friends');
  const [savingSettings, setSavingSettings] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await api.get<{ room: RoomView }>(`/api/rooms/${roomId}`);
      setRoom(data.room);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open this room');
    }
  }, [roomId]);

  useEffect(() => {
    void load();
    api
      .get<{ friends: Friend[] }>('/api/friends')
      .then((data) => setFriends(data.friends))
      .catch(() => undefined);
  }, [load]);

  // Subscribe to lobby broadcasts for as long as we are on this page.
  useEffect(() => {
    if (!socket || !roomId) return;
    const join = () => socket.emit('room:join', { id: roomId });
    if (socket.connected) join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
      socket.emit('room:leave', { id: roomId });
    };
  }, [socket, roomId]);

  useSocketEvent<RoomView>('room:state', (payload) => {
    if (payload.id !== roomId) return;
    setRoom(payload);
  });

  useSocketEvent<{ roomId: string }>('room:changed', (payload) => {
    if (payload.roomId === roomId) void load();
  });

  useSocketEvent<RoomGameStartedPayload>('room:game_started', (payload) => {
    if (payload.roomId !== roomId) return;
    navigate(`/game/${payload.gameId}`, { replace: true });
  });

  useSocketEvent<{ roomId: string }>('room:kicked', (payload) => {
    if (payload.roomId !== roomId) return;
    toast.show('The host removed you from the room', 'bad');
    navigate('/', { replace: true });
  });

  useSocketEvent<{ roomId: string }>('room:closed', (payload) => {
    if (payload.roomId !== roomId) return;
    navigate('/', { replace: true });
  });

  // Debounced global search — anyone can be invited, friend or not.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      api
        .get<{ users: SearchResult[] }>(`/api/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => setResults(data.users))
        .catch(() => setResults([]));
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function invite(userId: string, username: string) {
    if (!roomId) return;
    try {
      await api.post(`/api/rooms/${roomId}/invite`, { userId });
      setInvited((current) => new Set(current).add(userId));
      toast.show(`Invited @${username}`, 'good');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not invite them', 'bad');
    }
  }

  /** Host-only. Longer rounds suit bigger rooms: eight people take longer to
   *  read what the group just said than two do. */
  async function setRoundSeconds(seconds: number) {
    if (!roomId || savingSettings) return;
    setSavingSettings(true);
    try {
      const data = await api.post<{ room: RoomView }>(`/api/rooms/${roomId}/settings`, {
        roundDurationMs: seconds * 1000,
      });
      setRoom(data.room);
      toast.show(`Rounds are now ${seconds} seconds`, 'good');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not change the timer', 'bad');
    } finally {
      setSavingSettings(false);
    }
  }

  async function start() {
    if (!roomId || starting) return;
    setStarting(true);
    try {
      const data = await api.post<{ gameId: string }>(`/api/rooms/${roomId}/start`);
      navigate(`/game/${data.gameId}`, { replace: true });
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not start the game', 'bad');
      setStarting(false);
    }
  }

  async function leave() {
    if (!roomId) return;
    try {
      await api.post(`/api/rooms/${roomId}/leave`);
    } catch {
      // Leaving is best-effort; the dashboard is the right place either way.
    }
    navigate('/', { replace: true });
  }

  function copyCode() {
    if (!room) return;
    void navigator.clipboard
      ?.writeText(room.code)
      .then(() => toast.show('Room code copied', 'good'))
      .catch(() => toast.show(`Room code: ${room.code}`, 'info'));
  }

  const memberIds = useMemo(
    () => new Set(room?.members.map((member) => member.id) ?? []),
    [room],
  );

  if (error) {
    return (
      <div className="shell">
        <header className="topbar">
          <Brand />
          <Link className="btn btn-ghost btn-sm" to="/">
            Back to dashboard
          </Link>
        </header>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Cannot open this room</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!room || !user) {
    return (
      <div className="shell">
        <header className="topbar">
          <Brand />
        </header>
        <div className="card stack">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  const emptySlots = Math.max(0, room.maxPlayers - room.members.length);
  const canStart = room.youAreHost && room.members.length >= 2;

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          {room.hasPassword ? <span className="pill">🔒 private</span> : null}
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void leave()}>
            Leave room
          </button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="card">
          <div className="card-head">
            <h2>{room.name ?? 'The circle'}</h2>
            <span className="small faint">
              {room.members.length} / {room.maxPlayers}
            </span>
          </div>

          <div className="seat-slots">
            {room.members.map((member) => (
              <div className="seat-slot" key={member.id}>
                <Avatar
                  username={member.username}
                  avatar={member.avatar}
                  side={member.isYou ? 'you' : 'them'}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="seat-slot-name">
                    {member.isYou ? 'you' : `@${member.username}`}
                  </div>
                  <div className="row small faint" style={{ gap: 5 }}>
                    <OnlineDot online={member.online} />
                    {member.isHost ? 'host' : member.online ? 'ready' : 'away'}
                  </div>
                </div>
                {room.youAreHost && !member.isYou ? (
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    title={`Remove @${member.username}`}
                    onClick={() =>
                      void api
                        .del(`/api/rooms/${room.id}/members/${member.id}`)
                        .then(() => load())
                        .catch(() => toast.show('Could not remove them', 'bad'))
                    }
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}

            {Array.from({ length: emptySlots }, (_, index) => (
              <div className="seat-slot seat-slot-empty" key={`empty-${index}`}>
                open seat
              </div>
            ))}
          </div>

          <div className="row spread row-wrap" style={{ marginTop: 18, gap: 10 }}>
            <span className="tiny">Seconds per round</span>
            {room.youAreHost ? (
              <div className="segmented">
                {ROUND_SECONDS.map((seconds) => (
                  <button
                    type="button"
                    key={seconds}
                    aria-pressed={Math.round(room.roundDurationMs / 1000) === seconds}
                    disabled={savingSettings}
                    onClick={() => void setRoundSeconds(seconds)}
                  >
                    {seconds}
                  </button>
                ))}
              </div>
            ) : (
              <span className="pill">{Math.round(room.roundDurationMs / 1000)}s</span>
            )}
          </div>

          <div className="stack" style={{ marginTop: 14 }}>
            {room.youAreHost ? (
              <>
                <button
                  className="btn btn-primary btn-lg btn-block"
                  onClick={() => void start()}
                  disabled={!canStart || starting}
                >
                  {starting
                    ? 'Starting…'
                    : canStart
                      ? `Start with ${room.members.length}`
                      : 'Waiting for one more player'}
                </button>
                <p className="small faint" style={{ textAlign: 'center', margin: 0 }}>
                  Only you can start. Everyone needs the room open when you do.
                </p>
              </>
            ) : (
              <div className="empty">Waiting for the host to start…</div>
            )}
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Room code</h2>
            </div>
            <button className="room-code-big" onClick={copyCode} title="Copy room code">
              {room.code}
            </button>
            <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
              {room.hasPassword
                ? 'Anyone with the code and password can join. People you invite skip the password.'
                : 'Anyone with this code can join.'}
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Invite</h2>
              <div className="segmented">
                <button aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>
                  Friends
                </button>
                <button aria-pressed={tab === 'search'} onClick={() => setTab('search')}>
                  Search
                </button>
              </div>
            </div>

            {tab === 'search' ? (
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everyone by username"
                aria-label="Search all players"
                style={{ marginBottom: 8 }}
              />
            ) : null}

            <div className="rows rows-scroll">
              {(tab === 'friends' ? friends : results).map((person) => {
                const already = memberIds.has(person.id);
                const sent = invited.has(person.id);
                return (
                  <div className="list-row" key={person.id}>
                    <div className="row-main">
                      <Avatar username={person.username} avatar={person.avatar} />
                      <div className="row-label">
                        <div className="row-name row">
                          <OnlineDot online={person.online} />
                          @{person.username}
                        </div>
                      </div>
                    </div>
                    {already ? (
                      <span className="pill pill-match">In room</span>
                    ) : sent ? (
                      <span className="pill">Invited</span>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => void invite(person.id, person.username)}
                      >
                        Invite
                      </button>
                    )}
                  </div>
                );
              })}

              {tab === 'friends' && friends.length === 0 ? (
                <div className="empty">
                  No friends yet — use Search to invite anyone by username.
                </div>
              ) : null}
              {tab === 'search' && query.trim() && results.length === 0 ? (
                <div className="empty">Nobody matches “{query.trim()}”.</div>
              ) : null}
              {tab === 'search' && !query.trim() ? (
                <div className="empty">
                  Search for anyone — you do not have to be friends to play.
                </div>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>How it works</h2>
            </div>
            <div className="how">
              <div className="how-step">
                <span>Everyone types one word, blind. All words reveal at once.</span>
              </div>
              <div className="how-step">
                <span>
                  Match anyone else and you <strong>connect</strong> — you leave together as
                  Connection #1, #2, and so on.
                </span>
              </div>
              <div className="how-step">
                <span>A word played once can never be played again. Find a new middle.</span>
              </div>
              <div className="how-step">
                <span>
                  Play until everyone is connected, or one player is left alone.{' '}
                  <strong>Fewer rounds is better.</strong>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
