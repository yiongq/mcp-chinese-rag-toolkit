[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / HybridHit

# Interface: HybridHit

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:318](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L318)

A single fused hit returned by the bound hybrid-search function.

Field semantics intentionally mirror the upstream Story 2.2 types:
`bm25Score` is the FTS5 native `rank` column (negative-floor, closer to
0 = more relevant); `distance` is the sqlite-vec L2 distance (lower =
closer). Optional fields are `undefined` when the corresponding source
did not contribute to this hit (single-source survival).

## Extended by

- [`RerankedHit`](RerankedHit.md)

## Properties

### bm25Rank?

> `optional` **bm25Rank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:326](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L326)

1-indexed BM25 position within `ftsSearch` top-N — undefined when only vec hit.

***

### bm25Score?

> `optional` **bm25Score?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:328](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L328)

Mirrors [FtsHit.bm25Score](FtsHit.md#bm25score) — undefined when only vec hit.

***

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:322](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L322)

Chunk content + provenance (source / page / section).

***

### distance?

> `optional` **distance?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:332](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L332)

Mirrors [VecHit.distance](VecHit.md#distance) — undefined when only BM25 hit.

***

### docId

> **docId**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:320](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L320)

`docs.id` — stable per-index identifier.

***

### rrfScore

> **rrfScore**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:324](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L324)

`Σ 1/(rrfK + rank_i)` across whichever sources hit this docId.

***

### vecRank?

> `optional` **vecRank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:330](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L330)

1-indexed vector position within `vecSearch` top-N — undefined when only BM25 hit.
