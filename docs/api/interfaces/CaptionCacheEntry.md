[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / CaptionCacheEntry

# Interface: CaptionCacheEntry

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:148](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L148)

Result row returned by `CaptionCache.get` / accepted by `.set`. Internal
cache record shape — exported for test-time introspection.

## Properties

### captionText

> **captionText**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:149](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L149)

***

### createdAt

> **createdAt**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:157](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L157)

ISO 8601 UTC timestamp.

***

### imageSha256

> **imageSha256**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:151](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L151)

sha256(imagePngBytes) — primary lookup key.

***

### modelId

> **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:155](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L155)

***

### promptSha256

> **promptSha256**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:153](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L153)

sha256(promptTemplate) — invalidates on prompt change.

***

### providerId

> **providerId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:154](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L154)
