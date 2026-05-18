import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Story 2.9 — `cli/create-mcp-rag` sub-entry exists because npm users run
  // the bin via Node directly (`npx`), which cannot execute `.ts`. The three
  // dev-only bins (run-eval / latency-harness / run-vision-caption-demo)
  // intentionally stay on `tsx`-source-only — they have no downstream user.
  entry: {
    index: 'src/index.ts',
    'cli/create-mcp-rag': 'bin/create-mcp-rag.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  treeshake: true,
  outExtensions: ({ format }) => ({
    js: format === 'es' ? '.js' : '.cjs',
    dts: format === 'es' ? '.d.ts' : '.d.cts',
  }),
  publint: 'ci-only',
  // attw temporarily disabled — upstream bug (attw 0.18 + fflate 0.8 + Node 22). Re-enable before Epic 7 npm publish. See deferred-work.md.
  attw: false,
  failOnWarn: 'ci-only',
  hooks: {
    'build:done': () => {
      // tsdown preserves the shebang but not the exec bit on disk; npx /
      // local `node_modules/.bin/create-mcp-rag` need 0o755 to work.
      const cliJs = path.resolve(here, 'dist/cli/create-mcp-rag.js');
      const cliCjs = path.resolve(here, 'dist/cli/create-mcp-rag.cjs');
      for (const file of [cliJs, cliCjs]) {
        if (existsSync(file)) chmodSync(file, 0o755);
      }
    },
  },
});
