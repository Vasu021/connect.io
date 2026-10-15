import type { RoundView } from '../lib/types';

/**
 * The trail of attempts. These near-misses are the interesting part of a game —
 * they show two people negotiating a shared frame — so they get real space
 * rather than being tucked into a log.
 */
export function RoundTrail({
  rounds,
  youArePlayer1,
}: {
  rounds: RoundView[];
  youArePlayer1: boolean;
}) {
  if (rounds.length === 0) {
    return <div className="empty">No rounds yet — your first words will show up here.</div>;
  }

  return (
    <div className="trail">
      {[...rounds].reverse().map((round) => {
        const yourWord = youArePlayer1 ? round.player1Word : round.player2Word;
        const theirWord = youArePlayer1 ? round.player2Word : round.player1Word;

        return (
          <div
            key={round.roundNumber}
            className={`trail-row${round.matched ? ' is-matched' : ''}`}
          >
            <span className="trail-num">{round.roundNumber}</span>
            <span className={`trail-word side-you${yourWord ? '' : ' is-empty'}`}>
              {yourWord ?? 'no word'}
            </span>
            <span className="trail-link" aria-hidden="true">
              {round.matched ? '===' : '~'}
            </span>
            <span className={`trail-word side-them${theirWord ? '' : ' is-empty'}`}>
              {theirWord ?? 'no word'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
