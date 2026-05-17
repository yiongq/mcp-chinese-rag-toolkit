import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
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
});
