[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / chunk

# Function: chunk()

> **chunk**(`text`, `opts?`): `Promise`\<[`Chunk`](../interfaces/Chunk.md)[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/chunking.ts:30](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/chunking.ts#L30)

Split text into hierarchical chunks aware of Markdown heading structure.

Algorithm:
 1. Validate `chunkSize` ∈ [100, 4000] and `chunkOverlap` ∈ [0, chunkSize).
 2. Walk the input line-by-line, maintaining a stack of H1–H4 headings;
    emit a `SectionRegion` per heading transition. Heading-only regions
    produce no output.
 3. Per region, defer to `RecursiveCharacterTextSplitter` for character-
    based splitting; each piece inherits the region's `section` plus the
    caller-supplied `source` / `page`.

We hand-roll the section tracker because `@langchain/textsplitters` JS
has no `MarkdownHeaderTextSplitter` equivalent (Python-only). See the
Dev Notes (§Markdown Hierarchical Chunking).

## Parameters

### text

`string`

### opts?

[`ChunkOptions`](../interfaces/ChunkOptions.md) = `{}`

## Returns

`Promise`\<[`Chunk`](../interfaces/Chunk.md)[]\>
