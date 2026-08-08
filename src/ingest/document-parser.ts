// ---------------------------------------------------------------------------
// — `parseDocument`: multi-format file → uniform `ParsedDoc` (stateless pure fn)
// ---------------------------------------------------------------------------
//
// The one entry point in front of the existing "text → Chunk → index" pipeline.
// It normalizes seven whitelisted formats into a `ParsedDoc` the existing
// chunkers consume directly, delegating all parsing to mature libraries — PDF
// reuses `parsePdf` (unpdf), docx uses mammoth, xlsx uses exceljs, Markdown /
// plain text are byte decode + pass-through, and PNG / JPEG images skip
// parsing entirely (raw bytes pass through for the downstream vision-caption
// stage). No parser is hand-rolled. (The xlsx→Markdown LAYOUT — sheet
// headings + header-repeating table row groups — is ours; the file-format
// parsing itself stays with exceljs.)
//
// Boundaries, deliberately narrow:
//   - PURE BY DEFAULT: with no `onSpan`, input is in-memory bytes; no disk
//     read/write, no env, no console, no wall-clock reads (`Date.now`), no
//     randomness. The only timer used is a `setTimeout` for the caller-wait
//     ceiling (see §timeout), which never leaks into the output value. When an
//     `onSpan` consumer IS provided, the sole added effects are that callback and
//     the clock reads its timing needs — the returned `ParseResult` is identical.
//   - FAILURE IS RETURNED, NOT THROWN: a batch-ingest caller must survive one
//     bad file, so every failure path resolves to a discriminated `ParseResult`
//     carrying a stable code. This is a DELIBERATE departure from `parsePdf`'s
//     no-swallow contract (a lower-level utility that lets its caller wrap), and
//     `parseDocument` is exactly that wrapping caller.
//   - NO BUSINESS FIELDS: no service id / citation / confidence — bytes in, an
//     honest structured result out.

// exceljs is a CJS package whose named exports are invisible to Node's ESM
// named-export detection (like mammoth's), so the runtime-safe import is the
// default binding; the type-only names come in separately below.
import ExcelJS from 'exceljs';
import type { CellValue, Worksheet } from 'exceljs';
import mammoth from 'mammoth';
import { makeSpan, newSpanId, runSpanSafe } from '../observability/span.js';
import type { SpanAttributeValue } from '../observability/span.js';
import { parsePdf } from '../rag/pdf-parser.js';
import { INGEST_ERROR_CODES } from './errors.js';
import type { ParseDocumentOptions, ParseResult, SupportedMimeType } from './types.js';

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;

/** The whitelisted formats, in a single source of truth for the type guard + diagnostics. */
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  DOCX_MIME_TYPE,
  XLSX_MIME_TYPE,
  'text/markdown',
  'text/plain',
  'image/png',
  'image/jpeg',
] as const satisfies readonly SupportedMimeType[];

/**
 * Default hard ceiling (ms) on how long a caller waits for a single parse. Set
 * to the same order of magnitude as the vision-caption per-image timeout — a
 * generous bound tuned only to keep a pathological file from blocking a batch,
 * not a performance target.
 */
export const DEFAULT_PARSE_TIMEOUT_MS = 30_000;

/**
 * Node's timer layer clamps any delay outside `1..2**31-1` down to 1ms — and
 * emits a `TimeoutOverflowWarning` on stderr while doing so. Cap the caller
 * budget at this maximum so an oversized or non-finite `timeoutMs` never
 * silently degrades into a 1ms timer that times out every real parse, and never
 * trips that stderr warning (which would violate the zero-side-effect contract).
 */
const MAX_TIMEOUT_MS = 2_147_483_647; // 2**31 - 1

/** Max characters of untrusted text (a library error or a mimeType) surfaced in a diagnostic message. */
const MAX_ERROR_MESSAGE_CHARS = 200;

/**
 * mammoth's published type definitions omit `convertToMarkdown`, which the
 * runtime has exposed since 1.x. Declare only the slice we call so the usage
 * stays type-checked without depending on the incomplete upstream types.
 */
interface MarkdownConverter {
  convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }>;
}
const mammothMd = mammoth as typeof mammoth & MarkdownConverter;

/**
 * exceljs's published typings bind `Buffer` to the ancient `@types/node` 14 the
 * package pins, which is structurally incompatible with the modern `Buffer`, so
 * its `xlsx.load` signature rejects a current Node `Buffer`. Declare the one
 * method we call against today's types so the usage stays type-checked without
 * inheriting the stale upstream Buffer.
 */
