[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalSearchResult

# Interface: EvalSearchResult

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:12](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L12)

Result row returned by an evaluatable `searchFn`. Field naming mirrors
`HybridHit` / `RerankedHit` (camelCase wire convention). All metric fields
are optional — toolkit eval
reports `'n/a'` when missing, never throws (callers may simplify and only
supply `rerankScore`).

## Properties

### content?

> `optional` **content?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:20](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L20)

Chunk content (informational; not used for Hit Rate scoring).

***

### distance?

> `optional` **distance?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:24](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L24)

sqlite-vec L2 distance; populated by hybrid search vec branch.

***

### ftsRank?

> `optional` **ftsRank?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:26](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L26)

FTS5 BM25 rank (1-indexed); populated by hybrid search FTS branch.

***

### page?

> `optional` **page?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L16)

1-indexed page number (mirrors PdfPage / Citation convention).

***

### rerankScore?

> `optional` **rerankScore?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:22](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L22)

bge-reranker-v2-m3 sigmoid score ∈ [0, 1]; populated by reranker.

***

### section?

> `optional` **section?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:18](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L18)

Markdown heading path.

***

### source

> **source**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:14](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L14)

Document source identifier (e.g. `'bench-fixture.md'`). REQUIRED.
