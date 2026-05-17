import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../../src/middleware/with-lru-cache.js';

describe('canonicalize — defensive / edge cases', () => {
  it('handles 5-level nested object with consistent key ordering', () => {
    const a = canonicalize({
      l1: { l2: { l3: { l4: { l5: { b: 2, a: 1 } } } } },
    });
    const b = canonicalize({
      l1: { l2: { l3: { l4: { l5: { a: 1, b: 2 } } } } },
    });
    expect(a).toBe(b);
  });

  it('non-plain-object values (Date, Map, RegExp) pass through their JSON serialization', () => {
    // We don't promise stability for these — only that we don't crash, and that
    // JSON.stringify's default behaviour is honored (Date → ISO string,
    // Map / RegExp → '{}' or omitted). This pins current behaviour so future
    // accidental refactors don't silently change cache key semantics.
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(canonicalize(date)).toBe('"2026-01-01T00:00:00.000Z"');
    expect(canonicalize(new Map([['a', 1]]))).toBe('{}');
    expect(canonicalize(/abc/g)).toBe('{}');
  });

  it('circular references propagate as a thrown error (loud failure)', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    // Story 2.6 chose to propagate rather than wrap — callers (zod-validated
    // tool args) should never construct cyclic inputs in practice; if it
    // happens it's a programmer error worth surfacing loudly. The exact
    // error type depends on whether `normalizeValue` recursion or
    // `JSON.stringify` detects the cycle first (RangeError vs TypeError
    // across Node versions), so we only assert "throws", not which class.
    expect(() => canonicalize(cyclic)).toThrow();
  });
});
