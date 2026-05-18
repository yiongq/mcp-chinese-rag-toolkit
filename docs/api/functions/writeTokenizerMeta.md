[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / writeTokenizerMeta

# Function: writeTokenizerMeta()

> **writeTokenizerMeta**(`db`, `version?`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/tokenizer-meta.ts:42](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/tokenizer-meta.ts#L42)

Persist the active tokenizer identity into the Story 2.2 `meta` table.

The select-then-insert pair runs inside a `BEGIN IMMEDIATE` transaction so
the mismatch guard is atomic — two processes racing the same `.db` cannot
both observe an empty placeholder and write divergent versions.

`INSERT OR REPLACE` is used so the call is idempotent for the same
tokenizer; if a previous run wrote a DIFFERENT non-empty value (e.g. the
db was indexed with an older jieba release whose dictionary changed),
this function throws — the `docs_fts` reverse index was tokenized with
the original release, so silently overwriting would let
`meta.tokenizer_version` desync from the on-disk index.

The empty-string placeholder written by Story 2.2 `buildSchema` is
treated as "not yet written" and is overwritten without complaint.

Mirrors `writeEmbedderMeta` (Story 2.3) for `meta.embedding_model`.

## Parameters

### db

`Database`

### version?

`string` = `JIEBA_VERSION`

## Returns

`void`

## Throws

if `version` is empty or whitespace-only.

## Throws

if the db does not contain the Story 2.2 `meta` table (caller
  must initialise via `openIndex` / `buildSchema` first).

## Throws

if a different non-empty version is already stored for this index.
