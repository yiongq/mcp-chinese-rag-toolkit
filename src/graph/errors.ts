// ---------------------------------------------------------------------------
// Graph-primitive error codes — stable, thrown codes carried on a typed error.
// ---------------------------------------------------------------------------
//
// Mirrors the SCREAMING_SNAKE_CASE `as const` registry pattern used elsewhere so
// downstream code can branch on a known code set without matching message text.
// Declared `as const` and as an object so new codes append without a breaking
// change.

/** Registry of stable graph-primitive error codes. */
export const GRAPH_ERROR_CODES = {
  /** {@link extractGraph} was called with an empty `chunks` array — nothing to extract. */
  EMPTY_CHUNKS: 'EMPTY_CHUNKS',
} as const;

/** Union of the registered graph error codes. */
export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[keyof typeof GRAPH_ERROR_CODES];

/**
 * Typed error raised by the graph primitives. Carries a stable
 * {@link GraphErrorCode} so callers can branch on `err.code`.
 */
export class GraphError extends Error {
  readonly code: GraphErrorCode;

  constructor(code: GraphErrorCode, message: string) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    // Keep a correct prototype chain so `instanceof GraphError` holds even when
    // compiled down to older targets.
    Object.setPrototypeOf(this, GraphError.prototype);
  }
}
