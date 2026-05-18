[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / VecHit

# Interface: VecHit

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:135](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L135)

Result from [IndexHandle.vecSearch](IndexHandle.md#vecsearch). `distance` is the sqlite-vec
default L2 distance (Story 2.3 may opt into cosine via L2-normalized
embeddings; see Story 2.2 Dev Notes §sqlite-vec distance 语义).

## Properties

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:137](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L137)

***

### distance

> **distance**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:138](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L138)

***

### docId

> **docId**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:136](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L136)
