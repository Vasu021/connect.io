import { useMemo } from 'react';

const COLORS = ['#34d399', '#22d3ee', '#c084fc', '#fbbf24', '#f472b6'];
const PIECES = 56;

/**
 * A one-shot celebration burst. Pure CSS animation rather than a canvas library:
 * it only ever runs for a couple of seconds and must not cost a dependency.
 */
export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        duration: 2.1 + Math.random() * 1.1,
        color: COLORS[index % COLORS.length] as string,
        skew: Math.random() * 40 - 20,
      })),
    [],
  );

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <i
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `skewY(${piece.skew}deg)`,
          }}
        />
      ))}
    </div>
  );
}
