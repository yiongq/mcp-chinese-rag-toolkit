[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / scoreQuery

# Function: scoreQuery()

> **scoreQuery**(`query`, `topResults`, `opts?`): `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/eval-runner.ts:226](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/eval-runner.ts#L226)

Score a single query: returns hit rank (1-indexed, undefined = miss) +
reciprocal rank. Pure function — easy to test without spinning up a
RAG pipeline.

Semantics:
  - First match in topResults wins (subsequent expected matches ignored).
  - `strict: false` (default): source-only match.
  - `strict: true`: when `expected.page` is set, the result's `page` must
    match exactly; expected entries without a page still match on source
    alone.

## Parameters

### query

[`EvalQuery`](../interfaces/EvalQuery.md)

### topResults

readonly `object`[]

### opts?

#### strict?

`boolean`

## Returns

`object`

### hitRank?

> `optional` **hitRank?**: `number`

### reciprocalRank

> **reciprocalRank**: `number`
