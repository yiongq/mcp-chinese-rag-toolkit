[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CacheOptions

# Interface: CacheOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:568](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L568)

Options for `withLruCache`. `indexVersion` is REQUIRED — it is the
primary cache-invalidation signal (changes when the underlying SQLite
index is rebuilt; see §schema invariants and
`IndexHandle.getIndexVersion()`).

Omitting `cache` on the parent factory (`createMcpServer`) is equivalent
to `enabled: false`; setting `enabled: false` explicitly is the supported
way to *force* cache off when an `indexVersion` is otherwise available
(unit tests / experiments / Phase 2 hot-reload diagnostics).

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:576](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L576)

Set false in unit tests / experiments.

#### Default

```ts
true
```

***

### indexVersion

> **indexVersion**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:574](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L574)

REQUIRED — typically `IndexHandle.getIndexVersion()` at startup time.

***

### max?

> `optional` **max?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:570](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L570)

Maximum entries per server.

#### Default

```ts
500 (architecture §缓存策略 L628)
```

***

### ttlMs?

> `optional` **ttlMs?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:572](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L572)

TTL in ms.

#### Default

```ts
60 * 60 * 1000 (1h)
```
