[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / FtsHit

# Interface: FtsHit

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:123](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L123)

Result from [IndexHandle.ftsSearch](IndexHandle.md#ftssearch).

`bm25Rank` is a 1-indexed position in the returned ordering (consumed by
Story 2.4 RRF `1/(k + rank)`); `bm25Score` is the FTS5-native `rank`
column (negative-floor; closer to 0 = more relevant) and is passed
through verbatim for debugging / threshold filtering.

## Properties

### bm25Rank

> **bm25Rank**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:126](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L126)

***

### bm25Score

> **bm25Score**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:127](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L127)

***

### chunk

> **chunk**: [`Chunk`](Chunk.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:125](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L125)

***

### docId

> **docId**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:124](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L124)
