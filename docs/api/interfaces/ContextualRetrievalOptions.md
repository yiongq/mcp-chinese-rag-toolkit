[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ContextualRetrievalOptions

# Interface: ContextualRetrievalOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:597](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L597)

Options for `generateChunkContext` (Contextual Retrieval,
 ). Provider injection only — toolkit does NOT bind to a specific
 LLM SDK; see AC5 §design rationale.

## Properties

### cacheKey?

> `optional` **cacheKey?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:606](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L606)

Cache key passed to provider for cache_control identity (e.g. doc
 sha256). Default `'default'`.

***

### fullDocument

> **fullDocument**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:601](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L601)

Source document the chunk was sliced from. Sent ONCE per indexing
 batch with `cache_control: ephemeral`; subsequent chunks reuse the
 cached prefix → ≤ 50% token cost vs uncached.

***

### prefixLength?

> `optional` **prefixLength?**: `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:603](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L603)

Target prefix length range (characters).

#### max

> **max**: `number`

#### min

> **min**: `number`

#### Default

```ts
{ min: 50, max: 100 }
```
