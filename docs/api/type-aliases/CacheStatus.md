[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CacheStatus

# Type Alias: CacheStatus

> **CacheStatus** = `"hit"` \| `"miss"`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:584](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L584)

Status injected at `structuredContent._meta.cache` on every cached
 tool result — `'hit'` when served from cache, `'miss'` when freshly
 computed. The field is ALWAYS present after passing through
 `withLruCache`, so callers (eval / OTel / Inspector) can rely on a
 binary contract instead of a tri-state truthy / missing check.
