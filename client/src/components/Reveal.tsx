import type { RoundView } from '../lib/types';

/** Both words land at once — simultaneity is the point, so neither side leads. */
export function Reveal({
  round,
  youArePlayer1,
}: {
  round: RoundView;
  youArePlayer1: boolean;
}) {
  const yourWord = youArePlayer1 ? round.player1Word : round.player2Word;
  const theirWord = youArePlayer1 ? round.player2Word : round.player1Word;

  return (
    <div className={`reveal ${round.matched ? 'is-matched' : 'is-missed'}`}>
      <div className={`reveal-word side-you${yourWord ? '' : ' is-empty'}`}>
        {yourWord ?? 'no word'}
      </div>
      <div className={`reveal-verdict ${round.matched ? 'is-matched' : 'is-missed'}`}>
        {round.matched ? 'connected' : 'not yet'}
      </div>
      <div className={`reveal-word side-them${theirWord ? '' : ' is-empty'}`}>
        {theirWord ?? 'no word'}
      </div>
    </div>
  );
}
