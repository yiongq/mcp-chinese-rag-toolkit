[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / IndexHandle

# Interface: IndexHandle

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:149](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L149)

Storage handle returned by [openIndex](../functions/openIndex.md). Wraps a `better-sqlite3`
connection + `sqlite-vec` extension load + jieba pre-tokenization, and
exposes the five storage primitives consumed by Stories 2.3 / 2.4 / 2.6.

The `db` getter is an escape hatch for advanced use (per-chunk metadata
reads in Story 2.4, etc.); prefer the typed primitives whenever possible.

## Properties

### db

> `readonly` **db**: `Database`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:159](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L159)

Underlying `better-sqlite3` Database. Escape hatch — use the typed primitives first.

## Methods

### close()

> **close**(): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:161](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L161)

Closes the underlying connection. Idempotent.

#### Returns

`void`

***

### ftsSearch()

> **ftsSearch**(`query`, `opts?`): [`FtsHit`](FtsHit.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:153](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L153)

BM25 search over `docs_fts` using jieba-pretokenized query.

#### Parameters

##### query

`string`

##### opts?

[`SearchOptions`](SearchOptions.md)

#### Returns

[`FtsHit`](FtsHit.md)[]

***

### getIndexVersion()

> **getIndexVersion**(): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:157](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L157)

Returns `meta.index_version` (Story 2.6 cache key).

#### Returns

`string`

***

### indexChunks()

> **indexChunks**(`rows`): [`IndexStats`](IndexStats.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:151](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L151)

Insert a batch of chunks. Wrapped in a single transaction (50–100× speedup vs autocommit).

#### Parameters

##### rows

[`ChunkRow`](ChunkRow.md)[]

#### Returns

[`IndexStats`](IndexStats.md)

***

### vecSearch()

> **vecSearch**(`queryEmbedding`, `opts?`): [`VecHit`](VecHit.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:155](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L155)

KNN search over `docs_vec` (sqlite-vec L2 by default).

#### Parameters

##### queryEmbedding

`Float32Array`

##### opts?

[`SearchOptions`](SearchOptions.md)

#### Returns

[`VecHit`](VecHit.md)[]
