import { normalizeWord } from './words.js';

export type SubmissionInput = {
  userId: string;
  word: string;
};

export type WordGroup = {
  /** The word as the players typed it (first submitter's spelling). */
  word: string;
  normalized: string;
  userIds: string[];
};

/**
 * Turns one round's submissions into the groups that connect.
 *
 * A group is two or more players who submitted the same word once normalised,
 * so `FIFA`, `fifa` and ` Fifa ` are one group. Players whose word nobody else
 * said simply stay in the circle.
 *
 * Ordering is deterministic — by normalised word — so that when several groups
 * form in the same round their placements (#1, #2 …) are reproducible rather
 * than depending on map iteration or network arrival order.
 */
export function groupSubmissions(submissions: readonly SubmissionInput[]): WordGroup[] {
  const byWord = new Map<string, WordGroup>();

  for (const submission of submissions) {
    const normalized = normalizeWord(submission.word);
    if (!normalized) continue;

    const existing = byWord.get(normalized);
    if (existing) {
      existing.userIds.push(submission.userId);
      continue;
    }

    byWord.set(normalized, {
      word: submission.word,
      normalized,
      userIds: [submission.userId],
    });
  }

  return [...byWord.values()]
    .filter((group) => group.userIds.length >= 2)
    .sort((a, b) => a.normalized.localeCompare(b.normalized));
}
