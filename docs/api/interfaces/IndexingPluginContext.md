[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / IndexingPluginContext

# Interface: IndexingPluginContext

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:13](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L13)

Context passed to [IndexingPlugin.enrichPdf](IndexingPlugin.md#enrichpdf). Lets the plugin call
`unpdf.extractImages(pdfBytes, pageN)` etc. without re-reading the source
file (which the caller already loaded for `parsePdf`).

## Properties

### pdfBytes

> **pdfBytes**: `Uint8Array`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:17](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L17)

Raw PDF bytes (already loaded by caller — DO NOT re-read from disk).

***

### source

> **source**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:15](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L15)

Source identifier propagated to every produced [Chunk.source](Chunk.md#source).
