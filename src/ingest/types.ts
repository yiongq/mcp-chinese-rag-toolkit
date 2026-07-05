// ---------------------------------------------------------------------------
// — Document ingest layer: types for the multi-format file → text primitive
// ---------------------------------------------------------------------------
//
// `parseDocument` is the single missing entry point in front of the existing
// "text → Chunk → index" pipeline: it turns an uploaded file (PDF text layer,
// docx, Markdown, or plain text) into a uniform `ParsedDoc` that the existing
// chunkers can consume as-is. It reuses `parsePdf` and the `PdfPage` type from
// the rag layer; it deliberately does NOT re-implement chunking or indexing.

import type { PdfPage } from '../rag/types.js';
import type { IngestErrorCode } from './errors.js';

/**
 * The four whitelisted input formats. Anything outside this set is rejected
 * with an `UNSUPPORTED_MIME_TYPE` result (returned, never thrown). The set is
 * intentionally narrow — parsing is delegated to mature libraries, never
 * hand-rolled, so only formats with a trusted parser are accepted.
 */
export type SupportedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // docx
  | 'text/markdown'
  | 'text/plain';

/**
 * Uniform parse output. Shaped so both existing chunk feeders accept it with
 * no adapter: paginated formats carry `pages` (feed `chunkPdfPages`), streaming
 * formats carry `text` (feed `chunk`, whose Markdown heading tracker turns
 * `#`–`####` headings into a `section` path). Exactly one of `pages` / `text`
 * is present for a successful parse.
 */
export interface ParsedDoc {
  mimeType: SupportedMimeType;
  /** Paginated format (PDF): per-page text, `pageNumber` 1-indexed. Undefined for streaming formats. */
  pages?: PdfPage[];
  /** Streaming format (docx→Markdown / Markdown / plain text): heading-preserving full text. Undefined for PDF. */
  text?: string;
  /**
   * Source encoding detected for a text-byte input (Markdown / plain text).
   * PDF and docx are decoded internally by their parser, so this is undefined
   * for those formats.
   */
  encoding?: 'utf-8' | 'gbk';
}

/** Options for {@link parseDocument}. */
export interface ParseDocumentOptions {
  /**
   * Hard wall-clock ceiling (ms) on how long the caller waits for a parse.
   * On expiry the call resolves to a `PARSE_TIMEOUT` result. Defaults to
   * `DEFAULT_PARSE_TIMEOUT_MS`. See the timeout note in `document-parser.ts`:
   * the underlying parser cannot be truly cancelled, so this bounds the
   * caller's wait, not the CPU work.
   */
  timeoutMs?: number;
}

/**
 * Discriminated result of {@link parseDocument}. Success carries the
 * {@link ParsedDoc}; failure carries a stable {@link IngestErrorCode} and a
 * diagnostic message (no PII, no secrets, no business fields). The parser
 * returns failure rather than throwing so a single bad file never crashes a
 * batch ingest.
 */
export type ParseResult =
  | { ok: true; doc: ParsedDoc }
  | { ok: false; error: IngestErrorCode; message: string };
