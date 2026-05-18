[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / sha256Hex

# Function: sha256Hex()

> **sha256Hex**(`input`): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:210](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts#L210)

Compute the SHA-256 digest of a buffer or string as lowercase hex.
Strings are encoded as UTF-8 before hashing so digests match the
common-case `crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))`
shape and stay stable across platforms.

Exported separately from [CaptionCache.hash](../interfaces/CaptionCache.md#hash) so callers can hash
outside the cache lifecycle (e.g. in tests, or when composing a cache
key before opening the DB).

## Parameters

### input

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

## Returns

`string`
