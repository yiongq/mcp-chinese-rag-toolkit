[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / openIndex

# Function: openIndex()

> **openIndex**(`filePath`, `opts?`): [`IndexHandle`](../interfaces/IndexHandle.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/sqlite-store.ts:125](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/sqlite-store.ts#L125)

Opens (or creates) the SQLite RAG index at `filePath`, loads the `sqlite-vec`
extension on the connection, applies the four-table schema when writable,
and returns an [IndexHandle](../interfaces/IndexHandle.md) wrapping the five storage primitives.

Pass `':memory:'` for an ephemeral in-process database — useful for tests
and for the latency-harness.

Throws (and closes the underlying connection) when:
- the file path is unreachable or extension load fails;
- `readonly: true` is passed against a file whose schema is incomplete;
- `embeddingDim` disagrees with the dimension persisted in a pre-existing index.

## Parameters

### filePath

`string`

### opts?

[`OpenIndexOptions`](../interfaces/OpenIndexOptions.md) = `{}`

## Returns

[`IndexHandle`](../interfaces/IndexHandle.md)
