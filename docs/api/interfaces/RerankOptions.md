[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankOptions

# Interface: RerankOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:431](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L431)

Options for the bound rerank function returned by `createReranker`.

## Properties

### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:435](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L435)

Forwarded to `reranker.rank()`.

#### Default

```ts
32
```

***

### maxLength?

> `optional` **maxLength?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:437](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L437)

Forwarded to `reranker.rank()`.

#### Default

```ts
512
```

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:433](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L433)

Final reranked top-K cap. Accepts `Infinity` for "return every reranked hit".

#### Default

```ts
5
```
