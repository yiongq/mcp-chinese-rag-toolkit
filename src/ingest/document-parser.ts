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
