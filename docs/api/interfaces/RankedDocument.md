[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RankedDocument

# Interface: RankedDocument

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:383](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L383)

Single rank result returned by [Reranker.rank](Reranker.md#rank).

`score` is `sigmoid(logit)` — bge-reranker-v2-m3 is a single-class
sequence-classification model that emits one logit per `(query, doc)`
pair; `sigmoid` converts that into a `[0, 1]` relevance probability.
The FR25 / NFR17 `confidence: 'low'` threshold defaults to `< 0.5`
and is enforced at the tool handler layer (Epic 4 mcp-hr), not here.

## Properties

### index

> **index**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:385](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L385)

Position in the input `documents` array (0-indexed).

***

### score

> **score**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:387](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L387)

`sigmoid(logit)` ∈ `[0, 1]` — relevance probability.
