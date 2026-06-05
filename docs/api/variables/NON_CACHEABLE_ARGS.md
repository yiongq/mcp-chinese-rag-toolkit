[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / NON\_CACHEABLE\_ARGS

# Variable: NON\_CACHEABLE\_ARGS

> `const` **NON\_CACHEABLE\_ARGS**: `Set`\<`string`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:12](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/middleware/with-lru-cache.ts#L12)

Args keys that disable cache writes when present and `!== 'dev'`.
Architecture §缓存策略 L658. Currently a single-element set; future
additions (e.g. `'dryRun'`, `'force'`) APPEND ONLY — never replace the
constant shape, never expose runtime mutation.
