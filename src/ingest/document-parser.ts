// ---------------------------------------------------------------------------
// — `parseDocument`: multi-format file → uniform `ParsedDoc` (stateless pure fn)
// ---------------------------------------------------------------------------
//
// The one entry point in front of the existing "text → Chunk → index" pipeline.
// It normalizes four whitelisted formats into a `ParsedDoc` the existing
// chunkers consume directly, delegating all parsing to mature libraries — PDF
// reuses `parsePdf` (unpdf), docx uses mammoth, Markdown / plain text are byte
// decode + pass-through. No parser is hand-rolled.
//
// Boundaries, deliberately narrow:
//   - PURE, ZERO SIDE EFFECTS: input is in-memory bytes; no disk read/write, no
//     env, no console, no wall-clock reads (`Date.now`), no randomness. The only
//     timer used is a `setTimeout` for the caller-wait ceiling (see §timeout),
//     which never leaks into the output value.
//   - FAILURE IS RETURNED, NOT THROWN: a batch-ingest caller must survive one
//     bad file, so every failure path resolves to a discriminated `ParseResult`
//     carrying a stable code. This is a DELIBERATE departure from `parsePdf`'s
//     no-swallow contract (a lower-level utility that lets its caller wrap), and
//     `parseDocument` is exactly that wrapping caller.
//   - NO BUSINESS FIELDS: no service id / citation / confidence — bytes in, an
//     honest structured result out.

import mammoth from 'mammoth';
import { parsePdf } from '../rag/pdf-parser.js';
import { INGEST_ERROR_CODES } from './errors.js';
import type { ParseDocumentOptions, ParseResult, SupportedMimeType } from './types.js';

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

/** The whitelisted formats, in a single source of truth for the type guard + diagnostics. */
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  DOCX_MIME_TYPE,
  'text/markdown',
  'text/plain',
] as const satisfies readonly SupportedMimeType[];

/**
 * Default hard ceiling (ms) on how long a caller waits for a single parse. Set
 * to the same order of magnitude as the vision-caption per-image timeout — a
 * generous bound tuned only to keep a pathological file from blocking a batch,
 * not a performance target.
 */
export const DEFAULT_PARSE_TIMEOUT_MS = 30_000;

/** Max characters of an underlying library error surfaced in a diagnostic message. */
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
 * Parse an uploaded document into a uniform {@link ParsedDoc}.
 *
 * Supported `mimeType`s: `application/pdf`, docx
 * (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
 * `text/markdown`, `text/plain`. Any other value resolves to an
 * `UNSUPPORTED_MIME_TYPE` result.
 *
 * Always resolves — never rejects. A corrupt / encrypted / malformed input
 * resolves to `PARSE_FAILED`; a parse that outruns the timeout resolves to
 * `PARSE_TIMEOUT`; a parse that yields no extractable text resolves to
 * `EMPTY_DOCUMENT`.
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
  if (!isSupportedMimeType(mimeType)) {
    return {
      ok: false,
      error: INGEST_ERROR_CODES.UNSUPPORTED_MIME_TYPE,
      message: `unsupported mimeType "${mimeType}"; supported: ${SUPPORTED_MIME_TYPES.join(', ')}`,
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;

  // Catch native parser exceptions here so `parsePromise` never rejects — even
  // if the timeout wins the race, the pending parse settles into a handled
  // result and never surfaces as an unhandled rejection.
  const parsePromise: Promise<ParseResult> = runParse(buffer, mimeType).catch((err) => ({
    ok: false as const,
    error: INGEST_ERROR_CODES.PARSE_FAILED,
    message: `parse failed for mimeType "${mimeType}": ${describeError(err)}`,
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

function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Dispatch a whitelisted mimeType to its parser. Native exceptions propagate to the caller's catch. */
function runParse(buffer: Uint8Array, mimeType: SupportedMimeType): Promise<ParseResult> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdfDocument(buffer);
    case DOCX_MIME_TYPE:
      return parseDocxDocument(buffer);
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

function parseTextDocument(
  buffer: Uint8Array,
  mimeType: 'text/markdown' | 'text/plain',
): Promise<ParseResult> {
  const { text, encoding } = decodeText(buffer);
  if (text.trim() === '') return Promise.resolve(emptyDocument(mimeType));
  return Promise.resolve({ ok: true, doc: { mimeType, text, encoding } });
}

function emptyDocument(mimeType: SupportedMimeType): ParseResult {
  return {
    ok: false,
    error: INGEST_ERROR_CODES.EMPTY_DOCUMENT,
    message: `no extractable text in document with mimeType "${mimeType}"`,
  };
}

/** Extract a short, side-effect-free diagnostic from an unknown thrown value. */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_ERROR_MESSAGE_CHARS ? `${raw.slice(0, MAX_ERROR_MESSAGE_CHARS)}…` : raw;
}
