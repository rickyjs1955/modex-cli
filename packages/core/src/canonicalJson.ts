// Deterministic JSON serializer used to hash provenance entries.
// Rules:
// - Object keys sorted ascending by UTF-16 code unit (matches our slug ordering).
// - No whitespace between tokens.
// - Strings escaped via JSON.stringify (handles all valid Unicode).
// - Numbers must be finite integers; floats and NaN/Infinity are rejected so we
//   never depend on float printer behavior. (Provenance entries only carry ints.)
//
// Not full RFC 8785: we don't need number normalization or full Unicode
// canonical form because the value space is constrained to strings and
// non-negative integers.

export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function compareCodepoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function canonicalize(value: CanonicalJson): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new CanonicalJsonError(
        `non-integer number not allowed in canonical JSON: ${value}`,
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodepoints);
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k]!)}`);
    return `{${parts.join(',')}}`;
  }
  throw new CanonicalJsonError(`unsupported value type: ${typeof value}`);
}
