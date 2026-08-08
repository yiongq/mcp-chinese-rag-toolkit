import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARSE_TIMEOUT_MS, decodeText, parseDocument } from '../../../src/ingest/document-parser.js';
import { INGEST_ERROR_CODES } from '../../../src/ingest/errors.js';
import type { ParseResult } from '../../../src/ingest/types.js';
import { chunk } from '../../../src/rag/chunking.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const PDF = fileURLToPath(new URL('sample.pdf', FIXTURES));
const DOCX = fileURLToPath(new URL('sample.docx', FIXTURES));
const XLSX = fileURLToPath(new URL('sample.xlsx', FIXTURES));
const MD = fileURLToPath(new URL('sample.md', FIXTURES));
const UTF8_TXT = fileURLToPath(new URL('sample-utf8.txt', FIXTURES));
const GBK_TXT = fileURLToPath(new URL('sample-gbk.txt', FIXTURES));

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MD_MIME = 'text/markdown';
const TXT_MIME = 'text/plain';
const PNG_MIME = 'image/png';
const JPEG_MIME = 'image/jpeg';

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

  it('parses xlsx into sheet-headed Markdown table row groups that repeat the header', async () => {
    const result = await parseDocument(await bytes(XLSX), XLSX_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(XLSX_MIME);
    const text = result.doc.text ?? '';
    expect(text).toContain('# 员工名单');
    expect(text).toContain('# 统计数据');
    expect(result.doc.pages).toBeUndefined();
    expect(result.doc.encoding).toBeUndefined();

    // Layout contract: EVERY row group repeats the header row, so a chunk cut
    // at a group boundary still carries its column names — the fixture's first
    // sheet is sized to overflow one group's budget and force a repetition.
    const headerLines = text.match(/^\| 姓名 \| 部门 \| 职责 \|$/gm) ?? [];
    expect(headerLines.length).toBeGreaterThanOrEqual(2);
    // Groups are separated by a blank line — the splitter's first separator.
    expect(text).toContain('|\n\n| 姓名 | 部门 | 职责 |');
  });

  it('normalizes xlsx cell values (formula result, ISO date, escaped pipe, folded newline)', async () => {
    const result = await parseDocument(await bytes(XLSX), XLSX_MIME);

    assertOk(result);
    const text = result.doc.text ?? '';
    expect(text).toContain('| 256 |'); // formula cell surfaces its CACHED result…
    expect(text).not.toContain('B2*2'); // …never the formula source
    expect(text).toContain('2026-03-15'); // date cell → ISO date
    expect(text).toContain('含 A\\|B 两类内部服务'); // `|` escaped to keep the table well-formed
    expect(text).toContain('第一期 第二期合并统计'); // embedded newline folded to a space
    expect(text).toContain('富文本单元格'); // rich-text runs concatenated
    expect(text).toContain('| true |'); // boolean stringified
  });

  it('parses xlsx into text whose sheet headings become chunk sections', async () => {
    const result = await parseDocument(await bytes(XLSX), XLSX_MIME);

    assertOk(result);
    // AC anchor: the `# <sheet name>` headings drop straight into the existing
    // chunker, which attributes every table chunk to its sheet as `section`.
    const chunks = await chunk(result.doc.text ?? '', { source: 'sample.xlsx' });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.section?.includes('员工名单'))).toBe(true);
    expect(chunks.some((c) => c.section?.includes('统计数据'))).toBe(true);
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

  it('passes image/png bytes through as the image shape (no pages, no text)', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    const result = await parseDocument(pngBytes, PNG_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(PNG_MIME);
    expect(result.doc.image).toEqual(pngBytes);
    expect(result.doc.pages).toBeUndefined();
    expect(result.doc.text).toBeUndefined();
    expect(result.doc.encoding).toBeUndefined();
  });

  it('accepts image/jpeg without sniffing content (validity surfaces at the caption stage)', async () => {
    // Contract parity with every other format: the declared mimeType is
    // trusted, so even non-JPEG bytes parse ok — the downstream caption
    // pipeline's decoder is where a mislabeled image actually fails.
    const notReallyAJpeg = new TextEncoder().encode('not really a jpeg');

    const result = await parseDocument(notReallyAJpeg, JPEG_MIME);

    assertOk(result);
    expect(result.doc.mimeType).toBe(JPEG_MIME);
    expect(result.doc.image).toEqual(notReallyAJpeg);
  });
});