interface XlsxFileLoader {
  load(buffer: Buffer): Promise<unknown>;
}

/**
 * Parse an uploaded document into a uniform {@link ParsedDoc}.
 *
 * Supported `mimeType`s: `application/pdf`, docx
 * (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
 * xlsx (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`),
 * `text/markdown`, `text/plain`, `image/png`, `image/jpeg`. Any other value
 * resolves to an `UNSUPPORTED_MIME_TYPE` result.
 *
 * Always resolves — never rejects. A corrupt / encrypted / malformed input
 * resolves to `PARSE_FAILED`; a parse that outruns the timeout resolves to
 * `PARSE_TIMEOUT`; a parse that yields no extractable text resolves to
 * `EMPTY_DOCUMENT`.
 *
 * Image inputs are never parsed: their bytes pass through as `doc.image` for
 * a downstream vision-caption pipeline (see {@link ParsedDoc.image}), so the
 * only failure an image can produce here is the zero-byte `EMPTY_DOCUMENT`.
 *
 * When `opts.onSpan` is provided, one `ingest.parse` span is emitted per call —
 * for a successful and a failed parse alike — carrying metadata only (mime type,
 * page / text counts, encoding, error code); never any document content.
 *
 * @param buffer   In-memory document bytes.
 * @param mimeType Declared content type; validated against the whitelist.
 * @param opts     See {@link ParseDocumentOptions}.
 */
export async function parseDocument(
  buffer: Uint8Array,
  mimeType: string,
  opts: ParseDocumentOptions = {},
): Promise<ParseResult> {
  const { onSpan } = opts;
  if (!onSpan) return parseDocumentCore(buffer, mimeType, opts);

  // Single observability gate: one span per parse, emitted for success and
  // failure alike (the core never throws — it always resolves a ParseResult).
  const startedAtEpochMs = Date.now();
  const startedPerfMs = performance.now();
  const result = await parseDocumentCore(buffer, mimeType, opts);
  runSpanSafe(
    onSpan,
    makeSpan(
      'ingest.parse',
      { id: newSpanId() },
      startedAtEpochMs,
      performance.now() - startedPerfMs,
      buildParseAttributes(result, mimeType),
    ),
  );
  return result;
}

/**
 * Metadata-only attributes for an `ingest.parse` span. Uses the canonical mime
 * type (a whitelisted enum) rather than the raw caller input, and counts rather
 * than content — never the parsed text itself.
 */
function buildParseAttributes(
  result: ParseResult,
  rawMimeType: string,
): Record<string, SpanAttributeValue> {
  const attributes: Record<string, SpanAttributeValue> = { ok: result.ok };
  const canonical = canonicalizeMimeType(rawMimeType);
  if (canonical !== undefined) attributes.mimeType = canonical;

  if (result.ok) {
    const { doc } = result;
    if (doc.pages !== undefined) {
      attributes.pageCount = doc.pages.length;
      attributes.textLength = doc.pages.reduce((sum, page) => sum + page.text.length, 0);
    }
    if (doc.text !== undefined) attributes.textLength = doc.text.length;
    if (doc.image !== undefined) attributes.imageBytes = doc.image.byteLength;
    if (doc.encoding !== undefined) attributes.encoding = doc.encoding;
  } else {
    attributes.errorCode = result.error;
  }
  return attributes;
}

