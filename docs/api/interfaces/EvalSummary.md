[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalSummary

# Interface: EvalSummary

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:105](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L105)

Aggregate eval-set summary, written to summary.json (FR40).

## Properties

### evalSetVersion

> **evalSetVersion**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:107](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L107)

Eval set version (echoed from EvalSet.version).

***

### hitRate

> **hitRate**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:115](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L115)

hits / totalQueries ∈ [0, 1].

***

### hitRateByCategory?

> `optional` **hitRateByCategory?**: `Record`\<`string`, \{ `hitRate`: `number`; `hits`: `number`; `total`: `number`; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:125](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L125)

Aggregate hitRate broken down by category. Present only when at least one
query in the eval set declares a `category`; absent (not empty object)
otherwise so reviewers do not confuse missing aggregation for zero hits.

***

### mrr

> **mrr**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:117](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L117)

Mean Reciprocal Rank ∈ [0, 1].

***

### perQuery

> **perQuery**: [`EvalQueryResult`](EvalQueryResult.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:119](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L119)

Per-query breakdown (also serialized separately as per-query.json).

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:109](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L109)

When the eval ran (ISO 8601 UTC).

***

### topK

> **topK**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:113](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L113)

TopK used for Hit Rate@K computation.

***

### totalQueries

> **totalQueries**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:111](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L111)

Total queries evaluated.
