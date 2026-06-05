[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CaptionCacheOptions

# Interface: CaptionCacheOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:18](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L18)

Caption SQLite cache — DISTINCT from `IndexHandle.db` (main
index file) AND from `withLruCache` L0 tool-result cache.

Architecture §缓存策略 L639 explicitly carves this out: "索引期 plugin
自带的离线 cache 属不同层级，不在此约束内". Reuses `better-sqlite3`
(already in toolkit `dependencies`) but lives in its OWN file under
`<cacheDir>/captions.db` so re-indexing the same PDF with the same
(prompt, provider, model) costs zero LLM tokens.

## Properties

### cacheDir

> **cacheDir**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:20](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L20)

Cache directory; `captions.db` lives at `<cacheDir>/captions.db`.