async function parseDocumentCore(
  buffer: Uint8Array,
  mimeType: string,
  opts: ParseDocumentOptions = {},
): Promise<ParseResult> {
  const canonicalMimeType = canonicalizeMimeType(mimeType);
  if (canonicalMimeType === undefined) {
    return {
      ok: false,
      error: INGEST_ERROR_CODES.UNSUPPORTED_MIME_TYPE,
      message: `unsupported mimeType "${clipText(mimeType)}"; supported: ${SUPPORTED_MIME_TYPES.join(', ')}`,
    };
  }

  // A zero-byte upload is an empty document, not a corrupt one — classify it the
  // same across every format. (parsePdf / mammoth would otherwise throw on empty
  // bytes and surface as PARSE_FAILED, splitting the empty boundary by format.)
  if (buffer.byteLength === 0) return emptyDocument(canonicalMimeType);

  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs);

  // Wrap the dispatch in a resolved promise so BOTH asynchronous rejections and
  // SYNCHRONOUS throws map to a handled PARSE_FAILED — the text branch decodes
  // synchronously (a `TextDecoder('gbk')` on a small-ICU build, or a huge-input
  // `RangeError`, throws before any `.catch` on a raw call could attach), and
  // `parseDocument` must never reject. Even if the timeout wins the race, the
  // pending parse still settles into a handled result, never an unhandled rejection.
  const parsePromise: Promise<ParseResult> = Promise.resolve()
    .then(() => runParse(buffer, canonicalMimeType))
    .catch((err) => ({
      ok: false as const,
      error: INGEST_ERROR_CODES.PARSE_FAILED,
      message: `parse failed for mimeType "${canonicalMimeType}": ${describeError(err)}`,
    }));

  // §timeout: `setTimeout` + `Promise.race` bounds the CALLER's wait only. The
  // underlying libraries do CPU work with no AbortSignal, so a timed-out parse
  // may still run to completion in the background; because this function is
  // side-effect-free, that discarded work is harmless. We do NOT claim to
  // cancel the parse — only to stop waiting on it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ParseResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        error: INGEST_ERROR_CODES.PARSE_TIMEOUT,
        message: `parse exceeded ${timeoutMs}ms budget for mimeType "${mimeType}"`,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([parsePromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Decode text bytes with a UTF-8 → GBK fallback, no external dependency.
 *
 * Strict UTF-8 decode first (the fatal flag rejects invalid sequences and the
 * BOM is stripped automatically); on failure — the typical signal of GBK
 * double-byte content — fall back to GBK via the Node-built-in ICU decoder.
 * This is the pragmatic "most Chinese text files" heuristic; it intentionally
 * avoids pulling in a charset-detection dependency.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'gbk' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' };
  }
}

/**
 * Normalize a declared content type to its canonical whitelisted form, or
 * `undefined` if unsupported. Strips any `; charset=…`-style parameter, trims,
 * and lower-cases (a content type's type/subtype is case-insensitive per the
 * HTTP spec), so a real browser / HTTP value like `text/plain; charset=utf-8`
 * or `Application/PDF` resolves to its whitelisted member instead of a spurious
 * `UNSUPPORTED_MIME_TYPE`.
 */
function canonicalizeMimeType(mimeType: string): SupportedMimeType | undefined {
  const bare = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  return SUPPORTED_MIME_TYPES.find((supported) => supported === bare);
}

/**
 * Coerce an optional caller timeout into a safe `setTimeout` delay. A missing,
 * non-finite (`NaN` / `Infinity`), or non-positive value falls back to the
 * default; a value above Node's maximum delay is clamped to it (see
 * {@link MAX_TIMEOUT_MS}) rather than silently collapsing to a 1ms timer.
 */
function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_PARSE_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

/** Dispatch a whitelisted mimeType to its parser. Native exceptions propagate to the caller's catch. */
function runParse(buffer: Uint8Array, mimeType: SupportedMimeType): Promise<ParseResult> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdfDocument(buffer);
    case DOCX_MIME_TYPE:
      return parseDocxDocument(buffer);
    case XLSX_MIME_TYPE:
      return parseXlsxDocument(buffer);
    case 'image/png':
    case 'image/jpeg':
      return parseImageDocument(buffer, mimeType);
    default:
      // 'text/markdown' | 'text/plain'
      return parseTextDocument(buffer, mimeType);
  }
}

async function parsePdfDocument(buffer: Uint8Array): Promise<ParseResult> {
  // pdf.js (via unpdf) DETACHES the ArrayBuffer it parses, zeroing the caller's
  // view. Parse a private copy so this function never mutates its input — the
  // caller's `buffer` stays intact and re-parseable. `new Uint8Array(buffer)`
  // always copies, even when `buffer` is a Node `Buffer` (whose `.slice()`
  // would return a shared view rather than a copy).
  const { pages } = await parsePdf(new Uint8Array(buffer));
  if (pages.length === 0 || pages.every((page) => page.text.trim() === '')) {
    return emptyDocument('application/pdf');
  }
  return { ok: true, doc: { mimeType: 'application/pdf', pages } };
}

async function parseDocxDocument(buffer: Uint8Array): Promise<ParseResult> {
  // mammoth expects a Node `Buffer`; copy the bytes into one.
  const { value: text } = await mammothMd.convertToMarkdown({ buffer: Buffer.from(buffer) });
  if (text.trim() === '') return emptyDocument(DOCX_MIME_TYPE);
  return { ok: true, doc: { mimeType: DOCX_MIME_TYPE, text } };
}

