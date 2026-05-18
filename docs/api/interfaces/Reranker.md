[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / Reranker

# Interface: Reranker

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:407](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L407)

Result returned by [loadReranker](../functions/loadReranker.md).

`rank(query, documents, opts?)` is the canonical surface: it tokenizes
each `(query, document)` pair, runs a batched forward pass through the
cross-encoder, applies sigmoid to the single output logit per pair, and
returns `RankedDocument[]` aligned to the input `documents` array order
(so callers can re-attach their own metadata). Sort / top-K filtering is
the caller's job — see [createReranker](../functions/createReranker.md) for the bound HybridHit
variant that does both.

Unlike [Embedder](Embedder.md) (a bi-encoder that produces a per-document dense
vector and lets the caller compute similarity offline), a cross-encoder
sees the `(query, doc)` pair jointly through full self-attention; this
is why reranking is significantly slower than embedding but also much
more accurate at separating near-duplicate candidates.

## Properties

### modelId

> `readonly` **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:427](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L427)

Echo of the manifest's `modelId` — written to `meta.reranker_model` by [writeRerankerMeta](../functions/writeRerankerMeta.md).

## Methods

### rank()

> **rank**(`query`, `documents`, `opts?`): `Promise`\<[`RankedDocument`](RankedDocument.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:421](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L421)

Score `documents` against `query`. Returns one entry per input document,
in the SAME order (so caller can `documents[i] ←→ scores[i]`).

`opts.batchSize` clamped to `[1, 64]`; cross-encoder is heavier than
the bi-encoder embedder (full attention over `[query | SEP | doc]`),
so the practical batch ceiling is lower than the embedder's 256.

`opts.maxLength` defaults to 512 tokens (bge-reranker-v2-m3 max
positional embedding); pairs longer than this are truncated with
`truncation: 'longest_first'` (drops from the longer side, usually
the document) — matches FlagEmbedding's reference behaviour.

#### Parameters

##### query

`string`

##### documents

`string`[]

##### opts?

###### batchSize?

`number`

###### maxLength?

`number`

#### Returns

`Promise`\<[`RankedDocument`](RankedDocument.md)[]\>
