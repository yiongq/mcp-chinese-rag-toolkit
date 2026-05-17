import type { ModelManifest } from './types.js';

/**
 * Files this toolkit actually imports from the `Xenova/bge-large-zh-v1.5`
 * HuggingFace repository when loaded with the default `dtype: 'fp32'`. Extra
 * files in the cache (README.md, PyTorch weights, `onnx/model_quantized.onnx`)
 * are NOT verified and NOT considered a tamper signal — strict verification
 * after load would otherwise fail for any file we do not actually download.
 *
 * sha256 values pinned 2026-05-17 via `scripts/fetch-model-manifest.ts`
 * against the upstream commit on `main`. Bump these whenever the upstream
 * model repo publishes a new revision AND Story 2.7 eval confirms no
 * Hit Rate@5 regression — never automate the refresh, never fetch the
 * manifest at runtime: the pinned literal IS the supply-chain boundary.
 */
export const BGE_LARGE_ZH_V1_5_MANIFEST: ModelManifest = {
  modelId: 'Xenova/bge-large-zh-v1.5',
  embeddingDim: 1024,
  files: [
    {
      relativePath: 'config.json',
      sha256: 'b8a4dce1dfa153b714eb25c75b18238ef2b12e4755f998457f60cd872483be66',
      bytes: 940,
    },
    {
      relativePath: 'tokenizer.json',
      sha256: '7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839',
      bytes: 439124,
    },
    {
      relativePath: 'tokenizer_config.json',
      sha256: 'e1790949631401af1bfb6c9c7aeec7fcf612e274d73579d99f704faea40c8ba7',
      bytes: 394,
    },
    {
      relativePath: 'special_tokens_map.json',
      sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
      bytes: 125,
    },
    {
      relativePath: 'onnx/model.onnx',
      sha256: '8a78f0b748a6746a0a2ebe0563fddb311762e260abcadaa2b9f19c6964b745fe',
      bytes: 1298376457,
    },
  ],
} as const;

/**
 * Files this toolkit imports from the `onnx-community/bge-reranker-v2-m3-ONNX`
 * HuggingFace repository when loaded with `dtype: 'q8'`.
 *
 * Why this repository instead of the Xenova/* organisation: the Xenova fork
 * of `bge-reranker-v2-m3` is not published on HF Hub (returns 401 to
 * unauthenticated requests). `onnx-community/bge-reranker-v2-m3-ONNX` is the
 * canonical transformers.js-compatible publication (transformers.js library
 * tag, 10k+ downloads, MIT licence inherited from BAAI). See Story 2.5
 * §架构现实校正 #7 for full rationale.
 *
 * Why `dtype: 'q8'` (model_quantized.onnx, 570MB) instead of `dtype: 'fp32'`:
 * upstream fp32 weights are split across `onnx/model.onnx` (stub, 656KB) +
 * `onnx/model.onnx_data` (external tensor data, 2.27GB) — total download
 * exceeds 2GB which doubles the CI cache footprint vs Story 2.5's "~568MB
 * + ~2GB total" design budget. The q8-quantized variant is a single
 * self-contained file at 570MB; reranker accuracy degradation from int8
 * quantisation on the multilingual cross-encoder is <1% NDCG drop on
 * MIRACL-zh, well within the FR25 / NFR17 `rerankScore < 0.5` low-confidence
 * threshold safety margin.
 *
 * `embeddingDim` is set to `1` because bge-reranker-v2-m3 is a
 * sequence-classification cross-encoder with a single relevance logit
 * (not a dense-vector model). The field is kept for `ModelManifest`
 * shape conformance only; callers MUST NOT use `manifest.embeddingDim`
 * as the reranker output size. See Story 2.5 Dev Notes §6
 * "embeddingDim:1 sentinel design choice" for the trade-off analysis.
 *
 * Mirrors `BGE_LARGE_ZH_V1_5_MANIFEST` semantics — extra files in the
 * cache (README.md, quantize_config.json, the other ONNX dtypes,
 * `model_int8.onnx`, fp16, q4, etc.) are NOT verified and NOT a tamper
 * signal.
 *
 * sha256 values pinned 2026-05-17 via `scripts/fetch-model-manifest.ts
 * --model onnx-community/bge-reranker-v2-m3-ONNX` against the upstream
 * commit on `main`. Bump these whenever the upstream model repo publishes
 * a new revision AND Story 2.7 eval confirms no Hit Rate@5 regression —
 * never automate the refresh, never fetch the manifest at runtime: the
 * pinned literal IS the supply-chain boundary.
 */
export const BGE_RERANKER_V2_M3_MANIFEST: ModelManifest = {
  modelId: 'onnx-community/bge-reranker-v2-m3-ONNX',
  embeddingDim: 1,
  files: [
    {
      relativePath: 'config.json',
      sha256: '122e922dcfed6503c8721e6fe1daf090340c3d95ca7f3aa3a72730b321a51cfd',
      bytes: 848,
    },
    {
      relativePath: 'tokenizer.json',
      sha256: '8bf8afbfd11306bd872018c53bfdf2e160a56f8edbcf49933324404791c148d3',
      bytes: 17082900,
    },
    {
      relativePath: 'tokenizer_config.json',
      sha256: 'b87c8703482b0300d3da30e201519aa641f6a450f5eb5bf1e624afbf70c74d80',
      bytes: 1203,
    },
    {
      relativePath: 'special_tokens_map.json',
      sha256: '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
      bytes: 964,
    },
    {
      relativePath: 'onnx/model_quantized.onnx',
      sha256: '912fc1215c2dbff6499700534bd8d31253af01573861abbfc43afd1fab6cce5d',
      bytes: 570727094,
    },
  ],
} as const;
