import { describe, expect, it } from 'vitest';
import { groupSubmissions } from '../src/game/grouping.js';

describe('groupSubmissions', () => {
  it('ignores a word nobody else said', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: 'ocean' },
      { userId: 'b', word: 'mountain' },
    ]);
    expect(groups).toEqual([]);
  });

  it('connects two players on the same word', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: 'ocean' },
      { userId: 'b', word: 'ocean' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.userIds).toEqual(['a', 'b']);
  });

  it('connects a group of five as one connection, not two pairs', () => {
    const groups = groupSubmissions(
      ['a', 'b', 'c', 'd', 'e'].map((userId) => ({ userId, word: 'ocean' })),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.userIds).toHaveLength(5);
  });

  it('matches across case, padding and accents', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: 'Café' },
      { userId: 'b', word: '  cafe ' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.normalized).toBe('cafe');
  });

  it('forms several groups in one round', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: 'ocean' },
      { userId: 'b', word: 'signal' },
      { userId: 'c', word: 'ocean' },
      { userId: 'd', word: 'signal' },
      { userId: 'e', word: 'alone' },
    ]);

    expect(groups).toHaveLength(2);
    // Deterministic order: normalised, ascending. Placement must not depend on
    // which packet happened to arrive first.
    expect(groups.map((group) => group.normalized)).toEqual(['ocean', 'signal']);
    expect(groups[0]?.userIds).toEqual(['a', 'c']);
    expect(groups[1]?.userIds).toEqual(['b', 'd']);
  });

  it('orders groups identically however the submissions arrive', () => {
    const forwards = groupSubmissions([
      { userId: 'a', word: 'zebra' },
      { userId: 'b', word: 'zebra' },
      { userId: 'c', word: 'apple' },
      { userId: 'd', word: 'apple' },
    ]);
    const backwards = groupSubmissions([
      { userId: 'd', word: 'apple' },
      { userId: 'c', word: 'apple' },
      { userId: 'b', word: 'zebra' },
      { userId: 'a', word: 'zebra' },
    ]);

    expect(forwards.map((g) => g.normalized)).toEqual(['apple', 'zebra']);
    expect(backwards.map((g) => g.normalized)).toEqual(['apple', 'zebra']);
  });

  it('keeps the spelling the first submitter used', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: 'Ocean' },
      { userId: 'b', word: 'ocean' },
    ]);
    expect(groups[0]?.word).toBe('Ocean');
  });

  it('skips empty submissions rather than connecting people on nothing', () => {
    const groups = groupSubmissions([
      { userId: 'a', word: '   ' },
      { userId: 'b', word: '' },
    ]);
    expect(groups).toEqual([]);
  });
});
