import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARSE_TIMEOUT_MS, decodeText, parseDocument } from '../../../src/ingest/document-parser.js';
import { INGEST_ERROR_CODES } from '../../../src/ingest/errors.js';
import type { ParseResult } from '../../../src/ingest/types.js';
import { chunk } from '../../../src/rag/chunking.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const PDF = fileURLToPath(new URL('sample.pdf', FIXTURES));
const DOCX = fileURLToPath(new URL('sample.docx', FIXTURES));
const MD = fileURLToPath(new URL('sample.md', FIXTURES));
const UTF8_TXT = fileURLToPath(new URL('sample-utf8.txt', FIXTURES));
const GBK_TXT = fileURLToPath(new URL('sample-gbk.txt', FIXTURES));

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MD_MIME = 'text/markdown';
const TXT_MIME = 'text/plain';

/** Read a fixture as a plain in-memory `Uint8Array` (parseDocument's input shape). */
async function bytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

/** Narrow a `ParseResult` to its success variant, failing loudly otherwise. */
function assertOk(r: ParseResult): asserts r is Extract<ParseResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok result, got ${r.error}: ${r.message}`);
}

/** Narrow a `ParseResult` to its failure variant, failing loudly otherwise. */
function assertFailed(r: ParseResult): asserts r is Extract<ParseResult, { ok: false }> {
  if (r.ok) throw new Error('expected a failure result, got ok');
}

describe('parseDocument — successful parses', () => {
  it('parses a PDF into 1-indexed pages (paginated shape, no text field)', async () => {
    const result = await parseDocument(await bytes(PDF), PDF_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(PDF_MIME);
    const pages = result.doc.pages;
    expect(pages).toBeDefined();
    expect(pages?.length).toBeGreaterThan(0);
    expect(pages?.[0]?.pageNumber).toBe(1);
    expect(pages?.at(-1)?.pageNumber).toBe(pages?.length);
    expect(result.doc.text).toBeUndefined();
    expect(result.doc.encoding).toBeUndefined();
  });

  it('parses Markdown into heading-preserving text that feeds the chunker', async () => {
    const result = await parseDocument(await bytes(MD), MD_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(MD_MIME);
    const text = result.doc.text ?? '';
    expect(text.startsWith('#')).toBe(true);
    expect(result.doc.pages).toBeUndefined();

    // AC anchor: the parsed text drops straight into the existing chunker, whose
    // heading tracker turns `#`/`##` into a `section` provenance path.
    const chunks = await chunk(text, { source: 'sample.md' });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.section?.includes('快速开始'))).toBe(true);
  });

  it('parses docx into heading-preserving Markdown that feeds the chunker', async () => {
    const result = await parseDocument(await bytes(DOCX), DOCX_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(DOCX_MIME);
    const text = result.doc.text ?? '';
    expect(text).toContain('#');
    expect(result.doc.pages).toBeUndefined();

    const chunks = await chunk(text, { source: 'sample.docx' });
    expect(chunks.some((c) => c.section?.includes('安装步骤'))).toBe(true);
  });

  it('parses plain UTF-8 text and detects the encoding', async () => {
    const result = await parseDocument(await bytes(UTF8_TXT), TXT_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(TXT_MIME);
    expect(result.doc.encoding).toBe('utf-8');
    expect(result.doc.text).toContain('UTF-8');
    expect(result.doc.pages).toBeUndefined();
  });

  it('parses GBK-encoded plain text via the fallback decoder', async () => {
    const result = await parseDocument(await bytes(GBK_TXT), TXT_MIME);

    assertOk(result);
    expect(result.doc.encoding).toBe('gbk');
    expect(result.doc.text).toBe('中文编码测试，你好世界。');
  });
});

describe('parseDocument — failure paths (returned, never thrown)', () => {
  it('returns UNSUPPORTED_MIME_TYPE for a non-whitelisted mimeType', async () => {
    const result = await parseDocument(new TextEncoder().encode('x'), 'image/png');

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.UNSUPPORTED_MIME_TYPE);
  });

  it('returns PARSE_FAILED (not throw) for bytes that are not a valid PDF', async () => {
    const notAPdf = new TextEncoder().encode('this is plainly not a pdf document');

    const result = await parseDocument(notAPdf, PDF_MIME);

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.PARSE_FAILED);
  });

  it('returns PARSE_FAILED (not throw) for bytes that are not a valid docx', async () => {
    const notADocx = new TextEncoder().encode('not a zip container at all');

    const result = await parseDocument(notADocx, DOCX_MIME);

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.PARSE_FAILED);
  });

  it('returns EMPTY_DOCUMENT for whitespace-only text', async () => {
    const result = await parseDocument(new TextEncoder().encode('   \n\t  \n'), TXT_MIME);

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.EMPTY_DOCUMENT);
  });

  it('returns PARSE_TIMEOUT when the parse outruns a tiny budget', async () => {
    // docx parsing does real async work (unzip + XML parse); a 1ms budget
    // reliably loses the race. Assert only the RESULT code — never wall-clock
    // timing, which would be CI-flaky.
    const result = await parseDocument(await bytes(DOCX), DOCX_MIME, { timeoutMs: 1 });

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.PARSE_TIMEOUT);
  });
});

describe('parseDocument — purity', () => {
  it('does not detach or mutate the caller buffer (re-parseable)', async () => {
    const buffer = await bytes(PDF);
    const originalLength = buffer.byteLength;

    const first = await parseDocument(buffer, PDF_MIME);
    assertOk(first);
    // The underlying PDF engine detaches the buffer it parses; parseDocument
    // must shield the caller's buffer from that side effect.
    expect(buffer.byteLength).toBe(originalLength);

    const second = await parseDocument(buffer, PDF_MIME);
    assertOk(second);
    expect(second.doc.pages?.length).toBe(first.doc.pages?.length);
  });
});

describe('decodeText', () => {
  it('detects utf-8 for valid UTF-8 bytes', () => {
    const { text, encoding } = decodeText(new TextEncoder().encode('你好 world'));

    expect(encoding).toBe('utf-8');
    expect(text).toBe('你好 world');
  });

  it('falls back to gbk and decodes the characters correctly', async () => {
    const { text, encoding } = decodeText(await bytes(GBK_TXT));

    expect(encoding).toBe('gbk');
    expect(text).toBe('中文编码测试，你好世界。');
  });
});

describe('DEFAULT_PARSE_TIMEOUT_MS', () => {
  it('is a positive number', () => {
    expect(DEFAULT_PARSE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
