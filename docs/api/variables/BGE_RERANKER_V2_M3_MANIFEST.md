[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / BGE\_RERANKER\_V2\_M3\_MANIFEST

# Variable: BGE\_RERANKER\_V2\_M3\_MANIFEST

> `const` **BGE\_RERANKER\_V2\_M3\_MANIFEST**: [`ModelManifest`](../interfaces/ModelManifest.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/model-manifest.ts:88](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/model-manifest.ts#L88)

Files this toolkit imports from the `onnx-community/bge-reranker-v2-m3-ONNX`
HuggingFace repository when loaded with `dtype: 'q8'`.

Why this repository instead of the Xenova/* organisation: the Xenova fork
of `bge-reranker-v2-m3` is not published on HF Hub (returns 401 to
unauthenticated requests). `onnx-community/bge-reranker-v2-m3-ONNX` is the
canonical transformers.js-compatible publication (transformers.js library
tag, 10k+ downloads, MIT licence inherited from BAAI). See Story 2.5
§架构现实校正 #7 for full rationale.

Why `dtype: 'q8'` (model_quantized.onnx, 570MB) instead of `dtype: 'fp32'`:
upstream fp32 weights are split across `onnx/model.onnx` (stub, 656KB) +
`onnx/model.onnx_data` (external tensor data, 2.27GB) — total download
exceeds 2GB which doubles the CI cache footprint vs Story 2.5's "~568MB
+ ~2GB total" design budget. The q8-quantized variant is a single
self-contained file at 570MB; reranker accuracy degradation from int8
quantisation on the multilingual cross-encoder is <1% NDCG drop on
MIRACL-zh, well within the FR25 / NFR17 `rerankScore < 0.5` low-confidence
threshold safety margin.

`embeddingDim` is set to `1` because bge-reranker-v2-m3 is a
sequence-classification cross-encoder with a single relevance logit
(not a dense-vector model). The field is kept for `ModelManifest`
shape conformance only; callers MUST NOT use `manifest.embeddingDim`
as the reranker output size. See Story 2.5 Dev Notes §6
"embeddingDim:1 sentinel design choice" for the trade-off analysis.

Mirrors `BGE_LARGE_ZH_V1_5_MANIFEST` semantics — extra files in the
cache (README.md, quantize_config.json, the other ONNX dtypes,
`model_int8.onnx`, fp16, q4, etc.) are NOT verified and NOT a tamper
signal.

sha256 values pinned 2026-05-17 via `scripts/fetch-model-manifest.ts
--model onnx-community/bge-reranker-v2-m3-ONNX` against the upstream
commit on `main`. Bump these whenever the upstream model repo publishes
a new revision AND Story 2.7 eval confirms no Hit Rate@5 regression —
never automate the refresh, never fetch the manifest at runtime: the
pinned literal IS the supply-chain boundary.
