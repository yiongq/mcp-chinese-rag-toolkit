[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / createReranker

# Function: createReranker()

> **createReranker**(`deps`): [`RerankFn`](../type-aliases/RerankFn.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/reranker.ts:298](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/reranker.ts#L298)

Build a bound reranker that consumes `HybridHit[]` (Story 2.4 output),
invokes the cross-encoder over `(query, chunk.content)` pairs, sorts by
sigmoid score descending (tie-break: `docId` ascending — Story 2.4 H3
symbol-comparison lesson), and caps at `topK`.

The factory itself is side-effect-free: it validates `defaultOpts` and
freezes a shallow clone (Story 2.4 M1 lesson). Errors thrown by
`reranker.rank` propagate directly to the caller — error normalization
is the responsibility of the surrounding tool handler (per
`docs/conventions.md §2.4`).

## Parameters

### deps

[`RerankerDeps`](../interfaces/RerankerDeps.md)

## Returns

[`RerankFn`](../type-aliases/RerankFn.md)
