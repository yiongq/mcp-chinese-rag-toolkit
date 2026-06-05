[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CaptionCacheEntry

# Interface: CaptionCacheEntry

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:221](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L221)

Result row returned by `CaptionCache.get` / accepted by `.set`. Internal
cache record shape — exported for test-time introspection.

## Properties

### captionText

> **captionText**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:222](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L222)

***

### createdAt

> **createdAt**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:230](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L230)

ISO 8601 UTC timestamp.

***

### imageSha256

> **imageSha256**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:224](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L224)

sha256(imagePngBytes) — primary lookup key.

***

### modelId

> **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:228](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L228)

***

### promptSha256

> **promptSha256**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:226](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L226)

sha256(promptTemplate) — invalidates on prompt change.

***

### providerId

> **providerId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:227](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L227)
