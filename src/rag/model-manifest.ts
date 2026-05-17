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
