import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from '../../../../bin/run-vision-caption-demo.js';

describe('run-vision-caption-demo CLI — parseArgs', () => {
  it('throws when no positional argument is provided', () => {
    expect(() => parseArgs([])).toThrow(/expected sample PDF path/);
  });

  it('throws when the first argument is empty', () => {
    expect(() => parseArgs([''])).toThrow(/non-empty path/);
  });

  it('throws when the first argument looks like a flag instead of a path', () => {
    expect(() => parseArgs(['--foo'])).toThrow(/non-empty path/);
  });

  it('rejects single-dash flag forms (e.g. -h, -x) instead of treating as path', () => {
    expect(() => parseArgs(['-h'])).toThrow(/non-empty path/);
    expect(() => parseArgs(['-x'])).toThrow(/non-empty path/);
  });

  it('returns the supplied pdfPath when valid', () => {
    expect(parseArgs(['./sample.pdf'])).toEqual({ pdfPath: './sample.pdf' });
  });
});

describe('run-vision-caption-demo CLI — main env-validation', () => {
  let originalApiKey: string | undefined;
  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it('exits with code 1 when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await main(['./does-not-matter.pdf']);
      expect(code).toBe(1);
      const messages = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(messages).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      stderr.mockRestore();
    }
  });

  it('exits with code 1 when ANTHROPIC_API_KEY is empty', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await main(['./does-not-matter.pdf']);
      expect(code).toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it('returns 1 (not a rejected Promise) when parseArgs throws past the env check', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake';
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      // Empty argv triggers parseArgs throw; without the main() try/catch
      // this would reject the Promise instead of returning 1.
      const code = await main([]);
      expect(code).toBe(1);
      const messages = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(messages).toMatch(/expected sample PDF path/);
    } finally {
      stderr.mockRestore();
    }
  });
});
