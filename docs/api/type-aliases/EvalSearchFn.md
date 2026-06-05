[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalSearchFn

# Type Alias: EvalSearchFn

> **EvalSearchFn** = (`query`, `opts?`) => `Promise`\<[`EvalSearchResult`](../interfaces/EvalSearchResult.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:35](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L35)

A `searchFn` evaluated by `runEval`. Mirrors `RerankFn` /
`HybridSearchFn` provider-injection patterns — toolkit eval does
NOT bind to any specific MCP tool; a downstream consumer package / a downstream consumer package / third-party each
wire their own.

## Parameters

### query

`string`

### opts?

#### topK?

`number`

## Returns

`Promise`\<[`EvalSearchResult`](../interfaces/EvalSearchResult.md)[]\>
