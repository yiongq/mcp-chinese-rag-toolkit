#!/usr/bin/env node
/**
 * CLI — runs the stdio latency harness and either writes a fresh
 * baseline.json or compares against the committed baseline. Default tool is a
 * full hybrid + rerank pipeline over the 12-chunk HR fixture
 * (in-memory sqlite); CI / `pnpm bench` runs this end-to-end.
 *
 * Usage:
 *   pnpm bench                       # measure + compare against bench/baseline.json
 *   pnpm bench -- --write            # measure + overwrite bench/baseline.json (PR-reviewed)
 *   pnpm bench -- --measure-runs 200 # override sample size
 *   pnpm bench -- --warmup-runs 10
 *
 * Exit codes:
 *   0 — success (always; CI bench step is warn-not-block per AC8)
 *   1 — harness execution error (model load failed / hash mismatch / etc.)
 *
 * Diff is reported via stdout summary + GitHub Actions `::warning::`
 * annotation when running in CI.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  BGE_LARGE_ZH_V1_5_MANIFEST,
  BGE_RERANKER_V2_M3_MANIFEST,
  createHybridSearch,
  createReranker,
  loadEmbedder,
  loadReranker,
  openIndex,
  runStdioLatencyHarness,
  writeEmbedderMeta,
  writeRerankerMeta,
  writeTokenizerMeta,
} from '../src/rag/index.js';
import type { HarnessToolBundle } from '../src/rag/latency-harness.js';
import type { ChunkRow, LatencySnapshot } from '../src/rag/types.js';

interface CliArgs {
  write: boolean;
  measureRuns?: number;
  warmupRuns?: number;
}

function parseInteger(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`latency-harness: ${flag} must be a positive integer, got ${raw}`);
  }
  return n;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { write: false };
  const numericFlags = new Set(['--measure-runs', '--warmup-runs']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--write') {
      out.write = true;
      continue;
    }
    // Support the `--flag=value` form alongside the `--flag value` form.
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const flag = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (!numericFlags.has(flag)) {
        throw new Error(`latency-harness: unknown flag ${flag}`);
      }
      if (value === '') {
        throw new Error(`latency-harness: ${flag}= requires a value`);
      }
      const n = parseInteger(flag, value);
      if (flag === '--measure-runs') out.measureRuns = n;
      else out.warmupRuns = n;
      continue;
    }
    if (numericFlags.has(arg)) {
      const next = argv[i + 1];
      // Reject `--measure-runs --write` (next looks like another flag) — the
      // user almost certainly forgot the value, and silently consuming `--write`
      // as a numeric arg would drop the write intent on the floor.
      if (!next || next.startsWith('--')) {
        throw new Error(`latency-harness: ${arg} requires a numeric value`);
      }
      const n = parseInteger(arg, next);
      if (arg === '--measure-runs') out.measureRuns = n;
      else out.warmupRuns = n;
      i += 1;
      continue;
    }
    throw new Error(`latency-harness: unknown argument ${arg}`);
  }
  return out;
}

/** 12 HR-flavoured chunks mirrored from `hybrid-search.integration.test.ts`. */
const FIXTURE_CHUNKS = [
  {
    content: '差旅报销规定要求保留所有原始凭证并填写电子差旅单。',
    source: 'bench-fixture.md',
    page: 1,
  },
  { content: '实习期评估流程对新人开展导师面谈和绩效评估。', source: 'bench-fixture.md', page: 2 },
  {
    content: '试用期管理覆盖入职三个月内的所有同事,期满启动转正评估。',
    source: 'bench-fixture.md',
    page: 3,
  },
  {
    content: '员工培训计划由人力资源部统筹,每季度更新课程表。',
    source: 'bench-fixture.md',
    page: 4,
  },
  { content: '请假申请需通过 OA 系统提交,由直属上级审批。', source: 'bench-fixture.md', page: 5 },
  { content: '加班补偿可以选择换算成调休或按规定折算工资。', source: 'bench-fixture.md', page: 6 },
  {
    content: '法定节假日按国家公历日历执行,公司同步发布年度排班表。',
    source: 'bench-fixture.md',
    page: 7,
  },
  {
    content: '保密协议覆盖客户资料、内部文档以及未发布的产品信息。',
    source: 'bench-fixture.md',
    page: 8,
  },
  {
    content: '年终奖发放与个人绩效以及公司整体经营情况共同挂钩。',
    source: 'bench-fixture.md',
    page: 9,
  },
  {
    content: '健康体检每年提供一次,可凭票据在体检合作机构完成。',
    source: 'bench-fixture.md',
    page: 10,
  },
  {
    content: '离职手续需要提前一个月以书面形式向直属上级提出申请。',
    source: 'bench-fixture.md',
    page: 11,
  },
  {
    content: '出差预订机票与酒店时优先使用公司协议供应商以享受折扣。',
    source: 'bench-fixture.md',
    page: 12,
  },
] as const;

