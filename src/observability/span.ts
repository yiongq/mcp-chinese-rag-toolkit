// ---------------------------------------------------------------------------
// Pipeline observability spans — a zero-dependency, opt-in tracing seam.
// ---------------------------------------------------------------------------
//
// The retrieval and ingest pipelines can emit one structured `PipelineSpan` per
// stage they run through, via an injected `onSpan` callback. A consumer bridges
// those spans to any observability backend it likes (its own tracer, a metrics
// sink, a plain log sink) — the toolkit never depends on, nor knows about,
// any tracing SDK. When no `onSpan` is supplied the pipelines read no clock,
// generate no id and allocate no span object: the hot path is unchanged.
//
// Spans carry METADATA ONLY — names, timings, counts, scores, dimensions, format
// enums and error codes. They never carry query text, chunk content, source /
// file names, section titles or any raw bytes: a span is data that leaves the
// process for a backend, so it must be safe to export. The `SpanAttributeValue`
// scalar type makes it impossible to attach a nested object or a content array.
//
// This module is a leaf: it imports nothing from the `rag/` or `ingest/` layers,
// so both can depend on it without creating an import cycle.

import { randomUUID } from 'node:crypto';

/**
 * A span attribute value. Scalars only — a span attribute can never hold an
 * object or array, so no content payload can ride along inside a span.
 */
export type SpanAttributeValue = string | number | boolean;

/**
 * The fixed set of pipeline stage names a span can carry.
 *
 * `retrieve.*` cover the hybrid-search sub-stages plus reranking; `ingest.*`
 * cover document parsing, index building and graph extraction. The
 * `retrieve.hybrid` span is the parent of the `retrieve.bm25` /
 * `retrieve.vector` / `retrieve.rrf` spans.
 */
export type PipelineSpanName =
  | 'retrieve.bm25'
  | 'retrieve.vector'
  | 'retrieve.rrf'
  | 'retrieve.hybrid'
  | 'retrieve.rerank'
  | 'ingest.parse'
  | 'ingest.index'
  | 'ingest.graph';

/**
 * A single pipeline-stage observation.
 *
 * `id` / `parentId` model a span tree. The three hybrid-search sub-stages carry
 * the id of their enclosing `retrieve.hybrid` span as `parentId`; a consumer can
 * graft the whole toolkit subtree under an outer trace by passing its own span
 * id in as the pipeline's `parentSpanId`.
 */
export interface PipelineSpan {
  /** Stage name — one of the fixed {@link PipelineSpanName} literals. */
  name: PipelineSpanName;
  /** Unique id for this span (generated only when a consumer is listening). */
  id: string;
  /** The enclosing span's id, when this span is nested under one. */
  parentId?: string;
  /** Wall-clock start (`Date.now()`), so a bridge can place the span on a timeline. */
  startedAtEpochMs: number;
  /** Elapsed time in milliseconds — a `performance.now()` delta (monotonic). */
  durationMs: number;
  /** Metadata only: counts, scores, dimensions, enums, error codes — never raw content. */
  attributes: Record<string, SpanAttributeValue>;
}

/** A consumer callback, invoked once per completed pipeline stage. */
export type OnSpan = (span: PipelineSpan) => void;

/**
 * Hand a completed span to a consumer without ever letting it disturb the
 * business path.
 *
 * A no-op when `onSpan` is undefined (the zero-overhead gate); a thrown or
 * otherwise faulty consumer is swallowed to a `console.warn`. An observability
 * callback must never change a query or ingest result, so its faults are
 * contained here rather than propagated to the caller.
 */
export function runSpanSafe(onSpan: OnSpan | undefined, span: PipelineSpan): void {
  if (!onSpan) return;
  try {
    onSpan(span);
  } catch (err) {
    console.warn('[onSpan] span consumer threw:', err);
  }
}

/**
 * Generate a span id. Called only from inside an `onSpan` gate — never on the
 * hot path — so the `node:crypto` id generation is paid for only when a consumer
 * is actually listening.
 */
export function newSpanId(): string {
  return randomUUID();
}

/**
 * Coerce an attribute value that `JSON.stringify` cannot round-trip into an
 * export-safe form. A non-finite number (`Infinity` / `-Infinity` / `NaN`)
 * serializes to `null`, silently dropping the value on the wire — a supported
 * "unbounded" `topK` of `Infinity` is the realistic trigger. Rendering it as its
 * string form keeps the information intact and the value serializable, while the
 * scalar {@link SpanAttributeValue} contract is preserved.
 */
function toExportSafe(value: SpanAttributeValue): SpanAttributeValue {
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

/**
 * Return `attributes` with every non-finite numeric value rendered export-safe.
 * The all-finite common case is returned untouched (no allocation); a copy is
 * made only when at least one value needs coercing.
 */
function exportSafeAttributes(
  attributes: Record<string, SpanAttributeValue>,
): Record<string, SpanAttributeValue> {
  let copy: Record<string, SpanAttributeValue> | undefined;
  for (const key of Object.keys(attributes)) {
    const value = attributes[key] as SpanAttributeValue;
    const safe = toExportSafe(value);
    if (safe !== value) {
      if (!copy) copy = { ...attributes };
      copy[key] = safe;
    }
  }
  return copy ?? attributes;
}

/**
 * Build a {@link PipelineSpan}. `parentId` is written onto the object only when
 * defined, so under `exactOptionalPropertyTypes` a root span has a genuinely
 * absent field rather than an explicit `undefined`. Attribute values are
 * normalized so the resulting span is always safe to `JSON.stringify` for export.
 */
export function makeSpan(
  name: PipelineSpanName,
  // `parentId` accepts `undefined` so a caller can forward an optional outer
  // span id directly; the field is then simply omitted from the built span.
  ids: { id: string; parentId?: string | undefined },
  startedAtEpochMs: number,
  durationMs: number,
  attributes: Record<string, SpanAttributeValue>,
): PipelineSpan {
  const span: PipelineSpan = {
    name,
    id: ids.id,
    startedAtEpochMs,
    durationMs,
    attributes: exportSafeAttributes(attributes),
  };
  if (ids.parentId !== undefined) span.parentId = ids.parentId;
  return span;
}