describe('parseDocument — failure paths (returned, never thrown)', () => {
  it('returns UNSUPPORTED_MIME_TYPE for a non-whitelisted mimeType', async () => {
    const result = await parseDocument(new TextEncoder().encode('x'), 'image/gif');

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

  it('returns PARSE_FAILED (not throw) for bytes that are not a valid xlsx', async () => {
    const notAnXlsx = new TextEncoder().encode('these bytes are no zip archive');

    const result = await parseDocument(notAnXlsx, XLSX_MIME);

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.PARSE_FAILED);
  });

  it('renders single-column sheets as plain prose lines (no table pipes)', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('要点说明');
    ws.addRow(['美光 FY2025 的毛利率为 40%，上一财年为 22%。']);
    ws.addRow(['美光 FY2025 净利润为 85.4 亿美元。']);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const result = await parseDocument(bytes, XLSX_MIME);

    assertOk(result);
    const text = result.doc.text ?? '';
    expect(text).toContain('# 要点说明');
    expect(text).toContain('美光 FY2025 的毛利率为 40%，上一财年为 22%。');
    // 单列没有表格语义：不出现管道行/分隔行（防「| 句子 |」污染展示与 rerank）
    expect(text).not.toContain('|');
  });

  it('groups long single-column sheets under the character budget', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('长说明');
    const line = '这是一条足够长的说明句子，用来撑爆单个行组的字符预算并强制分组。'.repeat(4);
    for (let i = 0; i < 8; i += 1) ws.addRow([`${i}：${line}`]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const result = await parseDocument(bytes, XLSX_MIME);

    assertOk(result);
    const blocks = (result.doc.text ?? '').split('\n\n').slice(1); // 掉头部标题
    expect(blocks.length).toBeGreaterThan(1); // 确实分了组
    for (const b of blocks) {
      for (const l of b.split('\n')) expect(l.length).toBeLessThanOrEqual(300);
    }
  });

  it('returns EMPTY_DOCUMENT for a workbook whose sheets hold no cells', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('空表');
    const empty = new Uint8Array(await workbook.xlsx.writeBuffer());

    const result = await parseDocument(empty, XLSX_MIME);

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.EMPTY_DOCUMENT);
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

describe('parseDocument — hardened input handling', () => {
  it('treats an out-of-range timeoutMs (Infinity) as the default, not a 1ms timer', async () => {
    // A raw Infinity / NaN / 0 reaching setTimeout clamps to ~1ms and would time
    // out every real parse; the budget must fall back to the default instead.
    const result = await parseDocument(await bytes(MD), MD_MIME, {
      timeoutMs: Number.POSITIVE_INFINITY,
    });

    assertOk(result);
  });

  it('treats NaN / zero / negative timeoutMs as the default budget (parses succeed)', async () => {
    for (const timeoutMs of [Number.NaN, 0, -1]) {
      const result = await parseDocument(await bytes(UTF8_TXT), TXT_MIME, { timeoutMs });
      assertOk(result);
    }
  });

  it('accepts a Content-Type carrying a charset parameter', async () => {
    const result = await parseDocument(await bytes(UTF8_TXT), 'text/plain; charset=utf-8');

    assertOk(result);
    expect(result.doc.mimeType).toBe(TXT_MIME);
  });

  it('accepts an upper-case mimeType (type/subtype are case-insensitive)', async () => {
    const result = await parseDocument(await bytes(PDF), 'Application/PDF');

    assertOk(result);
    expect(result.doc.mimeType).toBe(PDF_MIME);
    expect(result.doc.pages?.length).toBeGreaterThan(0);
  });

  it('classifies a zero-length buffer as EMPTY_DOCUMENT uniformly across formats', async () => {
    for (const mime of [PDF_MIME, DOCX_MIME, XLSX_MIME, MD_MIME, TXT_MIME, PNG_MIME, JPEG_MIME]) {
      const result = await parseDocument(new Uint8Array(0), mime);
      assertFailed(result);
      expect(result.error).toBe(INGEST_ERROR_CODES.EMPTY_DOCUMENT);
    }
  });

  it('still rejects an unsupported mimeType even after parameter normalization', async () => {
    const result = await parseDocument(new Uint8Array(0), 'image/gif; foo=bar');

    assertFailed(result);
    expect(result.error).toBe(INGEST_ERROR_CODES.UNSUPPORTED_MIME_TYPE);
  });

  it(
    'caps a pathological xlsx sheet at 20000 rows with an explicit truncation marker',
    async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('超长表');
      sheet.addRow(['编号']);
      // Header + 20000 data rows = 20001 non-blank rows: one past the cap.
      for (let i = 1; i <= 20_000; i += 1) sheet.addRow([i]);
      const oversized = new Uint8Array(await workbook.xlsx.writeBuffer());

      const result = await parseDocument(oversized, XLSX_MIME);

      assertOk(result);
      const text = result.doc.text ?? '';
      // Truncation is never silent: the sheet ends with an explicit marker…
      expect(text).toContain('[表格截断：仅含前 20000 行]');
      // …and only the first 20000 rows (header + 19999 data rows) are kept.
      // (single-column pathological sheet → prose lines, no pipes)
      expect(text).toContain('\n19999');
      expect(text).not.toContain('| 20000 |');
    },
    30_000,
  );
});
