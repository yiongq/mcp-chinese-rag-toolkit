[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / HybridSearchOptions

# Interface: HybridSearchOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:300](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L300)

Options for the bound query function returned by `createHybridSearch`.

## Properties

### perSourceTopK?

> `optional` **perSourceTopK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:302](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L302)

Per-source candidate cap before RRF fusion (top-N from FTS, top-N from vec).

#### Default

```ts
30
```

***

### rrfK?

> `optional` **rrfK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:306](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L306)

RRF constant.

#### Default

```ts
60 (Cormack 2009 convention)
```

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:304](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L304)

Final fused top-K returned to the caller.

#### Default

```ts
10
```
