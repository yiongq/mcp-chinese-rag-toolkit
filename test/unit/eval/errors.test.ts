import { describe, expect, it } from 'vitest';

import {
  assertContentPopulated,
  EVAL_ERROR_CODES,
  EvalFrameworkError,
  evalError,
} from '../../../src/eval/errors.js';
import type { EvalSearchResult } from '../../../src/eval/types.js';

function makeResult(over: Partial<EvalSearchResult> = {}): EvalSearchResult {
  return { source: 'bench-fixture.md', ...over };
}

describe('EVAL_ERROR_CODES', () => {
  it('registers EVAL_CONTENT_MISSING as a self-named literal', () => {
    expect(EVAL_ERROR_CODES.EVAL_CONTENT_MISSING).toBe('EVAL_CONTENT_MISSING');
  });
});

describe('evalError / EvalFrameworkError', () => {
  it('defaults retryable to false and carries the code', () => {
    const err = evalError('EVAL_CONTENT_MISSING', 'boom');
    expect(err).toBeInstanceOf(EvalFrameworkError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EvalFrameworkError');
    expect(err.code).toBe('EVAL_CONTENT_MISSING');
    expect(err.message).toBe('boom');
    expect(err.retryable).toBe(false);
  });

  it('honours an explicit retryable flag', () => {
    const err = evalError('EVAL_CONTENT_MISSING', 'boom', { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it('is catchable as EvalFrameworkError after being thrown', () => {
    try {
      throw evalError('EVAL_CONTENT_MISSING', 'thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalFrameworkError);
      expect((e as EvalFrameworkError).code).toBe('EVAL_CONTENT_MISSING');
    }
  });
});

describe('assertContentPopulated', () => {
  it('narrows content to string and returns for a populated row', () => {
    const r = makeResult({ content: '试用期为六个月。' });
    assertContentPopulated(r);
    // After the assertion, content is a guaranteed string — reading .length
    // here is the compile-time proof of the narrowing as well as a runtime check.
    expect(r.content.length).toBeGreaterThan(0);
  });

  // Each blank shape must be rejected so a benchmark is never silently poisoned.
  const blankCases: Array<{ label: string; content: EvalSearchResult['content'] }> = [
    { label: 'null content', content: null as unknown as undefined },
    { label: 'undefined content', content: undefined },
    { label: 'empty string content', content: '' },
    { label: 'whitespace-only content', content: '   \n\t ' },
  ];

  for (const { label, content } of blankCases) {
    it(`throws EVAL_CONTENT_MISSING (non-retryable) for ${label}`, () => {
      const r = makeResult({ content });
      let caught: unknown;
      try {
        assertContentPopulated(r);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EvalFrameworkError);
      expect((caught as EvalFrameworkError).code).toBe('EVAL_CONTENT_MISSING');
      expect((caught as EvalFrameworkError).retryable).toBe(false);
      // The message must point at the offending chunk via its source.
      expect((caught as EvalFrameworkError).message).toContain('bench-fixture.md');
    });
  }

  it('includes section and page in the message when present', () => {
    const r = makeResult({ content: '', section: '试用期', page: 3 });
    expect(() => assertContentPopulated(r)).toThrow(/section="试用期"/);
    expect(() => assertContentPopulated(r)).toThrow(/page=3/);
  });

  it('omits section and page from the message when absent', () => {
    const r = makeResult({ content: '' });
    let message = '';
    try {
      assertContentPopulated(r);
    } catch (e) {
      message = (e as EvalFrameworkError).message;
    }
    expect(message).not.toContain('section=');
    expect(message).not.toContain('page=');
  });
});
