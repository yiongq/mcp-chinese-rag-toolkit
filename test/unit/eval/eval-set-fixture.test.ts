import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadEvalSet } from '../../../src/eval/eval-runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalSetPath = path.resolve(here, '..', '..', '..', 'eval', 'eval-set.yml');

describe('toolkit self-contained eval-set.yml', () => {
  it('loads cleanly and exposes the v1-hr-mini-fixture version + 12 queries', () => {
    const set = loadEvalSet(evalSetPath);
    expect(set.version).toBe('v1-hr-mini-fixture');
    expect(set.queries).toHaveLength(12);
  });

  it('every query has a non-empty reason', () => {
    const set = loadEvalSet(evalSetPath);
    const noReason = set.queries.filter(
      (q) => q.reason === undefined || q.reason.trim().length === 0,
    );
    expect(noReason).toEqual([]);
  });

  it('every query has a kebab-case category (strict)', () => {
    const set = loadEvalSet(evalSetPath);
    const noCategory = set.queries.filter((q) => q.category === undefined);
    expect(noCategory).toEqual([]);
    const bad = set.queries.filter((q) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.category ?? ''));
    expect(bad).toEqual([]);
  });

  it('every query points at a unique fixture chunk (1-to-1 mapping)', () => {
    const set = loadEvalSet(evalSetPath);
    const pages = set.queries.map((q) => q.expected[0]?.page);
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const q of set.queries) {
      expect(q.expected[0]?.source).toBe('bench-fixture.md');
    }
  });
});
