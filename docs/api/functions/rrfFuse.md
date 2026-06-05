[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / rrfFuse

# Function: rrfFuse()

> **rrfFuse**\<`T`\>(`sources`, `opts?`): [`FusedRow`](../interfaces/FusedRow.md)\<`T`\>[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/rrf.ts:46](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/rrf.ts#L46)

Reciprocal Rank Fusion (Cormack / Clarke / Büttcher 2009, SIGIR).

Given any number of ranked input lists, accumulates a per-id score of
`Σ 1/(k + rank_i)` across whichever sources contain the id, then sorts
descending by score (ties broken by id ascending for determinism).

The fused output preserves per-source rank lookups and payload pointers
so single-source survival (BDD#2 in ) is observable downstream:
an id that only one source returned ends up with `null` in the other
source's `ranks` / `payloads` slot.

Normalization-free by design — that is the whole point of RRF (Cormack
2009 §3.2 "normalization is the source of degradation"); do not preprocess
BM25 / vec scores into a shared scale before fusing.

Caller contract: every source MUST use ids drawn from the SAME id space
(typically `docs.id` from a shared `IndexHandle`). Fusing lists keyed by
different id spaces (e.g. docId from one index + chunk-index from another)
will collide silently and produce semantically broken fused rows.

## Type Parameters

### T

`T`

## Parameters

### sources

readonly readonly [`RankedRow`](../interfaces/RankedRow.md)\<`T`\>[][]

### opts?

[`RrfOptions`](../interfaces/RrfOptions.md) = `{}`

## Returns

[`FusedRow`](../interfaces/FusedRow.md)\<`T`\>[]
