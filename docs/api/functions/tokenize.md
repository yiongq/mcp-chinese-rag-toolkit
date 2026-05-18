[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / tokenize

# Function: tokenize()

> **tokenize**(`text`): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/fts-tokenizer.ts:47](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/fts-tokenizer.ts#L47)

Tokenizes Chinese (or mixed CJK + Latin) input into a space-joined token
string suitable for FTS5's default `unicode61` tokenizer. The output is
the canonical reverse-index payload written into `docs_fts.text_tokens`
by [IndexHandle.indexChunks](../interfaces/IndexHandle.md#indexchunks) and the query payload used by
[IndexHandle.ftsSearch](../interfaces/IndexHandle.md#ftssearch).

Design notes:
- `cut(text, false)` disables HMM unknown-word discovery for **deterministic**
  indexing output (HMM bias is useful for OOV recall in query expansion,
  not for stable BM25 ranking).
- NUL bytes and ASCII control characters are stripped before tokenizing —
  FTS5 / better-sqlite3 binding behaviour around `\0` is platform-dependent
  and easier to neutralize upstream.
- Whitespace-only and punctuation-only tokens are dropped so phrase queries
  built from the output never degenerate into FTS5 parse errors.
- No Latin lowercase / diacritic folding: FTS5's `unicode61 remove_diacritics 1`
  already handles those at index/query time.
- No stopword filter — FTS5 BM25 IDF downweights frequent terms automatically;
  stopword lists would degrade stopword-only queries like "在哪里".

## Parameters

### text

`string`

## Returns

`string`
