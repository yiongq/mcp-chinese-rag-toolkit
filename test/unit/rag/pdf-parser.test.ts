import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePdf } from '../../../src/rag/pdf-parser.js';

const SAMPLE_PDF = fileURLToPath(
  new URL('../../../../../docs/employee-handbook.pdf', import.meta.url),
);

describe('parsePdf', () => {
  it('returns positive totalPages and pages.length === totalPages for the HR sample', async () => {
    const result = await parsePdf(SAMPLE_PDF);

    expect(result.totalPages).toBeGreaterThan(0);
    expect(result.pages).toHaveLength(result.totalPages);
    expect(result.pages.some((p) => p.text.length > 0)).toBe(true);
  });

  it('parses the HR sample in well under the CI 15s budget (sanity gate)', async () => {
    const t0 = Date.now();
    const result = await parsePdf(SAMPLE_PDF);
    const elapsed = Date.now() - t0;

    // Local macOS M-series ~1s; CI Linux ~3s. 15s buffer guards only against
    // a >5× regression in unpdf (per Story 2.1 Dev Notes §test performance).
    expect(elapsed).toBeLessThan(15_000);
    expect(result.totalPages).toBeGreaterThan(0);
  });

  it('accepts Uint8Array input', async () => {
    const bytes = await readFile(SAMPLE_PDF);

    const result = await parsePdf(bytes);

    expect(result.totalPages).toBeGreaterThan(0);
    expect(result.pages[0]?.pageNumber).toBe(1);
  });

  it('accepts ArrayBuffer input', async () => {
    const bytes = await readFile(SAMPLE_PDF);
    // Slice to obtain a bare ArrayBuffer view detached from Node's pooled Buffer backing store.
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const result = await parsePdf(arrayBuffer);

    expect(result.totalPages).toBeGreaterThan(0);
  });

  it('propagates the underlying error when the path does not exist (no swallowing)', async () => {
    await expect(parsePdf('/nonexistent/__missing__.pdf')).rejects.toThrow();
  });

  it('emits 1-indexed pageNumber (no 0-indexed leak from unpdf internals)', async () => {
    const result = await parsePdf(SAMPLE_PDF);

    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages.at(-1)?.pageNumber).toBe(result.totalPages);
    expect(result.pages.map((p) => p.pageNumber)).toEqual(result.pages.map((_, i) => i + 1));
  });
});
