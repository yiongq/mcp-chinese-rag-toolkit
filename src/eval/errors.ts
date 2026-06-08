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
} as const;

/** Union of the registered eval error codes. */
export type EvalErrorCode = (typeof EVAL_ERROR_CODES)[keyof typeof EVAL_ERROR_CODES];

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
