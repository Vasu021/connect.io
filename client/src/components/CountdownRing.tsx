const RADIUS = 66;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The round clock. Colour carries the urgency so the number does not have to:
 * cyan while there is time, amber under 6s, red under 3s.
 */
export function CountdownRing({
  secondsLeft,
  totalSeconds,
  caption,
}: {
  secondsLeft: number;
  totalSeconds: number;
  caption: string;
}) {
  const fraction = totalSeconds > 0 ? Math.min(1, Math.max(0, secondsLeft / totalSeconds)) : 0;
  const urgent = secondsLeft <= 3;
  const warn = !urgent && secondsLeft <= 6;

  const toneClass = urgent ? ' is-urgent' : warn ? ' is-warn' : '';

  return (
    <div
      className={`ring-wrap${urgent ? ' is-urgent' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`${secondsLeft} seconds left`}
    >
      <svg viewBox="0 0 148 148" aria-hidden="true">
        <circle className="ring-track" cx="74" cy="74" r={RADIUS} />
        <circle
          className={`ring-progress${toneClass}`}
          cx="74"
          cy="74"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span className="ring-label">{secondsLeft}</span>
      <span className="ring-sub">{caption}</span>
    </div>
  );
}
