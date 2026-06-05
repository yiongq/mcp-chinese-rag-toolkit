[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CaptionCache

# Interface: CaptionCache

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:38](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L38)

Plugin-owned caption cache. Single underlying `better-sqlite3` handle;
caller MUST invoke `close()` exactly once (see `with-vision-caption.ts`
try/finally pattern 教训 1).

## Properties

### hash

> `readonly` **hash**: (`buf`) => `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:47](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L47)

Compute SHA-256 hex digest. Re-exported on the cache instance so
callers can hash before they decide whether to spend a provider call.

#### Parameters

##### buf

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`string`

## Methods

### close()

> **close**(): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:49](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L49)

Close the underlying SQLite handle. Idempotent.

#### Returns

`void`

***

### get()

> **get**(`args`): [`CaptionCacheEntry`](CaptionCacheEntry.md) \| `undefined`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:40](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L40)

Look up a cached caption; returns `undefined` on miss.

#### Parameters

##### args

[`CaptionCacheLookup`](CaptionCacheLookup.md)

#### Returns

[`CaptionCacheEntry`](CaptionCacheEntry.md) \| `undefined`

***

### set()

> **set**(`entry`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:42](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L42)

Persist (or replace) a caption row. Idempotent (`INSERT OR REPLACE`).

#### Parameters

##### entry

[`CaptionCacheEntry`](CaptionCacheEntry.md)

#### Returns

`void`
