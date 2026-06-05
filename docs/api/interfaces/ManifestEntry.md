[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ManifestEntry

# Interface: ManifestEntry

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:176](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L176)

A single entry inside a [ModelManifest](ModelManifest.md). The (path, sha256, bytes)
triple is the unit of supply-chain pinning consumed by `verifyModelFiles`.

`relativePath` MUST be a POSIX-style path relative to the per-model cache
directory (`<cacheDir>/<modelId>/...`). It is rejected at verify time if it
is absolute, contains `..` segments, or holds NUL / control characters.

## Properties

### bytes

> **bytes**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:182](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L182)

Total file size in bytes — pre-flight check before streaming the full hash.

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:190](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L190)

When `true`, a *missing* file does not fail strict verification: transformers.js
loads the model fine without it (e.g. `special_tokens_map.json` is redundant once
`tokenizer.json` is present, so transformers.js v4.x never downloads it). The
sha256 / byte-length pin is still enforced *if* the file is present in the cache —
`optional` relaxes presence, never integrity.

#### Default

```ts
false
```

***

### relativePath

> **relativePath**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:178](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L178)

Path relative to the per-model cache directory (e.g. `'onnx/model.onnx'`).

***

### sha256

> **sha256**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:180](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L180)

Lowercase hex SHA-256 of the file contents.
