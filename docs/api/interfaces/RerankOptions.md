[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankOptions

# Interface: RerankOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:439](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L439)

Options for the bound rerank function returned by `createReranker`.

## Properties

### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:443](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L443)

Forwarded to `reranker.rank()`.

#### Default

```ts
32
```

***

### maxLength?

> `optional` **maxLength?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:445](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L445)

Forwarded to `reranker.rank()`.

#### Default

```ts
512
```

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:441](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L441)

Final reranked top-K cap. Accepts `Infinity` for "return every reranked hit".

#### Default

```ts
5
```
