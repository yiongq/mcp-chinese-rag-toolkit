[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankedHit

# Interface: RerankedHit

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:454](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L454)

Reranked hit — extends `HybridHit` with `rerankScore` and re-orders
candidates by sigmoid relevance score. `rerankScore` is in `[0, 1]`;
 /  `confidence: 'low'` threshold defaults to `< 0.5` and
is enforced at the tool handler layer, not here.

## Extends

- [`HybridHit`](HybridHit.md)

## Properties

### bm25Rank?

> `optional` **bm25Rank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:334](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L334)

1-indexed BM25 position within `ftsSearch` top-N — undefined when only vec hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`bm25Rank`](HybridHit.md#bm25rank)

***

### bm25Score?

> `optional` **bm25Score?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:336](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L336)

Mirrors [FtsHit.bm25Score](FtsHit.md#bm25score) — undefined when only vec hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`bm25Score`](HybridHit.md#bm25score)

***

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:330](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L330)

Chunk content + provenance (source / page / section).

#### Inherited from

[`HybridHit`](HybridHit.md).[`chunk`](HybridHit.md#chunk)

***

### distance?

> `optional` **distance?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:340](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L340)

Mirrors [VecHit.distance](VecHit.md#distance) — undefined when only BM25 hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`distance`](HybridHit.md#distance)

***

### docId

> **docId**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:328](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L328)

`docs.id` — stable per-index identifier.

#### Inherited from

[`HybridHit`](HybridHit.md).[`docId`](HybridHit.md#docid)

***

### rerankScore

> **rerankScore**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:456](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L456)

`sigmoid(cross-encoder logit)` ∈ `[0, 1]`.

***

### rrfScore

> **rrfScore**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:332](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L332)

`Σ 1/(rrfK + rank_i)` across whichever sources hit this docId.

#### Inherited from

[`HybridHit`](HybridHit.md).[`rrfScore`](HybridHit.md#rrfscore)

***

### vecRank?

> `optional` **vecRank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:338](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L338)

1-indexed vector position within `vecSearch` top-N — undefined when only BM25 hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`vecRank`](HybridHit.md#vecrank)
