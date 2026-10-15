import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { placementColor, seatPosition } from '../lib/placement';
import type { ConnectionView, PlayerView } from '../lib/types';

/** Players still in the circle sit further out than the ones who have left it. */
const RADIUS_ACTIVE = 40;
const RADIUS_CONNECTED = 26;
/** Where a connection's chords meet. */
const RADIUS_HUB = 15;

type Props = {
  players: PlayerView[];
  connections: ConnectionView[];
  /** Words to show beside each seat: this round's reveal, or the last round's. */
  revealed?: Map<string, { word: string; matched: boolean }>;
  /**
   * True when `revealed` holds the *previous* round rather than a live reveal.
   * Those words stay on the circle while everyone thinks, so you can see what
   * the group said last time instead of having to memorise it in 3 seconds.
   */
  wordsArePrevious?: boolean;
  wildcardId?: string | null;
  children?: ReactNode;
};

export function Circle({
  players,
  connections,
  revealed,
  wordsArePrevious = false,
  wildcardId,
  children,
}: Props) {
  const total = players.length;

  const positionOf = (player: PlayerView) => {
    const radius = player.status === 'CONNECTED' ? RADIUS_CONNECTED : RADIUS_ACTIVE;
    return seatPosition(player.seat, total, radius);
  };

  // Each connection meets at its own hub so several groups stay legible rather
  // than collapsing into one starburst at the centre.
  const hubs = connections.map((connection, index) => {
    const seats = connection.memberIds
      .map((id) => players.find((player) => player.id === id)?.seat)
      .filter((seat): seat is number => seat !== undefined);

    // Average the members' angles via unit vectors, so a group spanning the
    // 12 o'clock wrap-around still meets between its members, not opposite them.
    const vector = seats.reduce(
      (acc, seat) => {
        const angle = (seat / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
        return { x: acc.x + Math.cos(angle), y: acc.y + Math.sin(angle) };
      },
      { x: 0, y: 0 },
    );

    const length = Math.hypot(vector.x, vector.y) || 1;
    const spread = connections.length > 1 ? RADIUS_HUB : RADIUS_HUB * 0.45;

    return {
      connection,
      color: placementColor(connection.placement),
      x: 50 + (vector.x / length) * spread,
      y: 50 + (vector.y / length) * spread,
      key: `${connection.placement}-${index}`,
    };
  });

  return (
    <div className="circle-wrap">
      <svg className="circle-rings" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="circle-ring-outer" cx="50" cy="50" r={RADIUS_ACTIVE} />
        <circle className="circle-ring-inner" cx="50" cy="50" r={RADIUS_CONNECTED} />

        {hubs.map((hub) =>
          hub.connection.memberIds.map((memberId) => {
            const player = players.find((candidate) => candidate.id === memberId);
            if (!player) return null;
            const point = positionOf(player);
            return (
              <line
                key={`${hub.key}-${memberId}`}
                className="chord"
                x1={point.x}
                y1={point.y}
                x2={hub.x}
                y2={hub.y}
                stroke={hub.color}
              />
            );
          }),
        )}

        {hubs.map((hub) => (
          <circle
            key={`hub-${hub.key}`}
            className="chord-hub"
            cx={hub.x}
            cy={hub.y}
            r="1.9"
            fill={hub.color}
          />
        ))}
      </svg>

      {players.map((player) => {
        const point = positionOf(player);
        const word = revealed?.get(player.id);
        const color = placementColor(player.placement);
        const isWildcard = wildcardId === player.id;

        const classes = [
          'seat',
          player.isYou ? 'seat-you' : '',
          player.status === 'CONNECTED' ? 'seat-connected' : '',
          player.status === 'LEFT' ? 'seat-left' : '',
          isWildcard ? 'seat-wildcard' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={player.id}
            className={classes}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <span className="seat-avatar">
              <Avatar
                username={player.username}
                side={player.isYou ? 'you' : 'them'}
              />

              {player.status === 'CONNECTED' && player.placement ? (
                <span
                  className="placement seat-badge"
                  style={{ background: color }}
                  title={`Connection #${player.placement}`}
                >
                  {player.placement}
                </span>
              ) : null}

              {player.status === 'ACTIVE' && player.hasSubmitted ? (
                <span className="seat-pip seat-pip-locked" title="Locked in">
                  ✓
                </span>
              ) : null}

              {player.status === 'LEFT' ? (
                <span className="seat-pip" title="Left the game">
                  —
                </span>
              ) : null}
            </span>

            <span className="seat-name">{player.isYou ? 'you' : player.username}</span>

            {word ? (
              <span
                className={[
                  'seat-word',
                  word.matched ? 'seat-word-matched' : 'seat-word-missed',
                  wordsArePrevious ? 'seat-word-previous' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={word.matched && !wordsArePrevious ? { color } : undefined}
                title={wordsArePrevious ? 'Said last round' : undefined}
              >
                {word.word}
              </span>
            ) : player.status === 'ACTIVE' && !player.hasSubmitted ? (
              <span className="seat-thinking" aria-label="thinking">
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="circle-centre">{children}</div>
    </div>
  );
}
