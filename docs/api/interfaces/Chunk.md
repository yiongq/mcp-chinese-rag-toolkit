[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / Chunk

# Interface: Chunk

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:52](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L52)

Output unit of the chunking pipeline.

Field semantics intentionally align with `Citation` (errors.ts):
`content` matches `Citation.content`; `source` / `page` / `section` are
identical in meaning and casing. Downstream snake_case conversion (e.g.
SQLite `docs.text`) happens at the indexing layer, not here.

## Properties

### content

> **content**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:53](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L53)

***

### page?

> `optional` **page?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:55](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L55)

***

### section?

> `optional` **section?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:57](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L57)

Markdown heading path, levels joined by ` > ` (H1–H4 tracked).

***

### source?

> `optional` **source?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:54](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L54)
