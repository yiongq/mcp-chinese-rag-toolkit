[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / loadEmbedder

# Function: loadEmbedder()

> **loadEmbedder**(`opts?`): `Promise`\<[`Embedder`](../interfaces/Embedder.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/embedder.ts:71](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/embedder.ts#L71)

Resolve a fully-initialised [Embedder](../interfaces/Embedder.md) for the requested model.

Lifecycle:
  1. Resolve cache dir + configure transformers.js env (singleton, once
     per process).
  2. Pre-load opportunistic hash check: any file already on disk MUST
     match the manifest; missing files are tolerated so transformers.js
     can download them. Size-mismatched files (partial download from a
     previous interrupted run) are deleted so the upcoming pipeline call
     can refetch — see model-loader.ts `verifyModelFiles` rationale.
  3. Construct the feature-extraction pipeline (triggers download +
     ONNX session init).
  4. Post-load strict hash check: every pinned file MUST now exist and
     match. Mismatch → reject + evict the cache entry.

Subsequent calls with the same effective options (manifest fingerprint +
cacheDir + verifyHashes + allowRemoteModels) resolve synchronously from
the in-memory cache.

## Parameters

### opts?

[`EmbedderOptions`](../interfaces/EmbedderOptions.md) = `{}`

## Returns

`Promise`\<[`Embedder`](../interfaces/Embedder.md)\>
