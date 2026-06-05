[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RerankerOptions

# Interface: RerankerOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:366](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L366)

Options for [loadReranker](../functions/loadReranker.md).

Mirrors [EmbedderOptions](EmbedderOptions.md) field-for-field so callers wiring both
pipelines together get a uniform surface.
`dtype` is currently fixed at `'q8'` (model_quantized.onnx) by the default
manifest — see `BGE_RERANKER_V2_M3_MANIFEST` JSDoc for the rationale.

## Properties

### allowRemoteModels?

> `optional` **allowRemoteModels?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:377](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L377)

Whether transformers.js may fetch missing files from HF Hub. Set false for fully offline / air-gapped runs.

#### Default

```ts
true
```

***

### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:375](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L375)

Absolute path override; defaults to `<userCacheDir>/mcp-chinese-rag-toolkit/models` (shared with embedder).

***

### manifest?

> `optional` **manifest?**: [`ModelManifest`](ModelManifest.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:373](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L373)

Override the default bge-reranker-v2-m3 manifest. Pass a `ModelManifest`
whose `modelId` is recognised by `@huggingface/transformers`
`AutoModelForSequenceClassification.from_pretrained(modelId)`.

#### Default

```ts
BGE_RERANKER_V2_M3_MANIFEST
```

***

### verifyHashes?

> `optional` **verifyHashes?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:379](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L379)

Hash-verification toggle — never set false in production.

#### Default

```ts
true
```
