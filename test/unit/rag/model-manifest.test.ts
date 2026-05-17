import { describe, expect, it } from 'vitest';

import { BGE_LARGE_ZH_V1_5_MANIFEST } from '../../../src/rag/model-manifest.js';
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
