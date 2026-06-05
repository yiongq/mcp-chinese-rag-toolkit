import { performance } from 'node:perf_hooks';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { JIEBA_VERSION } from './tokenizer-meta.js';
import type { HarnessResult, LatencyHarnessOptions, LatencySnapshot } from './types.js';

/** Default warmup count — picked so the ONNX session is fully JIT'd before measurement starts. */
const DEFAULT_WARMUP_RUNS = 5;
/** Default measurement window — matches the "100 calls" baseline. */
const DEFAULT_MEASURE_RUNS = 100;
/** Default tool name — matches `bench/baseline.json#toolName`. */
const DEFAULT_TOOL_NAME = 'search-fixture';
/** Default cycled query strings — mirrors the HR fixture corpus. */
const DEFAULT_QUERIES: readonly string[] = ['试用期', '加班', '请假', '差旅报销', '保密协议'];

/** Tool definition supplied to {@link runStdioLatencyHarness} via `buildHarnessTool`. */
export interface HarnessToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

/** Result returned by the optional `buildHarnessTool` callback. */
export interface HarnessToolBundle {
  tool: HarnessToolDefinition;
  /** Called once after measurement completes — close DBs, dispose ONNX sessions, etc. */
  dispose?: () => Promise<void> | void;
}

/** Extended harness options — adds the `buildHarnessTool` injection seam used by unit tests. */
export interface RunStdioLatencyHarnessOptions extends LatencyHarnessOptions {
  /**
   * Build the tool registered on the harness's in-process server. Defaults
   * to the real RAG pipeline (load embedder + reranker + index 12-chunk
   * HR fixture). Unit tests pass a stub that simulates work with
   * `setTimeout` so the test does not download ~2GB of model weights.
   */
  buildHarnessTool?: () => Promise<HarnessToolBundle>;
  /** Optional override for `environment.toolkitVersion`. Defaults to `'unknown'` if not provided. */
  toolkitVersion?: string;
  /** Optional override for `environment.embedderModelId`. Defaults to `'unknown'`. */
  embedderModelId?: string;
  /** Optional override for `environment.rerankerModelId`. Defaults to `'unknown'`. */
  rerankerModelId?: string;
}

/**
 * NIST type 7 linear-interpolation percentile (the same algorithm NumPy
 * `np.quantile(..., method='linear')` and SciPy `scoreatpercentile` default
 * to). Exposed so other bench tooling can share the math.
 *
 * Formula: `h = (n - 1) * p; result = data[floor(h)] + (h - floor(h)) *
 * (data[floor(h) + 1] - data[floor(h)])`. For `p === 1` the result is the
 * last sample; for `p === 0` the first.
 *
 * @throws if `samples` is empty.
 * @throws if `p` is not a finite number in `[0, 1]`.
 */
export function percentile(samples: number[], p: number): number {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('percentile: samples must be a non-empty array');
  }
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`percentile: p must be a finite number in [0, 1], got ${String(p)}`);
  }
  // Reject NaN / ±Infinity samples — they corrupt the sort comparator and
  // propagate through the linear-interpolation arithmetic into the snapshot
  // (where JSON.stringify silently turns NaN/Infinity into `null`).
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`percentile: samples[${i}] must be a finite number, got ${String(v)}`);
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) {
    // Single-element fast path so we never index past the array.
    const only = sorted[0];
    if (only === undefined) {
      throw new Error('percentile: internal indexing error');
    }
    return only;
  }
  const h = (n - 1) * p;
  const lower = Math.floor(h);
  const upper = Math.min(lower + 1, n - 1);
  const fraction = h - lower;
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) {
    throw new Error('percentile: internal indexing error');
  }
  return low + fraction * (high - low);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `runStdioLatencyHarness: ${field} must be a positive integer, got ${String(value)}`,
    );
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `runStdioLatencyHarness: ${field} must be a non-negative integer, got ${String(value)}`,
    );
  }
}

