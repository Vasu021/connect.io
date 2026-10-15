/**
 * Word rules for a round.
 *
 * A submission has to be a single word so that "match" means the two players
 * genuinely landed on the same thing — allowing phrases would let one player
 * widen their surface area and game the score.
 */
export const MAX_WORD_LENGTH = 32;

/** Letters (incl. accented), plus internal hyphen/apostrophe for words like "merry-go-round". */
const WORD_PATTERN = /^[\p{L}][\p{L}'-]*$/u;

/** Canonical form used for comparison: trimmed, lowercased, accents folded. */
export function normalizeWord(word: string | null | undefined): string {
  return String(word ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export type WordValidation = { ok: true; word: string } | { ok: false; reason: string };

export function validateWord(input: unknown): WordValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'Submit a single word.' };

  const word = input.trim();
  if (!word) return { ok: false, reason: 'Type a word first.' };
  if (word.length > MAX_WORD_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_WORD_LENGTH} characters.` };
  }
  if (/\s/.test(word)) return { ok: false, reason: 'One word only — no spaces.' };
  if (!WORD_PATTERN.test(word)) return { ok: false, reason: 'Letters only.' };

  return { ok: true, word };
}

export function wordsMatch(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const left = normalizeWord(a);
  const right = normalizeWord(b);
  return left.length > 0 && left === right;
}
