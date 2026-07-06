import { describe, expect, it, vi } from 'vitest';

import { makeSpan, newSpanId, runSpanSafe } from '../../../src/observability/span.js';
import type { PipelineSpan } from '../../../src/observability/span.js';

function sampleSpan(): PipelineSpan {
  return makeSpan('retrieve.hybrid', { id: newSpanId() }, 1_700_000_000_000, 1, { ok: true });
}

describe('runSpanSafe', () => {
  it('is a no-op when no consumer is supplied', () => {
    expect(() => runSpanSafe(undefined, sampleSpan())).not.toThrow();
  });

  it('forwards the span to a listening consumer exactly once', () => {
    const seen: PipelineSpan[] = [];
    runSpanSafe((s) => seen.push(s), sampleSpan());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('retrieve.hybrid');
  });

  it('swallows a throwing consumer into console.warn without rethrowing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        runSpanSafe(() => {
          throw new Error('consumer boom');
        }, sampleSpan()),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/span consumer threw/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('makeSpan', () => {
  it('omits parentId entirely when none is supplied', () => {
    const span = makeSpan('ingest.parse', { id: 'a' }, 1000, 5, { ok: true });
    expect('parentId' in span).toBe(false);
  });

  it('omits parentId when the supplied value is undefined', () => {
    const span = makeSpan(
      'retrieve.hybrid',
      { id: 'a', parentId: undefined },
      1000,
      5,
      { ok: true },
    );
    expect('parentId' in span).toBe(false);
  });

  it('keeps parentId when supplied', () => {
    const span = makeSpan(
      'retrieve.bm25',
      { id: 'child', parentId: 'root' },
      1000,
      5,
      { hitCount: 3 },
    );
    expect(span.parentId).toBe('root');
  });

  it('round-trips the name / timings / attributes verbatim', () => {
    const span = makeSpan('ingest.index', { id: 'x' }, 42, 7, { chunkCount: 9, ok: true });
    expect(span).toMatchObject({
      name: 'ingest.index',
      id: 'x',
      startedAtEpochMs: 42,
      durationMs: 7,
      attributes: { chunkCount: 9, ok: true },
    });
  });

  it('renders non-finite numeric attributes export-safe so JSON keeps them', () => {
    // An "unbounded" topK of Infinity is a supported input; left raw it would
    // serialize to `null` and silently vanish on the wire.
    const span = makeSpan('retrieve.rerank', { id: 'r' }, 1000, 5, {
      topK: Number.POSITIVE_INFINITY,
      lower: Number.NEGATIVE_INFINITY,
      bad: Number.NaN,
      finite: 7,
      ok: true,
    });
    expect(span.attributes).toMatchObject({
      topK: 'Infinity',
      lower: '-Infinity',
      bad: 'NaN',
      finite: 7,
      ok: true,
    });
    const roundTripped = JSON.parse(JSON.stringify(span.attributes));
    expect(roundTripped.topK).toBe('Infinity');
    expect(roundTripped.finite).toBe(7);
  });

  it('returns all-finite attributes untouched without an extra copy', () => {
    const attributes = { hitCount: 3, ok: true };
    const span = makeSpan('retrieve.bm25', { id: 'b' }, 1, 1, attributes);
    expect(span.attributes).toBe(attributes);
  });
});

describe('newSpanId', () => {
  it('returns a distinct id on each call', () => {
    expect(newSpanId()).not.toBe(newSpanId());
  });
});
