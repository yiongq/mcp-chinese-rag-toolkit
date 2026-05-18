[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / McpServerCacheConfig

# Interface: McpServerCacheConfig

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:30](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L30)

Story 2.6 — L0 tool-result LRU cache configuration. Supplying
[McpServerCacheConfig.indexVersion](#indexversion) enables the cache; omitting
it (or providing only `{}`) prints a single warning and falls back to
cache-disabled behaviour (Epic 1 walking-skeleton parity).

Per Story 2.6 §架构现实校正 #4: when `transport: 'http'`, the cache
is currently per-request (each `connectStreamableHttp` request
re-builds the server) — effectively a no-op until Epic 4 Story 4.6
re-evaluates. Cache is fully effective on stdio (the mcp-hr /
mcp-modeling default).

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:32](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L32)

#### Default

true when `indexVersion` is provided; false otherwise.

***

### indexVersion?

> `optional` **indexVersion?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:42](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L42)

REQUIRED to enable cache. Typically `IndexHandle.getIndexVersion()`
read at startup time so the value is stable for the server's
lifetime (re-reading per call wastes 50-100µs × calls/sec).

***

### max?

> `optional` **max?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:34](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L34)

#### Default

```ts
500 (architecture §缓存策略 L628).
```

***

### ttlMs?

> `optional` **ttlMs?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:36](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L36)

#### Default

```ts
60 * 60 * 1000 (1h, FR16).
```