function buildSnapshot(args: {
  toolName: string;
  warmupRuns: number;
  measureRuns: number;
  coldStartMs: number;
  samples: number[];
  toolkitVersion: string;
  embedderModelId: string;
  rerankerModelId: string;
}): LatencySnapshot {
  const { samples } = args;
  const sum = samples.reduce((s, v) => s + v, 0);
  const meanMs = samples.length > 0 ? sum / samples.length : 0;
  let minMs = samples[0] ?? 0;
  let maxMs = samples[0] ?? 0;
  for (const v of samples) {
    if (v < minMs) minMs = v;
    if (v > maxMs) maxMs = v;
  }
  return {
    timestamp: new Date().toISOString(),
    toolName: args.toolName,
    warmupRuns: args.warmupRuns,
    measureRuns: args.measureRuns,
    coldStartMs: args.coldStartMs,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    meanMs,
    minMs,
    maxMs,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      toolkitVersion: args.toolkitVersion,
      rerankerModelId: args.rerankerModelId,
      embedderModelId: args.embedderModelId,
      jiebaVersion: JIEBA_VERSION,
    },
  };
}

/**
 * Run an in-process MCP server + client pair and measure tool-call latency.
 *
 * Why in-process instead of spawning a subprocess:
 *   1. Cross-platform fork latency (30–300ms on Windows / Linux / macOS)
 *      would dominate cold-start measurement noise.
 *   2.  quantifies the toolkit + MCP SDK protocol layer; subprocess
 *      fork cost is unrelated to product latency.
 *   3. CI runners have unstable IPC overhead.
 *
 * The transport is `InMemoryTransport.createLinkedPair()` — the
 * SDK-supported pattern for in-process client/server pairs. The JSON-RPC
 * protocol layer (request/response correlation, schema validation) is
 * exercised end-to-end; the only thing skipped is stdio-frame
 * encoding/decoding (~1–3ms per call per the Latency Budget table).
 * For a downstream consumer package / a downstream consumer package end-to-end stdio validation, run the
 * / 6 integration tests with the spawned-subprocess transport.
 *
 * @throws if `warmupRuns < 0`, `measureRuns < 1`, or `queries.length === 0`.
 * @throws if any tool call rejects (no partial / corrupted snapshots).
 */
