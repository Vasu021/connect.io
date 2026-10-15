import { placementColor } from '../lib/placement';
import type { PlayerView, RoundView } from '../lib/types';

/**
 * Every round, newest first, with who said what.
 *
 * The whole skill of the game is aiming at the middle of what the group just said,
 * so those words have to stay readable — not flash past in the reveal and
 * disappear.
 */
export function RoundHistory({
  rounds,
  players,
}: {
  rounds: RoundView[];
  players: PlayerView[];
}) {
  if (rounds.length === 0) {
    return <div className="empty">Nothing said yet — round one is a shot in the dark.</div>;
  }

  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    if (!player) return 'player';
    return player.isYou ? 'you' : player.username;
  };

  return (
    <div className="rows-scroll">
      {[...rounds].reverse().map((round) => (
        <div className="history-round" key={round.roundNumber}>
          <div className="history-head">
            <span className="history-num">Round {round.roundNumber}</span>
            {round.formed.map((connection) => (
              <span
                className="placement"
                key={connection.placement}
                style={{ background: placementColor(connection.placement) }}
                title={`Connection #${connection.placement} on "${connection.word}"`}
              >
                {connection.placement}
              </span>
            ))}
          </div>

          <div className="history-words">
            {round.submissions.length === 0 ? (
              <span className="faint small">nobody spoke</span>
            ) : (
              round.submissions.map((submission) => {
                const player = players.find((p) => p.id === submission.userId);
                return (
                  <span
                    className={[
                      'word-chip',
                      submission.matched ? 'word-chip-matched' : '',
                      player?.isYou ? 'word-chip-you' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={submission.userId}
                  >
                    <b>{submission.word}</b>
                    <span>{nameOf(submission.userId)}</span>
                  </span>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The last round's words, pinned under the input while everyone thinks. */
export function LastRound({
  round,
  players,
}: {
  round: RoundView;
  players: PlayerView[];
}) {
  if (round.submissions.length === 0) return null;

  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    if (!player) return 'player';
    return player.isYou ? 'you' : player.username;
  };

  return (
    <div className="last-round">
      <span className="last-round-label">Round {round.roundNumber} said</span>
      {round.submissions.map((submission) => {
        const player = players.find((p) => p.id === submission.userId);
        return (
          <span
            className={[
              'word-chip',
              submission.matched ? 'word-chip-matched' : '',
              player?.isYou ? 'word-chip-you' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={submission.userId}
          >
            <b>{submission.word}</b>
            <span>{nameOf(submission.userId)}</span>
          </span>
        );
      })}
    </div>
  );
}
