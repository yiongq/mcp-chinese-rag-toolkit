[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / chunkPdfPages

# Function: chunkPdfPages()

> **chunkPdfPages**(`pages`, `opts?`): `Promise`\<[`Chunk`](../interfaces/Chunk.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/chunking.ts:65](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/chunking.ts#L65)

Chunk an array of `PdfPage` objects, attaching `page` metadata per page.
Blank pages (whitespace-only `text`) are skipped without emitting chunks.

## Parameters

### pages

[`PdfPage`](../interfaces/PdfPage.md)[]

### opts?

`Omit`\<[`ChunkOptions`](../interfaces/ChunkOptions.md), `"page"`\> = `{}`

## Returns

`Promise`\<[`Chunk`](../interfaces/Chunk.md)[]\>
