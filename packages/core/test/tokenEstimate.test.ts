import { describe, expect, it } from 'vitest';

import { estimateTokens } from '../src/tokenEstimate.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up — 5 chars is 2 tokens', () => {
    expect(estimateTokens('hello')).toBe(2);
  });

  it('counts code points, not UTF-16 code units (emoji counts as 1)', () => {
    // "🙂" is 2 UTF-16 code units but 1 code point
    expect(estimateTokens('🙂🙂🙂🙂')).toBe(1);
  });

  it('grows roughly linearly', () => {
    const t = 'a'.repeat(40_000);
    expect(estimateTokens(t)).toBe(10_000);
  });
});
