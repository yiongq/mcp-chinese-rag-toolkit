[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ParsePdfResult

# Interface: ParsePdfResult

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:21](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L21)

Result of parsing a PDF via `parsePdf()`.

`totalPages` mirrors unpdf's metadata; `pages.length === totalPages` is an
enforced post-condition (see pdf-parser tests).

## Properties

### pages

> **pages**: [`PdfPage`](PdfPage.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:23](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L23)

***

### totalPages

> **totalPages**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:22](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L22)