// --- xlsx → Markdown layout ------------------------------------------------
//
// The layout is designed FOR the downstream character splitter, not for human
// display: every boundary the splitter is likely to cut on is placed where a
// cut is semantically safe.
//   - Each sheet renders as an `# <sheet name>` heading, so the chunker's
//     Markdown heading tracker attributes every chunk to its sheet for free
//     (sheet name = `section` provenance).
//   - Rows render as SMALL Markdown table "row groups" — header row + `|---|`
//     divider + a few data rows — each kept within `MAX_XLSX_GROUP_CHARS` so a
//     typical chunk budget swallows a group whole. Groups are separated by a
//     blank line (`\n\n`, the splitter's first separator), and EVERY group
//     repeats the header row: a chunk cut at a group boundary still carries
//     its column names, so table Q&A never loses them.
//   - A single row longer than the group budget is NOT hard-split here — it
//     becomes a group of its own and the character splitter is the fallback.

/**
 * Soft ceiling (characters) for one rendered row group, header lines included.
 * Sized comfortably under common chunk budgets so a group survives splitting
 * intact; it is a layout target, not a guarantee (see the oversized-row note
 * above).
 */
const MAX_XLSX_GROUP_CHARS = 380;

/**
 * Hard cap on data rows rendered per sheet, guarding against a pathological
 * million-row workbook exploding the output text. Exceeding it is never
 * silent: the sheet ends with an explicit truncation marker paragraph.
 */
const MAX_XLSX_SHEET_ROWS = 20_000;

async function parseXlsxDocument(buffer: Uint8Array): Promise<ParseResult> {
  // exceljs expects a Node `Buffer`; copy the bytes into one (never a shared
  // view), keeping the caller's buffer untouched. Corrupt / non-xlsx bytes make
  // `load` throw, which the caller's catch maps to PARSE_FAILED.
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx as unknown as XlsxFileLoader).load(Buffer.from(buffer));

  const parts: string[] = [];
  for (const worksheet of workbook.worksheets) {
    const { rows, truncated } = readSheetRows(worksheet);
    // A sheet with no non-blank rows contributes nothing — not even a heading,
    // which would otherwise fabricate an empty section.
    if (rows.length === 0) continue;
    parts.push(`# ${foldWhitespace(worksheet.name)}`, ...renderRowGroups(rows));
    if (truncated) parts.push(`[表格截断：仅含前 ${MAX_XLSX_SHEET_ROWS} 行]`);
  }

  if (parts.length === 0) return emptyDocument(XLSX_MIME_TYPE);
  return { ok: true, doc: { mimeType: XLSX_MIME_TYPE, text: parts.join('\n\n') } };
}

/**
 * Read a worksheet into dense rows of sanitized cell text. Blank rows are
 * dropped; reading stops at {@link MAX_XLSX_SHEET_ROWS} kept rows, with
 * `truncated` flagging that at least one further row existed.
 */
function readSheetRows(worksheet: Worksheet): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let truncated = false;
  // `eachRow` visits only rows that exist in the sheet model, in order.
  worksheet.eachRow((row) => {
    if (rows.length >= MAX_XLSX_SHEET_ROWS) {
      truncated = true;
      return;
    }
    const cells: string[] = [];
    for (let col = 1; col <= row.cellCount; col += 1) {
      cells.push(formatCellText(row.getCell(col).value));
    }
    if (cells.every((cell) => cell === '')) return; // blank row: skip
    rows.push(cells);
  });
  return { rows, truncated };
}

/**
 * Render dense rows as header-repeating Markdown table row groups (the layout
 * contract described in the section comment above). The first row is treated
 * as the header; rows are padded to the sheet's widest row so every line has
 * a uniform column count.
 *
 * Single-column sheets are NOT tables — prose-notes sheets (one sentence per
 * row) are a common authoring pattern, and piping them (`| sentence |`)
 * degrades both display (raw pipes in source cards) and rerank (the
 * cross-encoder scores table-ish text lower than prose). They render as plain
 * paragraph groups instead: one line per row, grouped under the same
 * character budget, no header repetition (a single-cell "header" is content).
 */
