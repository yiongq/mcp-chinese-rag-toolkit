import { describe, expect, it } from 'vitest';

import {
  BGE_LARGE_ZH_V1_5_MANIFEST,
  BGE_RERANKER_V2_M3_MANIFEST,
} from '../../../src/rag/model-manifest.js';
import type { ManifestEntry, ModelManifest } from '../../../src/rag/types.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;

describe('BGE_LARGE_ZH_V1_5_MANIFEST', () => {
  it('exposes the expected modelId, embeddingDim, and pinned file count', () => {
    expect(BGE_LARGE_ZH_V1_5_MANIFEST.modelId).toBe('Xenova/bge-large-zh-v1.5');
    expect(BGE_LARGE_ZH_V1_5_MANIFEST.embeddingDim).toBe(1024);
    // Default dtype `fp32` loads 5 files (config + tokenizer triple + model.onnx);
    // `model_quantized.onnx` is intentionally absent — pinning it would break the
    // strict post-load verification for any non-q8 dtype.
    expect(BGE_LARGE_ZH_V1_5_MANIFEST.files).toHaveLength(5);
    for (const entry of BGE_LARGE_ZH_V1_5_MANIFEST.files) {
      expect(entry.sha256).toMatch(SHA256_HEX);
    }
  });

  it('rejects path-traversal characters in pinned entries (manifest tamper guard)', () => {
    for (const entry of BGE_LARGE_ZH_V1_5_MANIFEST.files) {
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.relativePath.startsWith('/')).toBe(false);
      expect(entry.relativePath.includes('..')).toBe(false);
      expect(entry.relativePath.includes('\\')).toBe(false);
    }
  });

  it('exports the ModelManifest / ManifestEntry types for downstream consumers', () => {
    const m: ModelManifest = BGE_LARGE_ZH_V1_5_MANIFEST;
    const first: ManifestEntry | undefined = m.files[0];
    expect(first).toBeDefined();
  });

  it('marks special_tokens_map.json optional (transformers.js v4.x skips it when tokenizer.json is present)', () => {
    const entry = BGE_LARGE_ZH_V1_5_MANIFEST.files.find(
      (f) => f.relativePath === 'special_tokens_map.json',
    );
    expect(entry?.optional).toBe(true);
    // every other pinned file stays required (presence enforced under strict verify)
    for (const f of BGE_LARGE_ZH_V1_5_MANIFEST.files) {
      if (f.relativePath !== 'special_tokens_map.json') expect(f.optional ?? false).toBe(false);
    }
  });

  it('is structurally frozen via `as const` (compile-time mutation rejected)', () => {
    // Compile-time check only; never invoked to avoid runtime side-effects
    // (TypeScript `readonly` does not freeze the array at runtime).
    function _compileTimeOnly(): void {
      // @ts-expect-error — manifest.files is readonly, push should be a compile error
      BGE_LARGE_ZH_V1_5_MANIFEST.files.push({
        relativePath: 'evil',
        sha256: '0'.repeat(64),
        bytes: 1,
      });
    }
    expect(typeof _compileTimeOnly).toBe('function');
  });
});

describe('BGE_RERANKER_V2_M3_MANIFEST', () => {
  it('exposes the canonical onnx-community modelId, sentinel embeddingDim=1, and 5 pinned files', () => {
    // Why onnx-community/* instead of Xenova/* — see §架构现实校正 #7:
    // the Xenova fork was never published on HF Hub (401 to anonymous fetch).
    expect(BGE_RERANKER_V2_M3_MANIFEST.modelId).toBe('onnx-community/bge-reranker-v2-m3-ONNX');
    // `embeddingDim: 1` is a sentinel — bge-reranker outputs a single logit
    // (sequence-classification), not a dense vector. See Dev Notes §6.
    expect(BGE_RERANKER_V2_M3_MANIFEST.embeddingDim).toBe(1);
    // Default dtype `q8` loads 5 files (config + tokenizer triple + model_quantized.onnx);
    // upstream fp32 weights split across model.onnx + model.onnx_data total
    // >2GB and are intentionally NOT pinned for the CI cache budget.
    expect(BGE_RERANKER_V2_M3_MANIFEST.files).toHaveLength(5);
    for (const entry of BGE_RERANKER_V2_M3_MANIFEST.files) {
      expect(entry.sha256).toMatch(SHA256_HEX);
      expect(entry.bytes).toBeGreaterThan(0);
    }
  });

  it('pins onnx/model_quantized.onnx (570MB q8 single file) — NOT fp32 external-data layout', () => {
    const onnxEntry = BGE_RERANKER_V2_M3_MANIFEST.files.find(
      (f) => f.relativePath === 'onnx/model_quantized.onnx',
    );
    expect(onnxEntry).toBeDefined();
    // 570MB ±10% sanity bracket — guards against future manifest refresh
    // accidentally pinning the wrong dtype (e.g. swapping for fp16).
    expect(onnxEntry?.bytes).toBeGreaterThan(500_000_000);
    expect(onnxEntry?.bytes).toBeLessThan(700_000_000);
  });

  it('rejects path-traversal characters in pinned entries (manifest tamper guard)', () => {
    for (const entry of BGE_RERANKER_V2_M3_MANIFEST.files) {
      expect(entry.relativePath.startsWith('/')).toBe(false);
      expect(entry.relativePath.includes('..')).toBe(false);
      expect(entry.relativePath.includes('\\')).toBe(false);
    }
  });

  it('marks special_tokens_map.json optional (transformers.js v4.x skips it when tokenizer.json is present)', () => {
    const entry = BGE_RERANKER_V2_M3_MANIFEST.files.find(
      (f) => f.relativePath === 'special_tokens_map.json',
    );
    expect(entry?.optional).toBe(true);
    for (const f of BGE_RERANKER_V2_M3_MANIFEST.files) {
      if (f.relativePath !== 'special_tokens_map.json') expect(f.optional ?? false).toBe(false);
    }
  });

  it('embedderDim sentinel does NOT collide with bge-large-zh-v1.5 manifest dim', () => {
    // Defensive cross-check — if a future refactor accidentally re-uses the
    // embedder dim (1024) for the reranker, callers reading
    // `manifest.embeddingDim` as the reranker output size would silently
    // produce arrays of wrong length. The sentinel `1` must stay distinct.
    expect(BGE_RERANKER_V2_M3_MANIFEST.embeddingDim).not.toBe(
      BGE_LARGE_ZH_V1_5_MANIFEST.embeddingDim,
    );
  });
});
