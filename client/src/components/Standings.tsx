import { placementColor } from '../lib/placement';
import type { ConnectionView, PlayerView } from '../lib/types';

/** Connections so far, in the order they left the circle. */
export function Standings({
  connections,
  players,
}: {
  connections: ConnectionView[];
  players: { id: string; username: string; isYou?: boolean }[] | PlayerView[];
}) {
  if (connections.length === 0) {
    return <div className="empty">Nobody has connected yet.</div>;
  }

  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    if (!player) return 'player';
    return 'isYou' in player && player.isYou ? 'you' : player.username;
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {connections.map((connection) => {
        const color = placementColor(connection.placement);
        return (
          <div
            className="standing"
            key={connection.placement}
            style={{ borderLeftColor: color }}
          >
            <span className="placement" style={{ background: color }}>
              {connection.placement}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="standing-word" style={{ color }}>
                {connection.word}
              </div>
              <div className="standing-members">
                {connection.memberIds.map(nameOf).join(' · ')}
              </div>
            </div>
            <span className="pill">R{connection.roundNumber}</span>
          </div>
        );
      })}
    </div>
  );
}
