import { describe, expect, it } from 'vitest';
import { tokenize } from '../../../src/rag/fts-tokenizer.js';

describe('fts-tokenizer (jieba pre-tokenize)', () => {
  it('cuts Chinese input into space-separated tokens', () => {
    const result = tokenize('试用期管理规定');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(' ');
    // sanity: at least one Chinese token present
    expect(/[一-龥]/.test(result)).toBe(true);
  });

  it('returns empty string for empty input (short-circuit, no jieba call)', () => {
    expect(tokenize('')).toBe('');
  });

  it('handles mixed Chinese / English / numbers without throwing', () => {
    const result = tokenize('Mixed 中文 with English 和 numbers 123');
    expect(result.length).toBeGreaterThan(0);
    // Latin tokens preserved as-is (no lowercasing here — FTS5 unicode61 does it)
    expect(result).toMatch(/Mixed/);
    expect(result).toMatch(/123/);
  });

  it('reuses the singleton dictionary across 1000 calls (warm cache stays fast)', () => {
    // First call may pay one-time dict cost; subsequent calls must be sub-millisecond.
    tokenize('warmup');
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) {
      tokenize('试用期管理规定与请假流程');
    }
    const elapsed = Date.now() - start;
    // Generous threshold: 1000 short Chinese tokenizations must finish under 500 ms.
    expect(elapsed).toBeLessThan(500);
  });

  it('tokenizes long input (10k characters) without throwing', () => {
    const longText = '试用期管理规定与员工福利政策。'.repeat(700); // ~9.8k chars
    const result = tokenize(longText);
    expect(result).toContain(' ');
    expect(result.length).toBeGreaterThan(longText.length / 2);
  });

  it('filters whitespace-only tokens so FTS5 phrase queries stay clean', () => {
    // Input containing multiple spaces that jieba may surface as whitespace tokens.
    const result = tokenize('   试用期   管理   规定   ');
    expect(result).not.toMatch(/\s\s+/);
    // Trimmed Chinese tokens still present.
    expect(/试用期/.test(result)).toBe(true);
  });

  it('strips NUL bytes and ASCII control characters before tokenizing', () => {
    const dirty = '试\u0000用\u0001期\u001F管\u007F理';
    const result = tokenize(dirty);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: assertion validates the sanitizer
    expect(result).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(/试|用|期|管|理/.test(result)).toBe(true);
  });

  it('returns empty string when input is only control characters', () => {
    expect(tokenize('\u0000\u0001\u0002\u007F')).toBe('');
  });

  it('drops punctuation-only tokens so phrase queries stay valid', () => {
    // Both ASCII and full-width Chinese punctuation should be filtered out.
    const result = tokenize('请假*流程。。。差旅，报销');
    expect(result).not.toMatch(/[*。，]/);
    expect(/请假|流程|差旅|报销/.test(result)).toBe(true);
  });
});
