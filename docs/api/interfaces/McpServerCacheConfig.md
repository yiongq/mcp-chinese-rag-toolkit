[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / McpServerCacheConfig

# Interface: McpServerCacheConfig

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:37](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L37)

— L0 tool-result LRU cache configuration. Supplying
[McpServerCacheConfig.indexVersion](#indexversion) enables the cache; omitting
it (or providing only `{}`) prints a single warning and falls back to
cache-disabled behaviour.

Per §架构现实校正 #4: when `transport: 'http'`, the cache
is per-request (each `connectStreamableHttp` request re-builds the
server) — effectively a no-op. re-evaluated this and
RESOLVED to keep it a no-op by design:  mandates a stateless
HTTP server, and a cross-request L0 cache would reintroduce shared
mutable state. HTTP callers (a downstream consumer package) therefore intentionally omit
`cache`. The cache stays fully effective on stdio (the a downstream consumer package /
a downstream consumer package default consumer).

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:39](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L39)

#### Default

true when `indexVersion` is provided; false otherwise.

***

### indexVersion?

> `optional` **indexVersion?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:49](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L49)

REQUIRED to enable cache. Typically `IndexHandle.getIndexVersion()`
read at startup time so the value is stable for the server's
lifetime (re-reading per call wastes 50-100µs × calls/sec).

***

### max?

> `optional` **max?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:41](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L41)

#### Default

```ts
500 (architecture §缓存策略 L628).
```

***

### ttlMs?

> `optional` **ttlMs?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:43](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L43)

#### Default

```ts
60 * 60 * 1000 (1h).
```
