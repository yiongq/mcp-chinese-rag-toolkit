[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / IndexingPlugin

# Interface: IndexingPlugin

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:37](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L37)

indexing-time plugin. Hooks fire DURING `pnpm run index`, AFTER
`parsePdf()` produces [PdfPage](PdfPage.md)[] and BEFORE the caller passes the
combined chunk array to the embedder / FTS tokenizer.

The plugin returns ADDITIONAL synthetic chunks which the caller
concatenates with the text chunks produced by `chunkPdfPages()`. Runtime
retrieval path is UNAFFECTED — synthetic chunks live in the same
`docs / docs_fts / docs_vec` tables as text chunks and flow through the
unchanged hybrid + rerank pipeline.

Why a minimal single-hook interface (and not a multi-hook lifecycle):
  - The first plugin only needs pre-chunking enrichment.
  - YAGNI — additional hooks (`enrichChunks` / `postRerank`) land when a
    second plugin actually requires them; over-abstracting now would lock
    the contract before we know the real shape.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:42](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L42)

Plugin identity (kebab-case, e.g. `'vision-caption'`). Used for
structured logging + future cache directory namespacing.

## Methods

### enrichPdf()?

> `optional` **enrichPdf**(`pages`, `ctx`): `Promise`\<[`Chunk`](Chunk.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:48](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L48)

Generate synthetic chunks from a parsed PDF. Optional — additional
lifecycle hooks may grow alongside the interface; absence of `enrichPdf`
means the plugin opts out of pre-chunking enrichment for this run.

#### Parameters

##### pages

[`PdfPage`](PdfPage.md)[]

##### ctx

[`IndexingPluginContext`](IndexingPluginContext.md)

#### Returns

`Promise`\<[`Chunk`](Chunk.md)[]\>
