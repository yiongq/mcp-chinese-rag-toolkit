[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / writeEmbedderMeta

# Function: writeEmbedderMeta()

> **writeEmbedderMeta**(`db`, `embedder`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/embedder.ts:126](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/embedder.ts#L126)

Persist the active embedder's model id into the Story 2.2 `meta` table.

`INSERT OR REPLACE` is used so the call is idempotent for the same model.
If a previous run wrote a DIFFERENT modelId (i.e. the db was originally
indexed with another embedder), this function throws — the vec0 schema is
locked to a particular `embedding_dim` at build time, so swapping the
underlying model would silently desync `meta` from the stored vectors.

The function intentionally does NOT touch `meta.tokenizer_version`
(Story 2.4 owner) or `meta.embedding_dim` (Story 2.2 schema invariant
guarded at open time).

## Parameters

### db

`Database`

### embedder

[`Embedder`](../interfaces/Embedder.md)

## Returns

`void`
