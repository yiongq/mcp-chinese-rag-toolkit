import { describe, expect, it } from 'vitest';
import {
  create,
  ERROR_CODES,
  ErrorCodeSchema,
  isErrorEnvelope,
  StructuredErrorPayloadSchema,
} from '../../../src/server/errors.js';

describe('errors.create', () => {
  it('emits the canonical envelope shape with all optional fields populated', () => {
    const envelope = create('TEST_ERR', 'something failed', {
      retryable: true,
      confidence: 'low',
      citations: [{ source: 's.pdf', page: 1 }],
      refusal: 'cannot answer with low confidence',
      suggestions: ['try with more context'],
      details: { trace: 'abc' },
    });

    expect(envelope.isError).toBe(true);
    expect(envelope.content).toHaveLength(1);
    expect(envelope.content?.[0]).toMatchObject({ type: 'text' });

    const sc = envelope.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe('TEST_ERR');
    expect(sc.message).toBe('something failed');
    expect(sc.retryable).toBe(true);
    expect(sc.confidence).toBe('low');
    expect(sc.refusal).toBe('cannot answer with low confidence');
    expect(sc.citations).toEqual([{ source: 's.pdf', page: 1 }]);
    expect(sc.suggestions).toEqual(['try with more context']);
    expect(sc.details).toEqual({ trace: 'abc' });

    const firstContent = envelope.content?.[0] as { type: string; text: string };
    const parsed = JSON.parse(firstContent.text);
    expect(parsed).toEqual(sc);
  });

  it('defaults retryable to false (fail-closed per )', () => {
    const envelope = create('X', 'm');
    const sc = envelope.structuredContent as Record<string, unknown>;
    expect(sc.retryable).toBe(false);
    expect(sc.confidence).toBeUndefined();
    expect(sc.citations).toBeUndefined();
    expect(sc.refusal).toBeUndefined();
  });

  it('exposes shared error code constants', () => {
    expect(ERROR_CODES.TIMEOUT).toBe('TIMEOUT');
    expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ERROR_CODES.ABORTED).toBe('ABORTED');
  });
});

describe('ErrorCodeSchema', () => {
  it('rejects lowercase codes (enforces SCREAMING_SNAKE_CASE)', () => {
    expect(() => ErrorCodeSchema.parse('lower_case')).toThrow();
    expect(() => ErrorCodeSchema.parse('Mixed_Case')).toThrow();
    expect(() => ErrorCodeSchema.parse('123_NUM_FIRST')).toThrow();
    expect(ErrorCodeSchema.parse('VALID_CODE')).toBe('VALID_CODE');
    expect(ErrorCodeSchema.parse('A')).toBe('A');
  });

  it('throws when create() receives an invalid code', () => {
    expect(() => create('invalid', 'm')).toThrow();
  });
});

describe('StructuredErrorPayloadSchema round-trip', () => {
  it('parses an envelope produced by create() back to the same payload', () => {
    const envelope = create('PARSE_ROUNDTRIP', 'm', {
      retryable: true,
      confidence: 'medium',
      citations: [{ source: 'doc', section: 'intro' }],
    });
    const parsed = StructuredErrorPayloadSchema.parse(envelope.structuredContent);
    expect(parsed.error).toBe('PARSE_ROUNDTRIP');
    expect(parsed.confidence).toBe('medium');
    expect(parsed.citations).toEqual([{ source: 'doc', section: 'intro' }]);
  });
});

describe('isErrorEnvelope', () => {
  it('returns true only for valid error envelopes', () => {
    const envelope = create('CHECK_GUARD', 'm');
    expect(isErrorEnvelope(envelope)).toBe(true);

    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope({ isError: false, structuredContent: {} })).toBe(false);
    expect(isErrorEnvelope({ isError: true, structuredContent: {} })).toBe(false);
    expect(isErrorEnvelope({ content: [], isError: true })).toBe(false);
    // structuredContent OK but content array missing — must reject (callers rely on content[0]).
    const validPayload = (create('VALID', 'm') as { structuredContent: unknown }).structuredContent;
    expect(isErrorEnvelope({ isError: true, structuredContent: validPayload })).toBe(false);
  });
});

describe('errors.create — Rule #5 robustness', () => {
  it('handles circular references in details without throwing', () => {
    const circular: Record<string, unknown> = { name: 'cycle' };
    circular.self = circular;
    // Must NOT throw — Rule #5 says no exception escapes the envelope helper.
    const envelope = create('SERIALIZATION_TEST', 'circular details', { details: circular });
    expect(envelope.isError).toBe(true);
    const sc = envelope.structuredContent as Record<string, unknown>;
    const details = sc.details as Record<string, unknown> | undefined;
    expect(details?._serializationError).toBeTypeOf('string');
    // The text payload still round-trips through JSON.
    const firstContent = envelope.content?.[0] as { type: string; text: string };
    expect(() => JSON.parse(firstContent.text)).not.toThrow();
  });

  it('accepts page=0 in citations (supports 0-indexed PDF parsers)', () => {
    const envelope = create('PAGE_TEST', 'm', {
      citations: [{ source: 'doc.pdf', page: 0 }],
    });
    const sc = envelope.structuredContent as Record<string, unknown>;
    expect(sc.citations).toEqual([{ source: 'doc.pdf', page: 0 }]);
  });
});
