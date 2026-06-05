[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / SchemaOptions

# Interface: SchemaOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:69](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L69)

Options for [buildSchema](../functions/buildSchema.md). Writes are idempotent: when called against
an existing index, `embedding_dim` is overwritten (schema invariant) but
`index_version` is preserved.

## Properties

### embeddingDim?

> `optional` **embeddingDim?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:71](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L71)

Vector dimension for `docs_vec` virtual table.

#### Default

```ts
1024 (bge-large-zh-v1.5)
```

***

### indexVersion?

> `optional` **indexVersion?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:76](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L76)

Index version string written into `meta.index_version` when the row does
not yet exist. Used by cache key.

#### Default

`'v1-' + Date.now().toString(36)`
