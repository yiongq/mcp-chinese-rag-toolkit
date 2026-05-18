[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EmbedderOptions

# Interface: EmbedderOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:219](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L219)

Options for [loadEmbedder](../functions/loadEmbedder.md).

All fields are optional. `verifyHashes` should never be set to `false` in
production code paths — it exists for test fixtures that mock the pipeline
with synthetic models whose hashes are not under our control.

Note: `dtype` is currently fixed at `'fp32'` because the default manifest
only pins the fp32 ONNX file. Supporting `'q8'` / `'fp16'` would require
pinning the corresponding alternative ONNX files in the manifest — see
`BGE_LARGE_ZH_V1_5_MANIFEST` Dev Notes / Story 2.3 review H2 for context.

## Properties

### allowRemoteModels?

> `optional` **allowRemoteModels?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:229](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L229)

Whether transformers.js may fetch missing files from HF Hub. Set false for fully offline / air-gapped runs.

#### Default

```ts
true
```

***

### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:227](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L227)

Absolute path override; defaults to `<userCacheDir>/mcp-chinese-rag-toolkit/models`.

***

### manifest?

> `optional` **manifest?**: [`ModelManifest`](ModelManifest.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:225](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L225)

Override the default bge-large-zh-v1.5 manifest — keep the value in sync
with a `ModelManifest` whose `modelId` matches the model you intend to
load.

#### Default

```ts
BGE_LARGE_ZH_V1_5_MANIFEST
```

***

### verifyHashes?

> `optional` **verifyHashes?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:231](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L231)

Hash-verification toggle — never set false in production.

#### Default

```ts
true
```
