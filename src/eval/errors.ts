// ---------------------------------------------------------------------------
// — Eval error layer: a lean, throwable error type for the eval framework
// ---------------------------------------------------------------------------
//
// This is intentionally separate from the MCP tool error envelope in
// `src/server/errors.ts`. That envelope is RETURNED from a tool call and carries
// transport-facing fields (citations, confidence). Eval errors instead model
// programming / data-contract faults that the eval pipeline should THROW on, so
// they keep only the lean core every consumer needs: a stable code, a message,
// and whether retrying could plausibly help.

import type { EvalSearchResult } from './types.js';

/**
 * Registry of stable eval error codes. SCREAMING_SNAKE_CASE string literals so
 * downstream code can branch on a known set without depending on message text.
 * Declared `as const` and as an object so new codes can be appended later
 * without a breaking change.
 */
export const EVAL_ERROR_CODES = {
  /** A result row reached an answer metric with missing or blank `content`. */
  EVAL_CONTENT_MISSING: 'EVAL_CONTENT_MISSING',
  /**
   * A scoring function received a structurally invalid numeric input — e.g. two
   * embeddings of different length, or a vector containing a non-finite
   * (`NaN` / `±Infinity`) or negative value. These come from a provider-injected
   * embedding function and are not runtime type-checked, so the metric fails
   * loudly here rather than silently producing a meaningless number.
   */
  EVAL_INVALID_METRIC_INPUT: 'EVAL_INVALID_METRIC_INPUT',
  /**
   * A judge returned text that could not be parsed into the expected structured
   * shape — not JSON, valid JSON of the wrong shape, or a wrong value type.
   * Carried by a DEGRADED judge outcome (returned, not thrown). Not retryable:
   * the same prompt against the same judge will most likely be malformed again.
   */
  EVAL_JUDGE_MALFORMED_OUTPUT: 'EVAL_JUDGE_MALFORMED_OUTPUT',
  /**
   * A judge call did not resolve within its wall-clock budget. Carried by a
   * DEGRADED judge outcome (returned, not thrown). Retryable: a timeout is
   * transient, so a later attempt could plausibly succeed.
   */
  EVAL_JUDGE_TIMEOUT: 'EVAL_JUDGE_TIMEOUT',
} as const;

/** Union of the registered eval error codes. */
export type EvalErrorCode = (typeof EVAL_ERROR_CODES)[keyof typeof EVAL_ERROR_CODES];

/**
 * The lean error core carried by a DEGRADED judge outcome — RETURNED inside an
 * outcome object, never thrown. Deliberately NOT the MCP tool error envelope: a
 * judge degrade has no citations, confidence, or suggestions, only a stable
 * code, a diagnostic message, and whether a retry could plausibly help.
 *
 * The field is `error` (the stable code), distinct on purpose from
 * {@link EvalFrameworkError.code} (the THROWN shape). One is a returned degrade,
 * the other is a thrown fault; do not collapse them — `EvalFrameworkError`
 * extends `Error` and would throw, which a degrade must never do.
 */
export interface EvalErrorCore {
  /** Stable SCREAMING_SNAKE error code. */
  error: EvalErrorCode;
  /** Human-readable diagnostic (no PII, no business fields). */
  message: string;
  /** Whether retrying could plausibly help (timeout → true; malformed → false). */
  retryable: boolean;
}

/**
 * Error thrown by the eval framework. Carries a stable {@link EvalErrorCode}
 * and a `retryable` flag (most eval faults are deterministic data/contract bugs
 * that retrying will not fix, so the default is `false`).
 * `instanceof EvalFrameworkError` works as expected across the package.
 *
 * Named `EvalFrameworkError` rather than `EvalError` on purpose: `EvalError` is
 * a built-in JavaScript global, and shadowing it would be a footgun for both
 * this package and its consumers.
 */
export class EvalFrameworkError extends Error {
  readonly code: EvalErrorCode;
  readonly retryable: boolean;

  constructor(code: EvalErrorCode, message: string, opts: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'EvalFrameworkError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    // Keep a correct prototype chain so `instanceof EvalFrameworkError` holds
    // even when compiled down to older targets.
    Object.setPrototypeOf(this, EvalFrameworkError.prototype);
  }
}

/**
 * Factory for {@link EvalFrameworkError}. Defaults `retryable` to `false` —
 * eval errors model deterministic faults (a bad result shape, a blank chunk),
 * not transient conditions.
 */
export function evalError(
  code: EvalErrorCode,
  message: string,
  opts: { retryable?: boolean } = {},
): EvalFrameworkError {
  return new EvalFrameworkError(code, message, opts);
}

/**
 * Assert that a result row actually carries usable `content`, narrowing its type
 * so callers can read `content` as a guaranteed `string` afterwards.
 *
 * Retrieval scoring deliberately allows `content` to be absent (Hit Rate only
 * needs `source` / `page`). Answer-quality metrics — faithfulness, answer
 * relevance, context precision/recall — instead score the actual chunk text, so
 * a missing or blank `content` would silently drag the score down and poison a
 * benchmark. Calling this at the entry to those metrics turns that silent
 * corruption into a loud, locatable {@link EvalFrameworkError}.
 *
 * Throws {@link EvalFrameworkError} with code `EVAL_CONTENT_MISSING` when `content`
 * is unusable — `null`, `undefined`, a non-string value, empty, or
 * whitespace-only. Results come from a provider-injected `searchFn` and are not
 * runtime type-checked, so a non-string `content` can slip past the static type;
 * the `typeof` guard turns that into the same loud error rather than a raw
 * `TypeError`. The message includes the row's `source` (and `section` / `page`
 * when set) so the offending chunk is easy to locate.
 */
export function assertContentPopulated(
  r: EvalSearchResult,
): asserts r is EvalSearchResult & { content: string } {
  if (typeof r.content !== 'string' || r.content.trim() === '') {
    const where = `source="${r.source}"${r.section ? ` section="${r.section}"` : ''}${
      r.page != null ? ` page=${r.page}` : ''
    }`;
    throw evalError(
      'EVAL_CONTENT_MISSING',
      `eval result chunk (${where}) has missing, blank, or non-string content`,
    );
  }
}
