[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ContextualRetrievalOptions

# Interface: ContextualRetrievalOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:589](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L589)

Options for `generateChunkContext` (Story 2.6 Contextual Retrieval,
 FR15). Provider injection only — toolkit does NOT bind to a specific
 LLM SDK; see Story 2.6 AC5 §design rationale.

## Properties

### cacheKey?

> `optional` **cacheKey?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:598](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L598)

Cache key passed to provider for cache_control identity (e.g. doc
 sha256). Default `'default'`.

***

### fullDocument

> **fullDocument**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:593](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L593)

Source document the chunk was sliced from. Sent ONCE per indexing
 batch with `cache_control: ephemeral`; subsequent chunks reuse the
 cached prefix → ≤ 50% token cost vs uncached (FR15).

***

### prefixLength?

> `optional` **prefixLength?**: `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:595](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L595)

Target prefix length range (characters).

#### max

> **max**: `number`

#### min

> **min**: `number`

#### Default

```ts
{ min: 50, max: 100 }
```
