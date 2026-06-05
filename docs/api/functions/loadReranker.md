[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / loadReranker

# Function: loadReranker()

> **loadReranker**(`opts?`): `Promise`\<[`Reranker`](../interfaces/Reranker.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/reranker.ts:98](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/reranker.ts#L98)

Resolve a fully-initialised [Reranker](../interfaces/Reranker.md) for the requested model.

Lifecycle mirrors [loadEmbedder](loadEmbedder.md):
  1. Resolve cache dir + configure transformers.js env.
  2. Pre-load opportunistic hash check (missing files tolerated so
     transformers.js can download them; size-mismatched partial downloads
     are deleted so the upcoming load can refetch).
  3. Construct `AutoTokenizer` + `AutoModelForSequenceClassification`
     (triggers download + ONNX session init). The `pipeline('text-
     classification', ...)` API is intentionally NOT used here — its
     handling of `text_pair` input has shifted between transformers.js
     4.x minor releases, while the explicit `AutoTokenizer(queries,
     { text_pair: docs })` call is stable.
  4. Post-load strict hash check.

Subsequent calls with the same effective options resolve synchronously
from the in-memory cache.

## Parameters

### opts?

[`RerankerOptions`](../interfaces/RerankerOptions.md) = `{}`

## Returns

`Promise`\<[`Reranker`](../interfaces/Reranker.md)\>
