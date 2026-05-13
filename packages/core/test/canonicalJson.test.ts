import { describe, expect, it } from 'vitest';

import { canonicalize, CanonicalJsonError } from '../src/canonicalJson.js';

describe('canonicalize', () => {
  it('sorts object keys at the top level', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts object keys at every depth', () => {
    expect(canonicalize({ z: { y: 1, x: { c: 3, b: 2, a: 1 } } })).toBe(
      '{"z":{"x":{"a":1,"b":2,"c":3},"y":1}}',
    );
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces no whitespace', () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('is idempotent — re-parse + re-canonicalize is a fixed point', () => {
    const obj = { z: 1, a: { c: 3, b: 2 }, m: [1, 2, 3] };
    const first = canonicalize(obj);
    const second = canonicalize(JSON.parse(first));
    expect(second).toBe(first);
  });

  it('escapes string values per JSON', () => {
    expect(canonicalize({ k: 'line1\nline2' })).toBe('{"k":"line1\\nline2"}');
  });

  it('handles null, true, false', () => {
    expect(canonicalize({ a: null, b: true, c: false })).toBe(
      '{"a":null,"b":true,"c":false}',
    );
  });

  it('rejects non-integer numbers', () => {
    expect(() => canonicalize({ x: 1.5 })).toThrow(CanonicalJsonError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalize({ x: NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalize({ x: Infinity })).toThrow(CanonicalJsonError);
  });
});
