/**
 * Story 2.9 smoke — runs scaffoldProject() against tmpdir with skipInstall +
 * skipGitInit, verifies the generated tree, then cleans up. NOT wired to CI
 * (Story 2.7 lesson 8 — CI is a behavioral gate, not a money pit). Run
 * before opening PRs that touch scaffold internals:
 *
 *   pnpm smoke:scaffold
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../bin/scaffold.js';

const REQUIRED_FILES = [
  'package.json',
  'tsconfig.json',
  'README.md',
  '.gitignore',
  'src/server.ts',
  'scripts/build-index.ts',
  'data/sample-doc.md',
  'eval/eval-set.yml',
];

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'create-mcp-rag-smoke-'));
  const originalCwd = process.cwd();
  process.chdir(root);
  const projectName = 'smoke-mcp-oa';
  try {
    await scaffoldProject({
      projectName,
      template: 'rag-basic',
      packageManager: 'pnpm',
      skipInstall: true,
      skipGitInit: true,
    });
    const target = path.join(root, projectName);

    for (const rel of REQUIRED_FILES) {
      const abs = path.join(target, rel);
      if (!statSync(abs).isFile()) {
        throw new Error(`missing or non-file: ${abs}`);
      }
    }

    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf-8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    if (pkg.name !== projectName) {
      throw new Error(`package.json#name not replaced: ${pkg.name}`);
    }
    const toolkitDep = pkg.dependencies['@yiong/mcp-chinese-rag-toolkit'];
    if (typeof toolkitDep !== 'string' || !/^\^\d/.test(toolkitDep)) {
      throw new Error(`__TOOLKIT_VERSION__ not replaced (saw: ${toolkitDep})`);
    }

    process.stdout.write(
      `smoke:scaffold OK — ${REQUIRED_FILES.length} files + 2 tokens verified at ${target}\n`,
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `smoke:scaffold FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
