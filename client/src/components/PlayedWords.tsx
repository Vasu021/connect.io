/**
 * Every word already burned. This is part of the board, not a footnote: a word
 * played once can never be played again, so hiding it would just cost people
 * their round.
 */
export function PlayedWords({ words }: { words: string[] }) {
  if (words.length === 0) {
    return <div className="empty">Nothing played yet — anything goes.</div>;
  }

  return (
    <div className="played-words">
      {words.map((word) => (
        <span className="played-word" key={word.toLowerCase()}>
          {word}
        </span>
      ))}
    </div>
  );
}
