[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / resolveDefaultCaptionCacheDir

# Function: resolveDefaultCaptionCacheDir()

> **resolveDefaultCaptionCacheDir**(): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:63](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-cache.ts#L63)

Resolve the default per-user caption cache directory. Mirrors the
env-paths semantics used by `resolveCacheDir` for the model
cache — same prefer-XDG-CACHE-HOME order — but writes under a sibling
`caption-cache/` subpath so the model cache (multi-GB ONNX files) and
the caption cache (small SQLite DB) never collide.

Returned directory is lazily created with `recursive: true`.

## Returns

`string`
