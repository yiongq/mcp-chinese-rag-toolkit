[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ChunkOptions

# Interface: ChunkOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:33](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L33)

Options controlling the Markdown hierarchical splitter behaviour.

`chunkSize` / `chunkOverlap` units are CHARACTERS, not tokens (consistent
with `@langchain/textsplitters` `RecursiveCharacterTextSplitter`). For
Chinese text 1 character ≈ 0.6 tokens under bge-large-zh-v1.5.

## Properties

### chunkOverlap?

> `optional` **chunkOverlap?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:37](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L37)

#### Default

```ts
200 — range [0, chunkSize); out-of-range throws
```

***

### chunkSize?

> `optional` **chunkSize?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:35](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L35)

#### Default

```ts
1000 — range [100, 4000]; out-of-range throws
```

***

### page?

> `optional` **page?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:41](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L41)

Propagated unchanged to every produced chunk.

***

### source?

> `optional` **source?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:39](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L39)

Propagated unchanged to every produced chunk.
