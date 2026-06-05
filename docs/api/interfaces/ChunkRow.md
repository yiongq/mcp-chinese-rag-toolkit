[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ChunkRow

# Interface: ChunkRow

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:98](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L98)

Single row consumed by [IndexHandle.indexChunks](IndexHandle.md#indexchunks). `embedding.length`
must equal the handle's `embeddingDim` (validated, fail-fast).

## Properties

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:99](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L99)

***

### embedding

> **embedding**: `Float32Array`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:100](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L100)
