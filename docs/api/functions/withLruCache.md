[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / withLruCache

# Function: withLruCache()

> **withLruCache**(`toolName`, `handler`, `opts`): [`ToolHandler`](../type-aliases/ToolHandler.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:182](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts#L182)

Wrap a tool handler with the L0 LRU cache.

Returns the original handler unchanged when `opts.enabled === false`
(zero-overhead pass-through; semantically distinct from omitting the
`cache` field on `createMcpServer`, which is the recommended path to
disable cache entirely). The cache instance is per-wrap — two calls
to `withLruCache` produce two independent LRU stores; do NOT share
across tools / index versions.

Lifecycle: the LRUCache is GC-managed (no `dispose()` required); it
disappears with the wrapping closure when the parent
`createMcpServer` handle is closed.

Throw vs envelope: this middleware re-throws inner-handler exceptions
(architecture §AI Agent 强制规则 #5 constrains *tool handler* boundary,
not middleware). The outer `wrapHandler` in `create-mcp-server.ts`
catches and converts to `INTERNAL_ERROR` envelope — see Task 4.5 wrap
order rationale ("cache inside, wrapHandler outside").

## Parameters

### toolName

`string`

### handler

[`ToolHandler`](../type-aliases/ToolHandler.md)

### opts

[`CacheOptions`](../interfaces/CacheOptions.md)

## Returns

[`ToolHandler`](../type-aliases/ToolHandler.md)
