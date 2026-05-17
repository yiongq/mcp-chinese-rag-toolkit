import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  type HarnessToolBundle,
  percentile,
  runStdioLatencyHarness,
} from '../../../src/rag/latency-harness.js';

describe('percentile (NIST type 7 linear interpolation)', () => {
  it('returns the median of [1,2,3,4,5] = 3 (p=0.5)', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('returns the NumPy-equivalent linear interpolation at p=0.95 for [1..5] = 4.8', () => {
    // h = (5-1) * 0.95 = 3.8; result = data[3] + 0.8 * (data[4] - data[3]) = 4 + 0.8*1 = 4.8
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 10);
  });

  it('returns the only element for single-sample arrays regardless of p', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.0)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it('returns the value for all-equal arrays (no spurious interpolation noise)', () => {
    expect(percentile([5, 5, 5, 5, 5], 0.5)).toBe(5);
    expect(percentile([5, 5, 5, 5, 5], 0.95)).toBe(5);
  });

  it('handles unsorted input by sorting internally', () => {
    // Same dataset reordered → identical result. Guards against future "samples
    // are pre-sorted" optimisation that would silently break consumers.
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
  });

  it('returns boundary samples for p=0 and p=1', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 1.0)).toBe(50);
  });

  it('rejects empty samples fast', () => {
    expect(() => percentile([], 0.5)).toThrow(/percentile: samples must be a non-empty array/);
  });

  it('rejects out-of-range p (-0.1 / 1.1 / NaN / Infinity)', () => {
    expect(() => percentile([1, 2, 3], -0.1)).toThrow(/percentile: p must be a finite number/);
    expect(() => percentile([1, 2, 3], 1.1)).toThrow(/percentile: p must be a finite number/);
    expect(() => percentile([1, 2, 3], Number.NaN)).toThrow(
      /percentile: p must be a finite number/,
    );
    expect(() => percentile([1, 2, 3], Number.POSITIVE_INFINITY)).toThrow(
      /percentile: p must be a finite number/,
    );
  });
});

// Pure sleep-based stub tool — never loads real models. Used to exercise the
// measurement loop, parameter validation, and snapshot-build path of the
// harness without paying for ~2GB of model downloads.
function makeStubBuildHarnessTool(opts?: { delayMs?: number; failAfter?: number }): {
  build: () => Promise<HarnessToolBundle>;
  callCount: () => number;
  disposeCount: () => number;
} {
  let calls = 0;
  let disposed = 0;
  return {
    build: async () => ({
      tool: {
        name: 'stub-tool',
        description: 'Stub tool for latency-harness unit tests.',
        inputSchema: z.object({ query: z.string().min(1) }),
        handler: async () => {
          calls += 1;
          if (opts?.failAfter !== undefined && calls > opts.failAfter) {
            throw new Error('stub-tool: deliberate failure for harness error-path test');
          }
          if (opts?.delayMs !== undefined && opts.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
          }
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
      dispose: async () => {
        disposed += 1;
      },
    }),
    callCount: () => calls,
    disposeCount: () => disposed,
  };
}

describe('runStdioLatencyHarness (stub tool)', () => {
  it('returns a snapshot + samples.length === measureRuns', async () => {
    const stub = makeStubBuildHarnessTool({ delayMs: 1 });
    const result = await runStdioLatencyHarness({
      warmupRuns: 2,
      measureRuns: 5,
      buildHarnessTool: stub.build,
      toolName: 'stub-fixture',
      toolkitVersion: '0.5.0-test',
      embedderModelId: 'stub-embedder',
      rerankerModelId: 'stub-reranker',
    });
    expect(result.samples).toHaveLength(5);
    expect(result.snapshot.measureRuns).toBe(5);
    expect(result.snapshot.warmupRuns).toBe(2);
    expect(result.snapshot.toolName).toBe('stub-fixture');
    expect(stub.callCount()).toBe(2 + 5);
    expect(stub.disposeCount()).toBe(1);
  });

  it('environment fields are populated from process / argument metadata', async () => {
    const stub = makeStubBuildHarnessTool();
    const result = await runStdioLatencyHarness({
      warmupRuns: 0,
      measureRuns: 2,
      buildHarnessTool: stub.build,
      toolkitVersion: '9.9.9',
      embedderModelId: 'fixture-embedder',
      rerankerModelId: 'fixture-reranker',
    });
    expect(result.snapshot.environment.node).toBe(process.version);
    expect(result.snapshot.environment.platform).toBe(process.platform);
    expect(result.snapshot.environment.arch).toBe(process.arch);
    expect(result.snapshot.environment.toolkitVersion).toBe('9.9.9');
    expect(result.snapshot.environment.embedderModelId).toBe('fixture-embedder');
    expect(result.snapshot.environment.rerankerModelId).toBe('fixture-reranker');
    expect(result.snapshot.environment.jiebaVersion).toMatch(/^@node-rs\/jieba@/);
  });

  it('rejects measureRuns = 0 / negative / non-integer', async () => {
    const stub = makeStubBuildHarnessTool();
    await expect(
      runStdioLatencyHarness({ measureRuns: 0, buildHarnessTool: stub.build }),
    ).rejects.toThrow(/measureRuns must be a positive integer/);
    await expect(
      runStdioLatencyHarness({ measureRuns: -1, buildHarnessTool: stub.build }),
    ).rejects.toThrow(/measureRuns must be a positive integer/);
    await expect(
      runStdioLatencyHarness({ measureRuns: 1.5, buildHarnessTool: stub.build }),
    ).rejects.toThrow(/measureRuns must be a positive integer/);
  });

  it('rejects warmupRuns < 0 / non-integer', async () => {
    const stub = makeStubBuildHarnessTool();
    await expect(
      runStdioLatencyHarness({ measureRuns: 1, warmupRuns: -1, buildHarnessTool: stub.build }),
    ).rejects.toThrow(/warmupRuns must be a non-negative integer/);
    await expect(
      runStdioLatencyHarness({ measureRuns: 1, warmupRuns: 1.5, buildHarnessTool: stub.build }),
    ).rejects.toThrow(/warmupRuns must be a non-negative integer/);
  });

  it('rejects empty queries array', async () => {
    const stub = makeStubBuildHarnessTool();
    await expect(
      runStdioLatencyHarness({
        measureRuns: 1,
        queries: [],
        buildHarnessTool: stub.build,
      }),
    ).rejects.toThrow(/queries must be a non-empty array/);
  });

  it('rejects when buildHarnessTool is missing', async () => {
    await expect(
      runStdioLatencyHarness({ measureRuns: 1 } as unknown as Parameters<
        typeof runStdioLatencyHarness
      >[0]),
    ).rejects.toThrow(/buildHarnessTool is required/);
  });

  it('rejects entire run when a tool call throws (no partial snapshot)', async () => {
    const stub = makeStubBuildHarnessTool({ failAfter: 1 });
    await expect(
      runStdioLatencyHarness({
        warmupRuns: 0,
        measureRuns: 5,
        buildHarnessTool: stub.build,
      }),
    ).rejects.toThrow(/deliberate failure/);
    // dispose() MUST still fire so the test does not leak the in-process server.
    expect(stub.disposeCount()).toBe(1);
  });
});