export async function runStdioLatencyHarness(
  opts: RunStdioLatencyHarnessOptions = {},
): Promise<HarnessResult> {
  const warmupRuns = opts.warmupRuns ?? DEFAULT_WARMUP_RUNS;
  const measureRuns = opts.measureRuns ?? DEFAULT_MEASURE_RUNS;
  const toolName = opts.toolName ?? DEFAULT_TOOL_NAME;
  const queries = opts.queries ?? [...DEFAULT_QUERIES];
  const toolkitVersion = opts.toolkitVersion ?? 'unknown';
  const embedderModelId = opts.embedderModelId ?? 'unknown';
  const rerankerModelId = opts.rerankerModelId ?? 'unknown';

  assertNonNegativeInteger(warmupRuns, 'warmupRuns');
  assertPositiveInteger(measureRuns, 'measureRuns');
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error('runStdioLatencyHarness: queries must be a non-empty array');
  }
  for (let i = 0; i < queries.length; i += 1) {
    if (typeof queries[i] !== 'string' || queries[i]?.length === 0) {
      throw new Error(`runStdioLatencyHarness: queries[${i}] must be a non-empty string`);
    }
  }
  if (typeof toolName !== 'string' || toolName.trim().length === 0) {
    throw new Error('runStdioLatencyHarness: toolName must be a non-empty string');
  }
  if (typeof opts.buildHarnessTool !== 'function') {
    throw new Error(
      'runStdioLatencyHarness: buildHarnessTool is required (pass createDefaultRerankFixtureTool() ' +
        'in production or a stub in tests)',
    );
  }

  // Resource lifecycle: bundle (sqlite db / ONNX session) → server → client.
  // Build + connect happen inside try so any partial-init failure (e.g.,
  // buildHarnessTool resolves but server.connect throws) still cleans up.
  let bundle: HarnessToolBundle | undefined;
  let server: McpServer | undefined;
  let client: Client | undefined;
  let serverConnected = false;
  let clientConnected = false;

  try {
    bundle = await opts.buildHarnessTool();
    // Override the tool's outward-facing name so callers can register a real
    // production tool and still measure it as `search-fixture` (or whatever
    // `toolName` the caller picks). This keeps the snapshot.toolName field
    // useful for cross-experiment comparison.
    const registeredToolName = bundle.tool.name;

    server = new McpServer({
      name: 'mcp-rag-latency-harness',
      version: '0.0.0',
    });
    server.registerTool(
      registeredToolName,
      {
        description: bundle.tool.description,
        // Cast required because SDK's union type isn't directly inferable from z.ZodObject — see create-mcp-server.ts:118.
        inputSchema: bundle.tool.inputSchema as never,
      },
      bundle.tool.handler as never,
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'mcp-rag-latency-harness-client', version: '0.0.0' });

    await server.connect(serverTransport);
    serverConnected = true;
    await client.connect(clientTransport);
    clientConnected = true;
    // The MCP SDK wraps tool-handler exceptions into a successful JSON-RPC
    // response with `isError: true` instead of rejecting the call. The
    // harness MUST reject on these — partial baselines built from error
    // responses would silently report fake-fast latencies (no real work was
    // done) and lull CI into accepting regressions.
    const assertCallOk = (
      result: { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined,
      callIdx: number,
    ): void => {
      if (result?.isError === true) {
        const text = result.content?.[0]?.text ?? '(no text)';
        throw new Error(
          `runStdioLatencyHarness: tool call ${callIdx} returned isError=true (${text}); ` +
            'aborting so baseline.json never contains data from failed calls.',
        );
      }
    };

    // Warmup loop — first call cold-loads the ONNX session, subsequent calls
    // pin caches. We measure total elapsed time of all warmup calls combined
    // (cold-start is informational, not part of the measured budget).
    const coldStart = performance.now();
    for (let i = 0; i < warmupRuns; i += 1) {
      const q = queries[i % queries.length];
      if (q === undefined)
        throw new Error('runStdioLatencyHarness: queries[i] undefined (assertion)');
      const result = (await client.callTool({
        name: registeredToolName,
        arguments: { query: q },
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      assertCallOk(result, i);
    }
    const coldStartMs = performance.now() - coldStart;

    // Measurement loop — per-call latency captured via performance.now()
    // before/after the await. Errors propagate (no partial snapshot).
    const samples: number[] = [];
    for (let i = 0; i < measureRuns; i += 1) {
      const q = queries[i % queries.length];
      if (q === undefined)
        throw new Error('runStdioLatencyHarness: queries[i] undefined (assertion)');
      const t0 = performance.now();
      const result = (await client.callTool({
        name: registeredToolName,
        arguments: { query: q },
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      samples.push(performance.now() - t0);
      assertCallOk(result, warmupRuns + i);
    }

    const snapshot = buildSnapshot({
      toolName,
      warmupRuns,
      measureRuns,
      coldStartMs,
      samples,
      toolkitVersion,
      embedderModelId,
      rerankerModelId,
    });

    return { snapshot, samples };
  } finally {
    // Tear down regardless of success / failure so subsequent harness runs in
    // the same process get a clean server pair. dispose() runs LAST so the
    // tool can still service in-flight calls during transport close. Every
    // cleanup step is best-effort — a throwing dispose() must NOT mask the
    // original error from the try block (otherwise tool-handler failures get
    // replaced by misleading "close failed" stack traces).
    if (clientConnected && client) {
      await client.close().catch(() => {
        /* best-effort */
      });
    }
    if (serverConnected && server) {
      await server.close().catch(() => {
        /* best-effort */
      });
    }
    if (bundle?.dispose) {
      await Promise.resolve(bundle.dispose()).catch(() => {
        /* best-effort */
      });
    }
  }
}
