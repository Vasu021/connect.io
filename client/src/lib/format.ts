/**
 * Two letters that actually distinguish people. With eight avatars on screen
 * at once this matters: "demo1".."demo8" must not all render as "DE", and
 * neither must "demo_a" and "demo_b".
 */
export function initials(name: string): string {
  const parts = name.split(/[._\-\s]+/).filter(Boolean);

  // Separated names take one letter from each part: demo_a -> DA.
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }

  const plain = parts[0] ?? name;
  if (plain.length < 2) return plain.toUpperCase();

  // Otherwise first and last character, which keeps trailing digits and so
  // separates demo1 from demo8.
  return `${plain[0]}${plain[plain.length - 1]}`.toUpperCase();
}

/** "just now", "4m ago", "3d ago" — enough precision for a game log. */
export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const OUTCOME_LABELS: Record<string, string> = {
  MATCHED: 'Connected',
  UNMATCHED: 'No match',
  ABANDONED: 'Abandoned',
  FORFEITED: 'Ended early',
};

export function outcomeLabel(outcome: string | null): string {
  return outcome ? (OUTCOME_LABELS[outcome] ?? outcome) : '';
}

/** How the score reads in prose. Lower is better, so 1 deserves a flourish. */
export function scoreHeadline(score: number): string {
  if (score === 1) return 'First try. That is uncanny.';
  if (score === 2) return 'Two rounds. You two are in sync.';
  if (score <= 4) return `Connected in ${score} rounds.`;
  if (score <= 8) return `Got there in ${score} rounds.`;
  return `${score} rounds, but you got there.`;
}