function renderRowGroups(rows: string[][]): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width <= 1) {
    const groups: string[] = [];
    let group = '';
    for (const row of rows) {
      const line = row[0] ?? '';
      if (line === '') continue;
      if (group !== '' && group.length + 1 + line.length > MAX_XLSX_GROUP_CHARS) {
        groups.push(group);
        group = '';
      }
      group = group === '' ? line : `${group}\n${line}`;
    }
    if (group !== '') groups.push(group);
    return groups;
  }
  const toLine = (row: string[]): string => {
    const padded = [...row, ...Array<string>(width - row.length).fill('')];
    return `| ${padded.join(' | ')} |`;
  };

  // rows is non-empty by the caller's guard; the header block leads every group.
  const headerBlock = `${toLine(rows[0] ?? [])}\n|${'---|'.repeat(width)}`;
  const groups: string[] = [];
  let group = headerBlock;
  let groupHasDataRow = false;

  for (const row of rows.slice(1)) {
    const line = toLine(row);
    // Close the group when this row would overflow the budget — unless the
    // group holds no data row yet, in which case the row stays (an oversized
    // single row is allowed to exceed; the character splitter is the fallback).
    if (groupHasDataRow && group.length + 1 + line.length > MAX_XLSX_GROUP_CHARS) {
      groups.push(group);
      group = headerBlock;
      groupHasDataRow = false;
    }
    group += `\n${line}`;
    groupHasDataRow = true;
  }
  groups.push(group);
  return groups;
}

/** Sanitized single-line Markdown-table text for one cell value. */
function formatCellText(value: CellValue): string {
  return foldWhitespace(formatCellValue(value).replace(/\|/g, '\\|'));
}

/**
 * Flatten any exceljs `CellValue` shape to plain text: strings pass through,
 * numbers / booleans stringify, dates become ISO dates (`yyyy-mm-dd`), formula
 * cells surface their CACHED `result` (this parser never evaluates formulas),
 * rich text concatenates its runs, hyperlinks keep their display text, error
 * cells keep the error literal (`#N/A` etc. — honest, not blank), and
 * null / undefined render empty.
 */
function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((run) => run.text).join('');
  if ('error' in value) return value.error;
  if ('text' in value) return formatCellValue(value.text); // hyperlink display text
  if ('result' in value && value.result !== undefined) return formatCellValue(value.result);
  return ''; // formula with no cached result carries no displayable text
}

/** Collapse every whitespace run that contains a line break into one space, then trim. */
function foldWhitespace(text: string): string {
  return text.replace(/[^\S\r\n]*[\r\n]\s*/g, ' ').trim();
}

function parseTextDocument(
  buffer: Uint8Array,
  mimeType: 'text/markdown' | 'text/plain',
): Promise<ParseResult> {
  const { text, encoding } = decodeText(buffer);
  if (text.trim() === '') return Promise.resolve(emptyDocument(mimeType));
  return Promise.resolve({ ok: true, doc: { mimeType, text, encoding } });
}

/**
 * "Parse" an image by passing its bytes through untouched. Deliberately NO
 * content sniffing — the declared mimeType is trusted exactly like every
 * other format's, and true validity surfaces downstream when the caption
 * stage's decoder consumes the bytes (see {@link ParsedDoc.image}). Zero-byte
 * inputs never reach here: the central EMPTY_DOCUMENT guard in
 * `parseDocumentCore` runs first.
 */
function parseImageDocument(
  buffer: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<ParseResult> {
  return Promise.resolve({ ok: true, doc: { mimeType, image: buffer } });
}

function emptyDocument(mimeType: SupportedMimeType): ParseResult {
  return {
    ok: false,
    error: INGEST_ERROR_CODES.EMPTY_DOCUMENT,
    message: `no extractable text in document with mimeType "${mimeType}"`,
  };
}

/**
 * Clip untrusted text to a bounded length on a code-point boundary. Iterating as
 * code points (not UTF-16 units) means a truncation never splits a surrogate
 * pair into a lone surrogate.
 */
function clipText(text: string): string {
  const chars = [...text];
  return chars.length > MAX_ERROR_MESSAGE_CHARS
    ? `${chars.slice(0, MAX_ERROR_MESSAGE_CHARS).join('')}…`
    : text;
}

/** Extract a short, side-effect-free diagnostic from an unknown thrown value. */
function describeError(err: unknown): string {
  // Guard `.message` being absent (an `Error` can be constructed with an
  // undefined message) so this helper — invoked inside the PARSE_FAILED mapping —
  // can never itself throw and turn a handled failure back into a rejection.
  const raw = err instanceof Error && err.message ? err.message : String(err);
  return clipText(raw);
}
