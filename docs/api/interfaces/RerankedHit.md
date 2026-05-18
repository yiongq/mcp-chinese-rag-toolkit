[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankedHit

# Interface: RerankedHit

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:446](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L446)

Reranked hit — extends `HybridHit` with `rerankScore` and re-orders
candidates by sigmoid relevance score. `rerankScore` is in `[0, 1]`;
FR25 / NFR17 `confidence: 'low'` threshold defaults to `< 0.5` and
is enforced at the tool handler layer (Epic 4 mcp-hr), not here.

## Extends

- [`HybridHit`](HybridHit.md)

## Properties

### bm25Rank?

> `optional` **bm25Rank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:326](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L326)

1-indexed BM25 position within `ftsSearch` top-N — undefined when only vec hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`bm25Rank`](HybridHit.md#bm25rank)

***

### bm25Score?

> `optional` **bm25Score?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:328](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L328)

Mirrors [FtsHit.bm25Score](FtsHit.md#bm25score) — undefined when only vec hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`bm25Score`](HybridHit.md#bm25score)

***

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:322](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L322)

Chunk content + provenance (source / page / section).

#### Inherited from

[`HybridHit`](HybridHit.md).[`chunk`](HybridHit.md#chunk)

***

### distance?

> `optional` **distance?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:332](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L332)

Mirrors [VecHit.distance](VecHit.md#distance) — undefined when only BM25 hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`distance`](HybridHit.md#distance)

***

### docId

> **docId**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:320](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L320)

`docs.id` — stable per-index identifier.

#### Inherited from

[`HybridHit`](HybridHit.md).[`docId`](HybridHit.md#docid)

***

### rerankScore

> **rerankScore**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:448](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L448)

`sigmoid(cross-encoder logit)` ∈ `[0, 1]`.

***

### rrfScore

> **rrfScore**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:324](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L324)

`Σ 1/(rrfK + rank_i)` across whichever sources hit this docId.

#### Inherited from

[`HybridHit`](HybridHit.md).[`rrfScore`](HybridHit.md#rrfscore)

***

### vecRank?

> `optional` **vecRank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:330](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L330)

1-indexed vector position within `vecSearch` top-N — undefined when only BM25 hit.

#### Inherited from

[`HybridHit`](HybridHit.md).[`vecRank`](HybridHit.md#vecrank)
