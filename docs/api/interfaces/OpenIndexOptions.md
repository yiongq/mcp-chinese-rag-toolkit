[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / OpenIndexOptions

# Interface: OpenIndexOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:85](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L85)

Options for [openIndex](../functions/openIndex.md). When `readonly` is true the underlying
connection opens in read-only mode and `buildSchema` is skipped — useful
for query-only consumers (e.g. mcp-hr search path) that ship a prebuilt
`.db` inside the npm tarball.

## Properties

### embeddingDim?

> `optional` **embeddingDim?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:89](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L89)

Forwarded to [buildSchema](../functions/buildSchema.md); ignored when `readonly` is true.

#### Default

```ts
1024
```

***

### indexVersion?

> `optional` **indexVersion?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:91](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L91)

Forwarded to [buildSchema](../functions/buildSchema.md).

***

### readonly?

> `optional` **readonly?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:87](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L87)

Open the `.db` read-only. `sqlite-vec` still loads.

#### Default

```ts
false
```
