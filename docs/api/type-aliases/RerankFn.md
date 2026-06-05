[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankFn

# Type Alias: RerankFn

> **RerankFn** = (`query`, `candidates`, `opts?`) => `Promise`\<[`RerankedHit`](../interfaces/RerankedHit.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:467](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L467)

Bound rerank function returned by `createReranker`.

## Parameters

### query

`string`

### candidates

[`HybridHit`](../interfaces/HybridHit.md)[]

### opts?

[`RerankOptions`](../interfaces/RerankOptions.md)

## Returns

`Promise`\<[`RerankedHit`](../interfaces/RerankedHit.md)[]\>
