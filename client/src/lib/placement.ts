/** One colour per Connection, so #1 and #2 never read as the same group. */
const PLACEMENT_COLORS = [
  'var(--c1)',
  'var(--c2)',
  'var(--c3)',
  'var(--c4)',
  'var(--c5)',
  'var(--c6)',
  'var(--c7)',
  'var(--c8)',
];

export function placementColor(placement: number | null | undefined): string {
  if (!placement || placement < 1) return 'var(--text-faint)';
  return PLACEMENT_COLORS[(placement - 1) % PLACEMENT_COLORS.length] as string;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export function ordinal(placement: number): string {
  return ORDINALS[placement - 1] ?? `${placement}th`;
}

/** Seat coordinates as percentages of the circle box, starting at the top. */
export function seatPosition(
  index: number,
  total: number,
  radiusPercent: number,
): { x: number; y: number } {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 50 + Math.cos(angle) * radiusPercent,
    y: 50 + Math.sin(angle) * radiusPercent,
  };
}
