[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / createHybridSearch

# Function: createHybridSearch()

> **createHybridSearch**(`deps`): [`HybridSearchFn`](../type-aliases/HybridSearchFn.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/hybrid-search.ts:89](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/hybrid-search.ts#L89)

Build a bound hybrid-search function from a `IndexHandle` and a
`Embedder`. The returned function runs `ftsSearch` (BM25 +
jieba) and `embed(query) → vecSearch` (sqlite-vec) in parallel and fuses
the two ranked lists via Reciprocal Rank Fusion (`score = Σ 1/(k + rank)`,
default `k = 60`, Cormack 2009).

The factory itself is side-effect-free w.r.t. db writes: it captures
`handle` / `embedder` / `defaultOpts` in a closure, runs a single read on
`meta.embedding_dim` to fail fast on `(handle, embedder)` dim mismatches,
validates `defaultOpts`, and freezes a shallow clone so later caller-side
mutation cannot drift the effective defaults. Errors thrown by
`embedder.embed`, `handle.ftsSearch`, or `handle.vecSearch` propagate
directly to the caller — error normalization is the responsibility of the
surrounding tool handler (per `docs/conventions.md §2.4`).

## Parameters

### deps

[`HybridSearchDeps`](../interfaces/HybridSearchDeps.md)

## Returns

[`HybridSearchFn`](../type-aliases/HybridSearchFn.md)
