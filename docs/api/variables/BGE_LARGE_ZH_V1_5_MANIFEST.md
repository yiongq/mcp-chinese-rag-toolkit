[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / BGE\_LARGE\_ZH\_V1\_5\_MANIFEST

# Variable: BGE\_LARGE\_ZH\_V1\_5\_MANIFEST

> `const` **BGE\_LARGE\_ZH\_V1\_5\_MANIFEST**: [`ModelManifest`](../interfaces/ModelManifest.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/model-manifest.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/model-manifest.ts#L16)

Files this toolkit actually imports from the `Xenova/bge-large-zh-v1.5`
HuggingFace repository when loaded with the default `dtype: 'fp32'`. Extra
files in the cache (README.md, PyTorch weights, `onnx/model_quantized.onnx`)
are NOT verified and NOT considered a tamper signal — strict verification
after load would otherwise fail for any file we do not actually download.

sha256 values pinned 2026-05-17 via `scripts/fetch-model-manifest.ts`
against the upstream commit on `main`. Bump these whenever the upstream
model repo publishes a new revision AND eval confirms no
Hit Rate@5 regression — never automate the refresh, never fetch the
manifest at runtime: the pinned literal IS the supply-chain boundary.
