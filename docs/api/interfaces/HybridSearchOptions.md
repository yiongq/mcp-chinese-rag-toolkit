[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / HybridSearchOptions

# Interface: HybridSearchOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:308](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L308)

Options for the bound query function returned by `createHybridSearch`.

## Properties

### perSourceTopK?

> `optional` **perSourceTopK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:310](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L310)

Per-source candidate cap before RRF fusion (top-N from FTS, top-N from vec).

#### Default

```ts
30
```

***

### rrfK?

> `optional` **rrfK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:314](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L314)

RRF constant.

#### Default

```ts
60 (Cormack 2009 convention)
```

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:312](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L312)

Final fused top-K returned to the caller.

#### Default

```ts
10
```
