[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / runEval

# Function: runEval()

> **runEval**(`evalSet`, `opts`): `Promise`\<[`EvalSummary`](../interfaces/EvalSummary.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/eval-runner.ts:258](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/eval-runner.ts#L258)

Run an eval set against a `searchFn`, returning the full [EvalSummary](../interfaces/EvalSummary.md)
for serialization by ci-helper.ts. Provider-injection — toolkit does NOT
bind to any specific MCP tool (mcp-hr Story 4.5 / mcp-modeling Story 6.7
each wire their own).

Hit Rate@K is defined as `hits / totalQueries`; MRR@K is the average of
per-query reciprocal ranks (Manning & Raghavan §8.4 standard).

## Parameters

### evalSet

[`EvalSet`](../interfaces/EvalSet.md)

### opts

[`EvalRunnerOptions`](../interfaces/EvalRunnerOptions.md)

## Returns

`Promise`\<[`EvalSummary`](../interfaces/EvalSummary.md)\>