/**
 * Default `buildHarnessTool` — wires the full hybrid + rerank pipeline over an
 * in-memory 12-chunk HR fixture. Used by the bench CLI; unit tests pass a
 * stub instead so they do not download ~2GB of model weights.
 */
async function buildSearchFixtureTool(): Promise<HarnessToolBundle> {
  const embedder = await loadEmbedder();
  const reranker = await loadReranker();
  const handle = openIndex(':memory:', { embeddingDim: embedder.dim });
  writeEmbedderMeta(handle.db, embedder);
  writeTokenizerMeta(handle.db);
  writeRerankerMeta(handle.db, reranker);

  const contents = FIXTURE_CHUNKS.map((c) => c.content);
  const embeddings = await embedder.embedBatch(contents);
  const rows: ChunkRow[] = FIXTURE_CHUNKS.map((chunk, i) => {
    const embedding = embeddings[i];
    if (!embedding) throw new Error(`bench-fixture: missing embedding for chunk ${i}`);
    return { chunk, embedding };
  });
  handle.indexChunks(rows);

  const hybridSearch = createHybridSearch({ handle, embedder });
  const rerank = createReranker({ reranker, defaultOpts: { topK: 5 } });

  return {
    tool: {
      name: 'search-fixture',
      description:
        'bench fixture — runs hybrid (FTS5 + sqlite-vec) → rerank top-5 over a 12-chunk HR corpus.',
      inputSchema: z.object({ query: z.string().min(1) }),
      handler: async (args: unknown) => {
        const { query } = args as { query: string };
        const hybrid = await hybridSearch(query, { topK: 10 });
        const reranked = await rerank(query, hybrid);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(reranked.map((r) => ({ docId: r.docId, score: r.rerankScore }))),
            },
          ],
        };
      },
    },
    dispose: async () => {
      handle.close();
    },
  };
}

interface CliEnvironment {
  baselinePath: string;
  latestPath: string;
  toolkitVersion: string;
}

function resolveEnvironment(): CliEnvironment {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  const baselinePath = path.join(pkgRoot, 'bench', 'baseline.json');
  const latestPath = path.join(pkgRoot, 'bench', 'latest.json');
  // Load package.json via createRequire so we don't need node:fs JSON parsing.
  const require = createRequire(import.meta.url);
  const pkg = require(path.join(pkgRoot, 'package.json')) as { version?: string };
  return { baselinePath, latestPath, toolkitVersion: pkg.version ?? '0.0.0' };
}

const baselineEnvironmentSchema = z.object({
  node: z.string(),
  platform: z.string(),
  arch: z.string(),
  toolkitVersion: z.string(),
  rerankerModelId: z.string(),
  embedderModelId: z.string(),
  jiebaVersion: z.string(),
});
const baselineSchema = z.object({
  timestamp: z.string(),
  toolName: z.string(),
  warmupRuns: z.number().int().nonnegative(),
  measureRuns: z.number().int().positive(),
  coldStartMs: z.number(),
  p50Ms: z.number().finite(),
  p95Ms: z.number().finite(),
  p99Ms: z.number().finite(),
  meanMs: z.number().finite(),
  minMs: z.number().finite(),
  maxMs: z.number().finite(),
  environment: baselineEnvironmentSchema,
});

