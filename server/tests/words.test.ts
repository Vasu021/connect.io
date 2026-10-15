import { describe, expect, it } from 'vitest';
import { normalizeWord, validateWord, wordsMatch } from '../src/game/words.js';

describe('normalizeWord', () => {
  it('trims and lowercases', () => {
    expect(normalizeWord('  FIFA  ')).toBe('fifa');
  });

  it('folds accents so equivalent spellings match', () => {
    expect(normalizeWord('café')).toBe('cafe');
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeWord(null)).toBe('');
    expect(normalizeWord(undefined)).toBe('');
  });
});

describe('validateWord', () => {
  it('accepts a plain word', () => {
    expect(validateWord('messi')).toEqual({ ok: true, word: 'messi' });
  });

  it('accepts internal hyphens and apostrophes', () => {
    expect(validateWord("merry-go-round").ok).toBe(true);
    expect(validateWord("o'clock").ok).toBe(true);
  });

  it('rejects multi-word input', () => {
    const result = validateWord('world cup');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/one word/i);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(validateWord('').ok).toBe(false);
    expect(validateWord('   ').ok).toBe(false);
  });

  it('rejects digits and symbols', () => {
    expect(validateWord('fifa23').ok).toBe(false);
    expect(validateWord('<script>').ok).toBe(false);
  });

  it('rejects anything over 32 characters', () => {
    expect(validateWord('a'.repeat(33)).ok).toBe(false);
    expect(validateWord('a'.repeat(32)).ok).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(validateWord(42).ok).toBe(false);
    expect(validateWord(null).ok).toBe(false);
  });
});

describe('wordsMatch', () => {
  it('matches case and whitespace variants', () => {
    expect(wordsMatch('FIFA', ' fifa ')).toBe(true);
  });

  it('matches across accents', () => {
    expect(wordsMatch('café', 'cafe')).toBe(true);
  });

  it('does not match different words', () => {
    expect(wordsMatch('messi', 'ronaldo')).toBe(false);
  });

  it('never matches when a player did not submit', () => {
    expect(wordsMatch(null, 'fifa')).toBe(false);
    expect(wordsMatch('fifa', null)).toBe(false);
    expect(wordsMatch(null, null)).toBe(false);
  });

  it('does not count two empty strings as a match', () => {
    expect(wordsMatch('', '')).toBe(false);
  });
});
