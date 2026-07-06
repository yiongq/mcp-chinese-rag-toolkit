// ---------------------------------------------------------------------------
// — Ingest error codes: stable codes RETURNED by `parseDocument`, never thrown
// ---------------------------------------------------------------------------
//
// `parseDocument` is a batch-ingest entry point, so a single malformed file must
// not crash the run: every failure is RETURNED as a discriminated result
// carrying one of these codes, not thrown. This mirrors the lean discriminated
// pattern used by the eval error layer (SCREAMING_SNAKE_CASE literals, declared
// `as const` so new codes append without a breaking change), and is distinct
// from the MCP tool error envelope, which is for tool handlers.

/**
 * Registry of stable ingest error codes. SCREAMING_SNAKE_CASE string literals
 * so downstream code can branch on a known set without depending on message
 * text. Declared `as const` and as an object so new codes can be appended later
 * without a breaking change.
 */
export const INGEST_ERROR_CODES = {
  /** The `mimeType` is outside the whitelisted set of parseable formats. */
  UNSUPPORTED_MIME_TYPE: 'UNSUPPORTED_MIME_TYPE',
  /** The parse did not resolve within the configured wall-clock budget. */
  PARSE_TIMEOUT: 'PARSE_TIMEOUT',
  /** The parser threw on a corrupt / encrypted / malformed input; the native exception was caught and mapped here. */
  PARSE_FAILED: 'PARSE_FAILED',
  /** The parse succeeded but yielded no extractable text (blank / empty document). */
  EMPTY_DOCUMENT: 'EMPTY_DOCUMENT',
} as const;

/** Union of the registered ingest error codes. */
export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[keyof typeof INGEST_ERROR_CODES];
