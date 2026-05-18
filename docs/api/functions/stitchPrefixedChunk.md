[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / stitchPrefixedChunk

# Function: stitchPrefixedChunk()

> **stitchPrefixedChunk**(`chunk`, `prefix`): [`Chunk`](../interfaces/Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts:121](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts#L121)

Splice the generated prefix into a chunk by prepending + double-
newline. Indexing-path callers should set
`db.docs.content = stitchPrefixedChunk(chunk, prefix)` BEFORE
running BM25 tokenization / embedding.

Pure function — test / inspection tooling can replay the stitching
without re-querying the LLM. Preserves the input chunk's
`source / page / section` metadata unchanged.

## Parameters

### chunk

[`Chunk`](../interfaces/Chunk.md)

### prefix

`string`

## Returns

[`Chunk`](../interfaces/Chunk.md)
