import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const quickstartPath = path.resolve(here, '..', '..', '..', 'docs', 'QUICKSTART.md');
const templatePkgPath = path.resolve(
  here,
  '..',
  '..',
  '..',
  'templates',
  'create-mcp-rag',
  'files',
  'rag-basic',
  'package.json',
);
const barrelPath = path.resolve(here, '..', '..', '..', 'src', 'index.ts');

describe('docs/QUICKSTART.md validity', () => {
  const md = readFileSync(quickstartPath, 'utf-8');
  const tpl = JSON.parse(readFileSync(templatePkgPath, 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const barrel = readFileSync(barrelPath, 'utf-8');

  it('uses the canonical npx command (npx -p toolkit create-mcp-rag …)', () => {
    expect(md).toContain('npx -p @yiong/mcp-chinese-rag-toolkit create-mcp-rag');
  });

  it('references only template scripts that actually exist in the scaffolded package.json', () => {
    const referenced = ['pnpm build-index', 'pnpm start:stdio'];
    for (const ref of referenced) {
      expect(md).toContain(ref);
      const scriptName = ref.split(' ')[1];
      expect(
        tpl.scripts,
        `template package.json#scripts.${scriptName} should exist`,
      ).toHaveProperty(scriptName as string);
    }
  });

  it('mentions loadEmbedder hook (which IS exported from the barrel)', () => {
    expect(md).toContain('loadEmbedder');
    expect(barrel).toMatch(/loadEmbedder/);
  });

  it('mentions createHybridSearch / createReranker (both exported from the barrel)', () => {
    expect(md).toMatch(/createHybridSearch/);
    expect(md).toMatch(/createReranker/);
    expect(barrel).toMatch(/createHybridSearch/);
    expect(barrel).toMatch(/createReranker/);
  });

  it('links to the sibling guides (relative path, GitHub UI friendly)', () => {
    expect(md).toMatch(/\(\.\/EVAL_GUIDE\.md\)/);
    expect(md).toMatch(/\(\.\/SCAFFOLD_GUIDE\.md\)/);
  });
});
