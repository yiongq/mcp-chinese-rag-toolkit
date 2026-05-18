[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ModelManifest

# Interface: ModelManifest

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:198](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L198)

Hardcoded supply-chain pin for a HuggingFace Hub model used by
[loadEmbedder](../functions/loadEmbedder.md). The list is intentionally narrow — only files the
toolkit actually loads are pinned; extra files in the cache (README, full
PyTorch weights, alternative dtypes) are neither verified nor considered a
tamper signal.

Tracking is always against the upstream `main` branch (the sha256 entries
are the supply-chain boundary, so a per-revision pin is redundant).
`embeddingDim` is the contract value for the model's vector dimension —
`loadEmbedder` exposes it as `Embedder.dim` so the FR20 factory pattern
works for non-1024-dim manifests too.

## Properties

### embeddingDim

> **embeddingDim**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:202](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L202)

Vector dimension produced by the model (e.g. 1024 for bge-large-zh-v1.5, 768 for bge-base-zh, 512 for bge-small-zh).

***

### files

> **files**: readonly [`ManifestEntry`](ManifestEntry.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:204](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L204)

Frozen list of files to verify.

***

### modelId

> **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:200](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L200)

HF Hub repo id consumed by `pipeline('feature-extraction', modelId)`.
