[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / buildSchema

# Function: buildSchema()

> **buildSchema**(`db`, `opts?`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/schema.ts:50](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/schema.ts#L50)

Initializes the four-table RAG storage schema (idempotent):

- `docs`       — canonical chunk content + provenance (`source` / `page` / `section`).
- `docs_fts`   — FTS5 contentless-with-content reverse index over jieba-pretokenized tokens.
- `docs_vec`   — sqlite-vec `vec0` virtual table holding the per-chunk embedding.
- `meta`       — single-table KV for `index_version` / `embedding_dim` / `embedding_model` / `tokenizer_version`.

**Important**: callers must `sqliteVec.load(db)` before invoking — `docs_vec`'s
`CREATE VIRTUAL TABLE ... USING vec0(...)` requires the vec0 module loaded
on the connection.

Idempotency guarantees:
- All DDL uses `IF NOT EXISTS`.
- `meta.index_version` is written **only** when absent; re-running `buildSchema`
  with a new `indexVersion` does not overwrite an established value (prevents
  accidental Story 2.6 cache invalidation).
- `meta.embedding_dim`: written on first invocation; on subsequent invocations
  a mismatch between the stored value and the caller-supplied opts throws —
  the underlying `docs_vec` `float[N]` is DDL-locked at the first build, so
  silently overwriting meta would let the value drift away from the actual
  on-disk vector schema.
- `meta.embedding_model` / `meta.tokenizer_version`: empty-string placeholders
  are written when absent. Story 2.3 (embedder) and Story 2.4 (query path)
  own the actual values.

## Parameters

### db

`Database`

### opts?

[`SchemaOptions`](../interfaces/SchemaOptions.md) = `{}`

## Returns

`void`
