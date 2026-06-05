[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / resolveCacheDir

# Function: resolveCacheDir()

> **resolveCacheDir**(`override?`): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/model-loader.ts:58](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/model-loader.ts#L58)

Resolve the toolkit's per-user model cache directory.

- `override` (when provided) is returned as a normalized absolute path —
  the caller owns the full sub-tree, we do NOT append the toolkit subpath.
- Otherwise picks the platform-native cache root, preferring
  `$XDG_CACHE_HOME` everywhere so monorepo CI runners and containerised
  dev environments share a single override surface.

The returned directory is lazily created with `recursive: true` so
downstream `pipeline()` calls can write straight in.

## Parameters

### override?

`string`

## Returns

`string`
