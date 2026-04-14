import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { IncomingRequest, LeaderboardEntry, OutgoingRequest, User } from '../types';

type Props = {
  user: User;
  onLogout: () => void;
};

type FriendsResponse = { friends: User[] };
type RequestsResponse = { incoming: IncomingRequest[]; outgoing: OutgoingRequest[] };
type SearchResponse = { users: User[] };
type LeaderboardResponse = { leaderboard: LeaderboardEntry[] };
type GameCreateResponse = { game: { id: string } };

export default function DashboardPage({ user, onLogout }: Props) {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<RequestsResponse>({ incoming: [], outgoing: [] });
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);

  async function refreshAll() {
    const [friendsData, requestsData, leaderboardData] = await Promise.all([
      api<FriendsResponse>('/api/friends'),
      api<RequestsResponse>('/api/friends/requests'),
      api<LeaderboardResponse>('/api/leaderboard'),
    ]);

    setFriends(friendsData.friends);
    setRequests(requestsData);
    setLeaderboard(leaderboardData.leaderboard);
  }

  useEffect(() => {
    refreshAll().catch((err) => {
      setMessage(err instanceof Error ? err.message : 'Failed to load dashboard');
    });
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }

    const id = window.setTimeout(async () => {
      try {
        setLoadingSearch(true);
        const data = await api<SearchResponse>(`/api/users/search?q=${encodeURIComponent(search)}`);
        setSearchResults(data.users);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoadingSearch(false);
      }
    }, 300);

    return () => window.clearTimeout(id);
  }, [search]);

  async function sendFriendRequest(toUserId: string) {
    try {
      await api('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ toUserId }),
      });
      setMessage('Friend request sent.');
      await refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to send friend request');
    }
  }

  async function acceptRequest(requestId: string) {
    try {
      await api(`/api/friends/request/${requestId}/accept`, {
        method: 'POST',
      });
      setMessage('Friend request accepted.');
      await refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to accept request');
    }
  }

  async function createGame(friendId: string) {
    try {
      const data = await api<GameCreateResponse>('/api/games', {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      });
      window.location.href = `/game/${data.game.id}`;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create game');
    }
  }

  const searchableResults = useMemo(() => {
    const friendIds = new Set(friends.map((friend) => friend.id));
    const outgoingIds = new Set(requests.outgoing.map((request) => request.toUserId));

    return searchResults.map((result) => ({
      ...result,
      isFriend: friendIds.has(result.id),
      requestPending: outgoingIds.has(result.id),
    }));
  }, [friends, requests.outgoing, searchResults]);

  return (
    <div className="page-shell">
      <div className="topbar">
        <div>
          <h1>connect.io</h1>
          <p className="muted">Logged in as @{user.username}</p>
        </div>
        <button className="ghost-btn" onClick={onLogout}>
          Logout
        </button>
      </div>

      {message ? <div className="notice">{message}</div> : null}

      <div className="dashboard-grid">
        <section className="card">
          <h2>Find people</h2>
          <input
            placeholder="Search username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="list">
            {loadingSearch ? <div className="muted">Searching...</div> : null}
            {!loadingSearch && searchableResults.length === 0 && search ? (
              <div className="muted">No users found.</div>
            ) : null}
            {searchableResults.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>@{item.username}</strong>
                  <div className="muted small">{item.email}</div>
                </div>
                {item.isFriend ? (
                  <span className="pill">Friend</span>
                ) : item.requestPending ? (
                  <span className="pill">Pending</span>
                ) : (
                  <button className="primary-btn small-btn" onClick={() => sendFriendRequest(item.id)}>
                    Add friend
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Incoming requests</h2>
          <div className="list">
            {requests.incoming.length === 0 ? <div className="muted">No incoming requests.</div> : null}
            {requests.incoming.map((request) => (
              <div className="list-row" key={request.id}>
                <div>
                  <strong>@{request.fromUser.username}</strong>
                  <div className="muted small">sent a friend request</div>
                </div>
                <button className="primary-btn small-btn" onClick={() => acceptRequest(request.id)}>
                  Accept
                </button>
              </div>
            ))}
          </div>

          <h3 className="subheading">Outgoing</h3>
          <div className="list">
            {requests.outgoing.length === 0 ? <div className="muted">No outgoing requests.</div> : null}
            {requests.outgoing.map((request) => (
              <div className="list-row" key={request.id}>
                <div>
                  <strong>@{request.toUser.username}</strong>
                </div>
                <span className="pill">Pending</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Friends</h2>
          <div className="list">
            {friends.length === 0 ? <div className="muted">You have no friends yet.</div> : null}
            {friends.map((friend) => (
              <div className="list-row" key={friend.id}>
                <div>
                  <strong>@{friend.username}</strong>
                  <div className="muted small">{friend.email}</div>
                </div>
                <button className="primary-btn small-btn" onClick={() => createGame(friend.id)}>
                  Start game
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Leaderboard</h2>
          <div className="list">
            {leaderboard.length === 0 ? <div className="muted">No finished games yet.</div> : null}
            {leaderboard.map((entry, index) => (
              <div className="list-row" key={entry.id}>
                <div>
                  <strong>#{index + 1}</strong> {entry.players.join(' + ')}
                  <div className="muted small">Room {entry.roomCode}</div>
                </div>
                <span className="score-badge">Score {entry.finalScore}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="footnote">
        Open the same app in a second browser or incognito window to simulate the other player.
      </div>
    </div>
  );
}