/**
 * Read baseline.json from disk.
 *
 * Returns `undefined` ONLY when the file is missing (first-run case).
 * THROWS on corrupt JSON or schema mismatch — silently substituting
 * "no baseline" for a broken contract file would let regressions slip
 * through without the operator noticing.
 */
function readBaseline(baselinePath: string): LatencySnapshot | undefined {
  if (!existsSync(baselinePath)) return undefined;
  const raw = readFileSync(baselinePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `latency-harness: bench/baseline.json is not valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
        'Delete the file and re-seed with `pnpm bench -- --write` after investigating the corruption.',
    );
  }
  const result = baselineSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `latency-harness: bench/baseline.json fails LatencySnapshot schema (${result.error.message}). ` +
        'Either the file is corrupt or the schema has evolved; re-seed via `pnpm bench -- --write` after review.',
    );
  }
  return result.data as LatencySnapshot;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Write a contract file atomically — never leave a half-written
 * `baseline.json` / `latest.json` if the process is interrupted mid-write.
 * Same idiom used by package managers / configuration tools.
 */
function writeFileAtomic(filePath: string, contents: string): void {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, contents, 'utf8');
  renameSync(tmpPath, filePath);
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function reportSnapshot(snapshot: LatencySnapshot): void {
  process.stdout.write(
    `\n=== latency snapshot (${snapshot.toolName}) ===\n` +
      `  measureRuns:  ${snapshot.measureRuns} (warmup: ${snapshot.warmupRuns})\n` +
      `  coldStart:    ${formatMs(snapshot.coldStartMs)}\n` +
      `  p50:          ${formatMs(snapshot.p50Ms)}\n` +
      `  p95:          ${formatMs(snapshot.p95Ms)}\n` +
      `  p99:          ${formatMs(snapshot.p99Ms)}\n` +
      `  mean:         ${formatMs(snapshot.meanMs)}\n` +
      `  min / max:    ${formatMs(snapshot.minMs)} / ${formatMs(snapshot.maxMs)}\n` +
      `  environment:  ${snapshot.environment.platform}/${snapshot.environment.arch} ${snapshot.environment.node} (toolkit ${snapshot.environment.toolkitVersion})\n`,
  );
}

/**  hard ceiling — stdio P95 must stay below this value. */
const _P95_CEILING_MS = 200;
/** Relative regression threshold beyond the baseline. */
const REGRESSION_THRESHOLD_MS = 50;
/** Improvement threshold prompting baseline refresh suggestion. */
const IMPROVEMENT_THRESHOLD_MS = -20;

function emitAnnotation(message: string): void {
  process.stdout.write(`${message}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::warning::${message}\n`);
  }
}

function reportDiff(baseline: LatencySnapshot | undefined, current: LatencySnapshot): void {
  // Absolute  check first — fires regardless of baseline availability so a
  // missing baseline cannot mask a P95 already over the 200ms ceiling.
  if (current.p95Ms > _P95_CEILING_MS) {
    emitAnnotation(
      `⚠️  breach: current P95 ${formatMs(current.p95Ms)} > ${_P95_CEILING_MS}ms ceiling`,
    );
  }

  if (!baseline) {
    process.stdout.write(
      'latency-harness: no bench/baseline.json on disk — run `pnpm bench -- --write` to seed one.\n',
    );
    return;
  }

  // Drift is only meaningful when the run + baseline share the same
  // measurement substrate. Mismatched platform / arch / runtime / model
  // identity all invalidate the comparison; report each one explicitly so
  // operators know why no number is shown.
  const envDrift: string[] = [];
  if (baseline.environment.platform !== current.environment.platform) {
    envDrift.push(`platform ${baseline.environment.platform} → ${current.environment.platform}`);
  }
  if (baseline.environment.arch !== current.environment.arch) {
    envDrift.push(`arch ${baseline.environment.arch} → ${current.environment.arch}`);
  }
  if (baseline.environment.node !== current.environment.node) {
    envDrift.push(`node ${baseline.environment.node} → ${current.environment.node}`);
  }
  if (baseline.environment.rerankerModelId !== current.environment.rerankerModelId) {
    envDrift.push(
      `reranker ${baseline.environment.rerankerModelId} → ${current.environment.rerankerModelId}`,
    );
  }
  if (baseline.environment.embedderModelId !== current.environment.embedderModelId) {
    envDrift.push(
      `embedder ${baseline.environment.embedderModelId} → ${current.environment.embedderModelId}`,
    );
  }
  if (baseline.environment.jiebaVersion !== current.environment.jiebaVersion) {
    envDrift.push(
      `jieba ${baseline.environment.jiebaVersion} → ${current.environment.jiebaVersion}`,
    );
  }
  if (envDrift.length > 0) {
    process.stdout.write(
      `⚠️ baseline environment drift — drift not comparable: ${envDrift.join(', ')}\n`,
    );
    return;
  }

  const drift = current.p95Ms - baseline.p95Ms;
  if (drift > REGRESSION_THRESHOLD_MS) {
    emitAnnotation(
      `⚠️ P95 regression: ${formatMs(baseline.p95Ms)} → ${formatMs(current.p95Ms)} (+${formatMs(drift)})`,
    );
  } else if (drift < IMPROVEMENT_THRESHOLD_MS) {
    process.stdout.write(
      `✨ P95 improvement: ${formatMs(baseline.p95Ms)} → ${formatMs(current.p95Ms)} (-${formatMs(Math.abs(drift))}). Consider 'pnpm bench -- --write' if intended.\n`,
    );
  } else {
    process.stdout.write(
      `  P95 drift: ${formatMs(baseline.p95Ms)} → ${formatMs(current.p95Ms)} (${drift >= 0 ? '+' : ''}${formatMs(drift)}) — within tolerance.\n`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = resolveEnvironment();

  process.stdout.write(
    `latency-harness: starting (warmup=${args.warmupRuns ?? 5}, measure=${args.measureRuns ?? 100}). Loading models...\n`,
  );

  const result = await runStdioLatencyHarness({
    ...(args.warmupRuns !== undefined && { warmupRuns: args.warmupRuns }),
    ...(args.measureRuns !== undefined && { measureRuns: args.measureRuns }),
    buildHarnessTool: buildSearchFixtureTool,
    toolkitVersion: env.toolkitVersion,
    embedderModelId: BGE_LARGE_ZH_V1_5_MANIFEST.modelId,
    rerankerModelId: BGE_RERANKER_V2_M3_MANIFEST.modelId,
  });

  reportSnapshot(result.snapshot);

  // Always write latest.json (gitignored) so CI artifact upload + local diff
  // tooling have something to consume.
  ensureDir(env.latestPath);
  writeFileAtomic(env.latestPath, `${JSON.stringify(result.snapshot, null, 2)}\n`);
  process.stdout.write(`latency-harness: wrote ${path.relative(process.cwd(), env.latestPath)}\n`);

  const baseline = readBaseline(env.baselinePath);
  reportDiff(baseline, result.snapshot);

  if (args.write) {
    ensureDir(env.baselinePath);
    writeFileAtomic(env.baselinePath, `${JSON.stringify(result.snapshot, null, 2)}\n`);
    process.stdout.write(
      `\nlatency-harness: WROTE NEW BASELINE → ${path.relative(process.cwd(), env.baselinePath)}\n` +
        `  Please justify the bump in your PR description (regression? optimisation? hardware change?).\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `latency-harness: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
