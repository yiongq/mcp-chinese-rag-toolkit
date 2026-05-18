import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadEvalSet } from '../../../src/eval/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const guidePath = path.resolve(here, '..', '..', '..', 'docs', 'EVAL_GUIDE.md');

describe('docs/EVAL_GUIDE.md YAML examples', () => {
  const md = readFileSync(guidePath, 'utf-8');
  const yamlBlocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');

  it('contains at least 1 YAML eval-set example', () => {
    expect(yamlBlocks.length).toBeGreaterThan(0);
  });

  it('each fenced YAML block parses via Story 2.7 loadEvalSet', async () => {
    expect(yamlBlocks.length).toBeGreaterThan(0);
    for (const [idx, block] of yamlBlocks.entries()) {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'eval-guide-test-'));
      const tmpFile = path.join(tmpDir, `eval-${idx}.yml`);
      writeFileSync(tmpFile, block);
      const set = await loadEvalSet(tmpFile);
      expect(set, `block #${idx} should parse`).toBeTruthy();
      expect(Array.isArray(set.queries)).toBe(true);
    }
  });
});
