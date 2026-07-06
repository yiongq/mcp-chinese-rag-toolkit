---
"@yiong/mcp-chinese-rag-toolkit": minor
---

Observability: the retrieval and ingest pipelines can now emit structured `PipelineSpan` events through an optional, injected `onSpan` callback, so you can bridge pipeline timing to any observability backend without the toolkit depending on a tracing SDK (additive, no breaking changes).

Pass `onSpan` on the per-call options of the bound hybrid search (`createHybridSearch`), the bound reranker (`createReranker`), `parseDocument`, or `IndexStore.buildVersion`. Each pipeline stage then emits one span:

- `createHybridSearch` emits a `retrieve.hybrid` parent span with `retrieve.bm25` / `retrieve.vector` / `retrieve.rrf` child spans (each child's `parentId` is the hybrid span's `id`).
- `createReranker` emits a `retrieve.rerank` span (including a zero-candidate span when the input list is empty).
- `parseDocument` emits one `ingest.parse` span per call, for successful and failed parses alike.
- `IndexStore.buildVersion` emits an `ingest.index` span on a successful build.

Each span carries a name, an id and optional `parentId`, `startedAtEpochMs`, `durationMs`, and a scalar-only `attributes` map (counts, scores, dimensions, format enums, error codes). Spans are metadata only — never query text, chunk content, source or file names — so they are safe to export to an external backend. Pass an outer span id via `parentSpanId` to graft the toolkit's spans under your own trace.

When no `onSpan` is provided the pipelines read no clock, mint no id and allocate no span object, so the hot path is unchanged and there is zero overhead. Uses only Node built-ins (`node:crypto`, `performance`, `Date`) — no new dependencies. Exports the `PipelineSpan`, `PipelineSpanName`, `OnSpan` and `SpanAttributeValue` types.
