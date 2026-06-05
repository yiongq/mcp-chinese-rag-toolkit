[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / writeRerankerMeta

# Function: writeRerankerMeta()

> **writeRerankerMeta**(`db`, `reranker`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/reranker-meta.ts:32](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/reranker-meta.ts#L32)

Persist the active reranker's model id into the `meta` table.

Mirrors `writeEmbedderMeta` for `meta.embedding_model` and
`writeTokenizerMeta` for `meta.tokenizer_version`:
`INSERT OR REPLACE` for idempotent same-model writes, but throws if a
DIFFERENT non-empty modelId already exists. Forcing operators to
acknowledge a reranker swap protects downstream eval reproducibility
.

`meta.reranker_model` is provenance / debug only — NOT part of the
cache key (cache key is `(toolName, indexVersion, args)`;
reranker change does not invalidate the FTS / vec stores).

The select-then-insert pair runs inside a `BEGIN IMMEDIATE` transaction so
the mismatch guard is atomic — two processes racing the same `.db` cannot
both observe an empty placeholder and write divergent versions (
M4 lesson applied symmetrically).

The empty-string placeholder written by `buildSchema` is
treated as "not yet written" and is overwritten without complaint.

## Parameters

### db

`Database`

### reranker

[`Reranker`](../interfaces/Reranker.md)

## Returns

`void`

## Throws

if `reranker.modelId` is missing, non-string, empty, or whitespace-only.

## Throws

if the db does not contain the `meta` table (caller
  must initialise via `openIndex` / `buildSchema` first).

## Throws

if a different non-empty modelId is already stored for this index.
