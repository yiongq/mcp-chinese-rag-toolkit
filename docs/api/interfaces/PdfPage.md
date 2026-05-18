[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / PdfPage

# Interface: PdfPage

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:10](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L10)

A single page extracted from a PDF document.

`pageNumber` is 1-indexed to match PDF industry convention and the toolkit
`Citation.page` contract (see `errors.ts`). The conversion from unpdf's
0-indexed internal arrays happens at the `parsePdf()` boundary.

## Properties

### pageNumber

> **pageNumber**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:11](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L11)

***

### text

> **text**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:12](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L12)
