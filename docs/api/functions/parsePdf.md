[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / parsePdf

# Function: parsePdf()

> **parsePdf**(`input`): `Promise`\<[`ParsePdfResult`](../interfaces/ParsePdfResult.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/pdf-parser.ts:17](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/pdf-parser.ts#L17)

Parse a PDF into per-page text, preserving 1-indexed page numbers.

The function is a thin IO + adapter layer over unpdf — by design it does
NOT swallow errors. Corrupted / encrypted / missing-file inputs surface the
native exception so callers (e.g. a downstream consumer package `scripts/build-index.ts`) decide
how to wrap them into MCP envelopes via `errors.create()`. The toolkit
envelope helper is for tool handlers, not utility functions.

## Parameters

### input

`string` \| `ArrayBuffer` \| `Uint8Array`\<`ArrayBufferLike`\>

File path (`string`), in-memory bytes (`Uint8Array`), or
             `ArrayBuffer` (e.g. from `Blob.arrayBuffer()`).

## Returns

`Promise`\<[`ParsePdfResult`](../interfaces/ParsePdfResult.md)\>
