[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalQueryResult

# Interface: EvalQueryResult

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:85](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L85)

Per-query result row, captured in summary.json / per-query.json.

## Properties

### category?

> `optional` **category?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:87](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L87)

***

### error?

> `optional` **error?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:101](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L101)

Error message captured when `searchFn` threw or returned an invalid shape
for this query. Present only on failure; the query counts as MISS for Hit
Rate / MRR purposes. Keeps the eval running (FR42 — partial artifact still
uploaded so CI reviewer can see WHICH query crashed without losing the rest).

***

### hitRank?

> `optional` **hitRank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:90](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L90)

First expected hit position in top-K (1-indexed). undefined = miss.

***

### query

> **query**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:86](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L86)

***

### reason?

> `optional` **reason?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:88](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L88)

***

### reciprocalRank

> **reciprocalRank**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:94](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L94)

Reciprocal Rank ∈ [0, 1] for this query (1/hitRank or 0).

***

### topResults

> **topResults**: [`EvalSearchResult`](EvalSearchResult.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:92](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L92)

Top-K results returned by searchFn — verbatim copy for debugging.
