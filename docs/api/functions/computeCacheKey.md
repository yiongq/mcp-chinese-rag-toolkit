[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / computeCacheKey

# Function: computeCacheKey()

> **computeCacheKey**(`toolName`, `indexVersion`, `args`): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:65](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/middleware/with-lru-cache.ts#L65)

`sha256(toolName + ':' + indexVersion + ':' + canonicalize(args))` as
lowercase hex. The `':'` delimiter is contract — switching to `'|'` /
`';'` / unicode separators would break cross-version eval
replay (cache keys recorded in fixtures must match new computations).

## Parameters

### toolName

`string`

### indexVersion

`string`

### args

`unknown`

## Returns

`string`
