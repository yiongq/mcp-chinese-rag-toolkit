import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  aggregateAnswerMeans,
  DEFAULT_SMOKE_SAMPLE_SIZE,
  estimateJudgeCalls,
  meanNdcg,
  renderBenchmarkTable,
  runBenchmark,
  sampleQueries,
} from '../../../src/eval/benchmark.js';
import { expectedMatches } from '../../../src/eval/eval-runner.js';
import { withJudgeCache } from '../../../src/eval/judge-cache.js';
import { JUDGE_PROMPT_VERSION } from '../../../src/eval/llm-judge.js';
import type {
  AnswerCorrectnessStatement,
  AnswerEvalQueryResult,
  BenchmarkConfig,
  BenchmarkOptions,
  BenchmarkSummary,
  ClaimVerdict,
  EmbedFn,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
  EvalSummary,
  GenerateFn,
  JudgeFn,
} from '../../../src/eval/types.js';

// ---------------------------------------------------------------------------
// — Mock factories: controlled, offline, no network and no API key. Every
//   injected function is plain synchronous-resolve JS, so the suite stays
//   deterministic. The judge dispatches on a unique substring of each prompt
//   (same convention as the answer-eval suite).
// ---------------------------------------------------------------------------

const searchFnReturning =
  (results: EvalSearchResult[]): EvalSearchFn =>
  () =>
    Promise.resolve(results);

const okGenerateFn =
  (answer: string): GenerateFn =>
  () =>
    Promise.resolve(answer);

interface JudgeResponses {
  claims?: ClaimVerdict[];
  reverseQuestions?: string[];
  usefulFlags?: boolean[];
  statements?: AnswerCorrectnessStatement[];
  attributionFlags?: boolean[];
}

const mockJudgeFn =
  (r: JudgeResponses): JudgeFn =>
  (prompt) => {
    if (prompt.includes('原子论断')) return Promise.resolve(JSON.stringify(r.claims ?? []));
    if (prompt.includes('反推')) return Promise.resolve(JSON.stringify(r.reverseQuestions ?? []));
    if (prompt.includes('检索片段')) return Promise.resolve(JSON.stringify(r.usefulFlags ?? []));
    if (prompt.includes('TP 表示')) return Promise.resolve(JSON.stringify(r.statements ?? []));
    if (prompt.includes('拆成句子'))
      return Promise.resolve(JSON.stringify(r.attributionFlags ?? []));
    return Promise.reject(new Error('mockJudgeFn: unexpected prompt'));
  };

// Identical vectors → cosine similarity 1 for every reverse question.
const mockEmbedFn =
  (vector: number[]): EmbedFn =>
  (texts) =>
    Promise.resolve(texts.map(() => [...vector]));

// ---------------------------------------------------------------------------
// — Shared fixtures (Chinese, self-authored — no private data, no real keys).
// ---------------------------------------------------------------------------

const DOC_A: EvalSearchResult = { source: 'doc-a.md', content: '入职报到流程：到前台登记后领取工牌。' };
const DOC_B: EvalSearchResult = { source: 'doc-b.md', content: '设备领取：向 IT 申请笔记本电脑与显示器。' };
const DOC_C: EvalSearchResult = { source: 'doc-c.md', content: '考勤制度：每日上下班各打卡一次。' };

const ANSWER = '入职第一天需要办理报到并领取办公设备。';

// usefulFlags has length 2 to align with the two retrieved chunks the judge sees
// (judgeContextUsefulness enforces a one-to-one length match).
const FULL_RESPONSES: JudgeResponses = {
  claims: [
    { claim: '入职第一天要办理报到', supported: true },
    { claim: '入职第一天要参加培训', supported: false },
  ],
  reverseQuestions: ['入职第一天要做什么？'],
  usefulFlags: [true, false],
  statements: [
    { statement: '办理报到', label: 'TP' },
    { statement: '领取设备', label: 'FP' },
  ],
  attributionFlags: [true, true],
};

const EVAL_SET: EvalSet = {
  version: 'bench-eval-v1',
  queries: [
    {
      query: '入职第一天要做什么？',
      expected: [{ source: 'doc-a.md' }],
      category: 'onboarding',
      referenceAnswer: '入职第一天需要办理报到与领取设备。',
    },
  ],
};

function makeOpts(overrides: Partial<BenchmarkOptions> = {}): BenchmarkOptions {
  return {
    configs: [{ name: 'full-stack', searchFn: searchFnReturning([DOC_A, DOC_B]) }],
    generateFn: okGenerateFn(ANSWER),
    judgeFn: mockJudgeFn(FULL_RESPONSES),
    embedFn: mockEmbedFn([1, 0, 0]),
    generateModel: 'mock-generate-model',
    judgeModel: 'mock-judge-model',
    topK: 5,
    ...overrides,
  };
}

// Six distinct retrieval configurations over the same two-chunk result set, so
// usefulFlags stays length-2 aligned for every one. Three land the expected hit
// at rank 1, two at rank 2, and one misses it entirely — enough spread to make
// the comparison table meaningful.
const SIX_CONFIGS: BenchmarkConfig[] = [
  { name: 'full-stack', searchFn: searchFnReturning([DOC_A, DOC_B]) }, // hit rank 1
  { name: 'no-rerank', searchFn: searchFnReturning([DOC_B, DOC_A]) }, // hit rank 2
  { name: 'vec-only', searchFn: searchFnReturning([DOC_C, DOC_A]) }, // hit rank 2
  { name: 'bm25-only', searchFn: searchFnReturning([DOC_A, DOC_C]) }, // hit rank 1
  { name: 'lexical-baseline', searchFn: searchFnReturning([DOC_C, DOC_B]) }, // miss
  { name: 'no-tokenizer', searchFn: searchFnReturning([DOC_B, DOC_C]) }, // miss
];

function configByName(summary: BenchmarkSummary, name: string) {
  const found = summary.configs.find((c) => c.name === name);
  if (!found) throw new Error(`expected a config result named ${name}`);
  return found;
}

/** Table data rows (excludes the title, header and separator lines). */
function dataRows(table: string): string[] {
  return table
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.includes('Config |'));
}

/** A timestamp-free view used to assert run-to-run determinism. */
function metricsView(summary: BenchmarkSummary) {
  return summary.configs.map((c) => ({
    name: c.name,
    hitRate: c.retrieval.hitRate,
    mrr: c.retrieval.mrr,
    ndcg: c.ndcg,
    answerMeans: c.answerMeans,
  }));
}

describe('runBenchmark', () => {
  it('produces one row per configuration with both retrieval and answer metrics', async () => {
    const summary = await runBenchmark(EVAL_SET, makeOpts({ configs: SIX_CONFIGS }));

    expect(summary.configs).toHaveLength(6);
    expect(summary.configs.map((c) => c.name)).toEqual([
      'full-stack',
      'no-rerank',
      'vec-only',
      'bm25-only',
      'lexical-baseline',
      'no-tokenizer',
    ]);
    // Every row carries the retrieval aggregates AND the answer aggregates.
    for (const config of summary.configs) {
      expect(typeof config.retrieval.hitRate).toBe('number');
      expect(typeof config.retrieval.mrr).toBe('number');
      expect(typeof config.ndcg).toBe('number');
      expect(config.answerMeans.faithfulness).toBeCloseTo(0.5);
    }
    // The rendered comparison table has exactly six data rows.
    expect(dataRows(renderBenchmarkTable(summary))).toHaveLength(6);
  });

  it('computes Hit Rate / MRR / nDCG correctly for a single hit at rank 2', async () => {
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({ configs: [{ name: 'rank-2', searchFn: searchFnReturning([DOC_B, DOC_A]) }] }),
    );
    const config = configByName(summary, 'rank-2');

    expect(config.retrieval.hitRate).toBe(1);
    expect(config.retrieval.mrr).toBe(0.5);
    // gains [0, 1] → dcg = 1/log2(3), idcg = 1 → nDCG = 1/log2(3).
    expect(config.ndcg).toBeCloseTo(1 / Math.log2(3));
  });

  it('scores a complete miss as zero Hit Rate / MRR / nDCG', async () => {
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({ configs: [{ name: 'miss', searchFn: searchFnReturning([DOC_C]) }] }),
    );
    const config = configByName(summary, 'miss');

    expect(config.retrieval.hitRate).toBe(0);
    expect(config.retrieval.mrr).toBe(0);
    expect(config.ndcg).toBe(0);
  });

  it('rewards ranking a hit higher even when Hit Rate and MRR are tied (nDCG is distinct)', async () => {
    // Two expected hits; both configs land the FIRST hit at rank 1 (equal MRR and
    // equal Hit Rate), but they order the SECOND hit differently — only nDCG sees
    // that difference. usefulFlags length 3 keeps contextPrecision aligned.
    const twoHitSet: EvalSet = {
      version: 'bench-eval-v1',
      queries: [{ query: 'q', expected: [{ source: 'doc-a.md' }, { source: 'doc-b.md' }] }],
    };
    const responses: JudgeResponses = { ...FULL_RESPONSES, usefulFlags: [true, false, false] };
    const summary = await runBenchmark(
      twoHitSet,
      makeOpts({
        judgeFn: mockJudgeFn(responses),
        configs: [
          { name: 'both-early', searchFn: searchFnReturning([DOC_A, DOC_B, DOC_C]) },
          { name: 'second-late', searchFn: searchFnReturning([DOC_A, DOC_C, DOC_B]) },
        ],
      }),
    );
    const early = configByName(summary, 'both-early');
    const late = configByName(summary, 'second-late');

    // Tied on the rank-blind / first-hit-only metrics ...
    expect(early.retrieval.hitRate).toBe(late.retrieval.hitRate);
    expect(early.retrieval.mrr).toBe(late.retrieval.mrr);
    expect(early.retrieval.mrr).toBe(1);
    // ... but nDCG separates them: gains [1,1,0] (ideal) vs [1,0,1].
    expect(early.ndcg).toBeCloseTo(1);
    expect(late.ndcg).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3)));
    expect(early.ndcg).toBeGreaterThan(late.ndcg);
  });

  it('aggregates answer metrics across queries and respects per-query skips', async () => {
    // One query has a reference answer, one does not — so the reference-based pair
    // aggregates over a single query while the reference-free trio aggregates over
    // both.
    const mixedSet: EvalSet = {
      version: 'bench-eval-v1',
      queries: [
        { query: 'q-ref', expected: [{ source: 'doc-a.md' }], referenceAnswer: '参考答案。' },
        { query: 'q-no-ref', expected: [{ source: 'doc-a.md' }] },
      ],
    };
    const summary = await runBenchmark(
      mixedSet,
      makeOpts({ configs: [{ name: 'cfg', searchFn: searchFnReturning([DOC_A, DOC_B]) }] }),
    );
    const { answerMeans } = configByName(summary, 'cfg');

    // Reference-free metrics present (aggregated over both queries).
    expect(answerMeans.faithfulness).toBeCloseTo(0.5);
    expect(answerMeans.answerRelevance).toBeCloseTo(1);
    expect(answerMeans.contextPrecision).toBeCloseTo(1);
    // Reference-based metrics present (aggregated over the single query that had a
    // reference answer) — never faked to 0 for the query that lacked one.
    expect(answerMeans.answerCorrectness).toBeCloseTo(2 / 3);
    expect(answerMeans.contextRecall).toBeCloseTo(1);
  });

  it('omits a never-measured answer metric (no embed fn → answer relevance absent, not 0)', async () => {
    const optsNoEmbed = makeOpts();
    // Remove the embed function so answer relevance is skipped on every query.
    delete (optsNoEmbed as { embedFn?: EmbedFn }).embedFn;
    const summary = await runBenchmark(EVAL_SET, optsNoEmbed);
    const { answerMeans } = configByName(summary, 'full-stack');

    expect('answerRelevance' in answerMeans).toBe(false);
    expect(answerMeans.answerRelevance).toBeUndefined();
    // The other reference-free metrics still aggregate.
    expect(answerMeans.faithfulness).toBeCloseTo(0.5);
    expect(answerMeans.contextPrecision).toBeCloseTo(1);

    // And the rendered table shows `n/a` in the Answer Relevance column, not 0.
    const table = renderBenchmarkTable(summary);
    const row = dataRows(table)[0] ?? '';
    expect(row).toContain('n/a');
  });

  it('pins reproducible version metadata once at the summary level', async () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../../package.json') as { version: string };
    const summary = await runBenchmark(EVAL_SET, makeOpts({ configs: SIX_CONFIGS }));

    expect(summary.versionMeta.generateModel).toBe('mock-generate-model');
    expect(summary.versionMeta.judgeModel).toBe('mock-judge-model');
    expect(summary.versionMeta.judgePromptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(summary.versionMeta.toolkitVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(summary.versionMeta.toolkitVersion).toBe(pkg.version);
    expect(summary.versionMeta.evalSpecVersion).toBe('bench-eval-v1');
    expect(summary.evalSpecVersion).toBe('bench-eval-v1');
    expect(summary.topK).toBe(5);
  });

  it('defaults topK to 5 when omitted', async () => {
    const opts = makeOpts();
    delete (opts as { topK?: number }).topK;
    const summary = await runBenchmark(EVAL_SET, opts);
    expect(summary.topK).toBe(5);
  });

  it('is deterministic run to run (every metric value stable, timestamp aside)', async () => {
    const first = await runBenchmark(EVAL_SET, makeOpts({ configs: SIX_CONFIGS }));
    const second = await runBenchmark(EVAL_SET, makeOpts({ configs: SIX_CONFIGS }));
    expect(metricsView(first)).toEqual(metricsView(second));
  });
});

describe('runBenchmark — input validation', () => {
  it('rejects an empty configs array', async () => {
    await expect(runBenchmark(EVAL_SET, makeOpts({ configs: [] }))).rejects.toThrow('configs');
  });

  it('rejects duplicate config names', async () => {
    const configs: BenchmarkConfig[] = [
      { name: 'dup', searchFn: searchFnReturning([DOC_A]) },
      { name: 'dup', searchFn: searchFnReturning([DOC_B]) },
    ];
    await expect(runBenchmark(EVAL_SET, makeOpts({ configs }))).rejects.toThrow('duplicate');
  });

  it('rejects a blank config name', async () => {
    const configs = [{ name: '   ', searchFn: searchFnReturning([DOC_A]) }];
    await expect(runBenchmark(EVAL_SET, makeOpts({ configs }))).rejects.toThrow('name');
  });

  it('rejects a non-function searchFn', async () => {
    const configs = [
      { name: 'bad', searchFn: 'not a function' as unknown as EvalSearchFn },
    ] satisfies BenchmarkConfig[];
    await expect(runBenchmark(EVAL_SET, makeOpts({ configs }))).rejects.toThrow('searchFn');
  });

  it('rejects a non-function generateFn', async () => {
    const opts = { ...makeOpts(), generateFn: undefined as unknown as GenerateFn };
    await expect(runBenchmark(EVAL_SET, opts)).rejects.toThrow('generateFn');
  });

  it('rejects a blank generate / judge model name', async () => {
    await expect(runBenchmark(EVAL_SET, makeOpts({ generateModel: '   ' }))).rejects.toThrow(
      'generateModel',
    );
    await expect(runBenchmark(EVAL_SET, makeOpts({ judgeModel: '' }))).rejects.toThrow('judgeModel');
  });

  it('rejects a non-positive or non-integer topK', async () => {
    await expect(runBenchmark(EVAL_SET, makeOpts({ topK: 0 }))).rejects.toThrow('topK');
    await expect(runBenchmark(EVAL_SET, makeOpts({ topK: -2 }))).rejects.toThrow('topK');
    await expect(runBenchmark(EVAL_SET, makeOpts({ topK: 1.5 }))).rejects.toThrow('topK');
  });
});

describe('renderBenchmarkTable', () => {
  it('renders deterministically (same summary → byte-identical output)', async () => {
    const summary = await runBenchmark(EVAL_SET, makeOpts({ configs: SIX_CONFIGS }));
    expect(renderBenchmarkTable(summary)).toBe(renderBenchmarkTable(summary));
  });

  it('keeps a stable column order with no aggregate "overall" column', async () => {
    const summary = await runBenchmark(EVAL_SET, makeOpts());
    const table = renderBenchmarkTable(summary);
    const header = table.split('\n').find((l) => l.includes('Config |')) ?? '';

    expect(header).toBe(
      '| Config | Hit Rate@5 | MRR | nDCG@5 | Faithfulness | Answer Relevance | Context Precision | Answer Correctness | Context Recall |',
    );
    expect(table).not.toMatch(/overall/i);
    expect(table).not.toMatch(/\bTotal Score\b/i);
  });

  it('escapes pipe / backtick / newline in a config name so the row stays intact', async () => {
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({ configs: [{ name: 'pipe|tick`x', searchFn: searchFnReturning([DOC_A, DOC_B]) }] }),
    );
    const table = renderBenchmarkTable(summary);
    const row = dataRows(table)[0] ?? '';

    expect(row).toContain('pipe\\|tick\\`x');
    // The escaped name keeps the row at nine cells (ten pipes).
    expect((row.match(/(?<!\\)\|/g) ?? []).length).toBe(10);
  });

  it('escapes a backslash so a name like a\\|b cannot split the row', async () => {
    // Regression: before the backslash was escaped FIRST, a name `a\|b` rendered
    // as `a\\|b`, whose bare trailing `|` opened a spurious extra column and
    // shifted every metric in the row one cell to the right.
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({ configs: [{ name: 'a\\|b', searchFn: searchFnReturning([DOC_A, DOC_B]) }] }),
    );
    const rows = dataRows(renderBenchmarkTable(summary));
    const row = rows[0] ?? '';

    expect(rows).toHaveLength(1);
    // Nine cells → ten unescaped column separators; the name's own pipe is
    // preceded by a backslash and is not counted.
    expect((row.match(/(?<!\\)\|/g) ?? []).length).toBe(10);
  });

  it('collapses carriage returns / CRLF in a config name to a single space', async () => {
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({ configs: [{ name: 'win\r\nname', searchFn: searchFnReturning([DOC_A, DOC_B]) }] }),
    );
    const rows = dataRows(renderBenchmarkTable(summary));
    const row = rows[0] ?? '';

    expect(rows).toHaveLength(1);
    expect(row).toContain('win name');
    expect(row).not.toContain('\r');
    expect(row).not.toContain('\n');
  });

  it('carries a metadata block with the version fields and run context', async () => {
    const summary = await runBenchmark(EVAL_SET, makeOpts());
    const table = renderBenchmarkTable(summary);

    expect(table).toContain('bench-eval-v1');
    expect(table).toContain(summary.timestamp);
    expect(table).toContain('mock-generate-model');
    expect(table).toContain('mock-judge-model');
    expect(table).toContain(JUDGE_PROMPT_VERSION);
    expect(table).toContain('Configs compared');
  });

  it('escapes a backtick in a metadata value so its inline-code span stays intact', async () => {
    // A model name with a backtick would otherwise close the `...` span early and
    // garble the deterministic metadata block.
    const summary = await runBenchmark(
      EVAL_SET,
      makeOpts({
        generateModel: 'model`x',
        configs: [{ name: 'c', searchFn: searchFnReturning([DOC_A, DOC_B]) }],
      }),
    );
    const table = renderBenchmarkTable(summary);

    expect(table).toContain('`model\\`x`');
  });
});

// ---------------------------------------------------------------------------
// — Pure-helper direct tests (zero mock, table-driven).
// ---------------------------------------------------------------------------

function summaryWith(topResults: EvalSearchResult[]): EvalSummary {
  return {
    evalSetVersion: 'v',
    timestamp: 't',
    totalQueries: 1,
    topK: 5,
    hitRate: 0,
    mrr: 0,
    perQuery: [{ query: 'q', topResults, reciprocalRank: 0 }],
  };
}

describe('meanNdcg', () => {
  it('returns 0 for an empty eval set', () => {
    expect(meanNdcg({ version: 'v', queries: [] }, summaryWith([]), 5)).toBe(0);
  });

  it('scores 1 when the only hit is ranked first', () => {
    const evalSet: EvalSet = { version: 'v', queries: [{ query: 'q', expected: [{ source: 'a' }] }] };
    expect(meanNdcg(evalSet, summaryWith([{ source: 'a' }, { source: 'b' }]), 5)).toBeCloseTo(1);
  });

  it('discounts a hit ranked lower', () => {
    const evalSet: EvalSet = { version: 'v', queries: [{ query: 'q', expected: [{ source: 'a' }] }] };
    expect(meanNdcg(evalSet, summaryWith([{ source: 'b' }, { source: 'a' }]), 5)).toBeCloseTo(
      1 / Math.log2(3),
    );
  });

  it('honours strict page matching through the shared expectedMatches rule', () => {
    const evalSet: EvalSet = {
      version: 'v',
      queries: [{ query: 'q', expected: [{ source: 'a', page: 2 }] }],
    };
    // Same source, wrong page → no gain under strict.
    expect(meanNdcg(evalSet, summaryWith([{ source: 'a', page: 3 }]), 5, true)).toBe(0);
    expect(meanNdcg(evalSet, summaryWith([{ source: 'a', page: 2 }]), 5, true)).toBeCloseTo(1);
  });
});

describe('aggregateAnswerMeans', () => {
  it('averages a present metric and omits a never-present one', () => {
    const rows: AnswerEvalQueryResult[] = [
      { query: 'q1', metrics: { faithfulness: { score: 0.5, supportedClaims: 1, totalClaims: 2 } } },
      { query: 'q2', metrics: { faithfulness: { score: 1, supportedClaims: 1, totalClaims: 1 } } },
    ];
    const means = aggregateAnswerMeans(rows);

    expect(means.faithfulness).toBeCloseTo(0.75);
    expect('answerRelevance' in means).toBe(false);
    expect('contextRecall' in means).toBe(false);
  });

  it('returns an empty object when no metric was ever measured', () => {
    const rows: AnswerEvalQueryResult[] = [{ query: 'q', metrics: {} }];
    expect(aggregateAnswerMeans(rows)).toEqual({});
  });
});

describe('expectedMatches (shared hit rule)', () => {
  it('matches on source by default and enforces page only under strict', () => {
    const query = { query: 'q', expected: [{ source: 'a', page: 2 }] };
    expect(expectedMatches(query, { source: 'a', page: 9 })).toBe(true); // lenient: source only
    expect(expectedMatches(query, { source: 'a', page: 9 }, true)).toBe(false); // strict: page wrong
    expect(expectedMatches(query, { source: 'a', page: 2 }, true)).toBe(true);
    expect(expectedMatches(query, { source: 'z' }, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// — Cost tier (full nightly run vs sampled smoke run) + cost estimate + cache wiring.
// ---------------------------------------------------------------------------

// A 10-query set; every config returns the same two-chunk result so usefulFlags
// stays length-2 aligned and the prompts are identical across queries/configs.
const TEN_QUERIES: EvalSet = {
  version: 'bench-eval-v1',
  queries: Array.from({ length: 10 }, (_, i) => ({
    query: `q${i}`,
    expected: [{ source: 'doc-a.md' }],
  })),
};

describe('sampleQueries (reproducible smoke sampling)', () => {
  const xs = Array.from({ length: 10 }, (_, i) => i);

  it('takes a fixed stride for sampleSize and is reproducible', () => {
    expect(sampleQueries(xs, { sampleSize: 5 })).toEqual([0, 2, 4, 6, 8]);
    expect(sampleQueries(xs, { sampleSize: 5 })).toEqual(sampleQueries(xs, { sampleSize: 5 }));
  });

  it('keeps every Nth when sampleEvery is set (takes precedence over sampleSize)', () => {
    expect(sampleQueries(xs, { sampleEvery: 3 })).toEqual([0, 3, 6, 9]);
    expect(sampleQueries(xs, { sampleEvery: 3, sampleSize: 5 })).toEqual([0, 3, 6, 9]);
  });

  it('returns the whole list when the subset covers it', () => {
    expect(sampleQueries(xs, { sampleSize: 10 })).toHaveLength(10);
    expect(sampleQueries(xs, { sampleSize: 99 })).toHaveLength(10);
  });

  it('defaults to DEFAULT_SMOKE_SAMPLE_SIZE when no option is given', () => {
    expect(sampleQueries(xs, {})).toHaveLength(DEFAULT_SMOKE_SAMPLE_SIZE);
  });

  it('throws (never infinite-loops) on a non-positive / non-integer sampleEvery', () => {
    // The `i += sampleEvery` stride would otherwise hang: 0 never advances, a
    // negative step runs backward. sampleQueries is public, so it guards itself.
    expect(() => sampleQueries(xs, { sampleEvery: 0 })).toThrow(/positive integer/);
    expect(() => sampleQueries(xs, { sampleEvery: -2 })).toThrow(/positive integer/);
    expect(() => sampleQueries(xs, { sampleEvery: 1.5 })).toThrow(/positive integer/);
  });
});

describe('estimateJudgeCalls', () => {
  it('is queries × metricsPerQuery(5) × configs × varianceSamples', () => {
    expect(estimateJudgeCalls({ evaluatedQueries: 10, configs: 3 })).toBe(150); // 10×5×3×1
    expect(estimateJudgeCalls({ evaluatedQueries: 10, configs: 3, varianceSamples: 4 })).toBe(600);
    expect(estimateJudgeCalls({ evaluatedQueries: 4, configs: 2, metricsPerQuery: 5 })).toBe(40);
  });
});

describe('runBenchmark — cost tier', () => {
  it('defaults to the full tier (every query evaluated)', async () => {
    const summary = await runBenchmark(TEN_QUERIES, makeOpts());
    expect(summary.tier).toBe('full');
    expect(summary.evaluatedQueries).toBe(10);
    expect(summary.configs[0]?.retrieval.totalQueries).toBe(10);
    expect(summary.estimatedJudgeCalls).toBe(estimateJudgeCalls({ evaluatedQueries: 10, configs: 1 }));
  });

  it('smoke tier evaluates only the reproducible subset', async () => {
    const summary = await runBenchmark(
      TEN_QUERIES,
      makeOpts({ tier: 'smoke', sampleSize: 4 }),
    );
    expect(summary.tier).toBe('smoke');
    expect(summary.evaluatedQueries).toBe(4);
    expect(summary.configs[0]?.retrieval.totalQueries).toBe(4);
    expect(summary.estimatedJudgeCalls).toBe(estimateJudgeCalls({ evaluatedQueries: 4, configs: 1 }));
  });

  it('threads varianceSamples into the cost estimate only (the run still judges once)', async () => {
    const summary = await runBenchmark(EVAL_SET, makeOpts({ varianceSamples: 3 }));
    // 1 query × 5 metrics × 1 config × 3 samples = 15.
    expect(summary.estimatedJudgeCalls).toBe(15);
    expect(summary.evaluatedQueries).toBe(1);
  });

  it('surfaces the tier + estimate in the rendered table metadata', async () => {
    const summary = await runBenchmark(TEN_QUERIES, makeOpts({ tier: 'smoke', sampleSize: 4 }));
    const table = renderBenchmarkTable(summary);
    expect(table).toContain('Cost tier');
    expect(table).toContain('smoke');
    expect(table).toContain('Estimated judge calls');
    expect(table).toContain('Queries evaluated');
  });

  it('rejects a bad tier / non-positive sampling option', async () => {
    await expect(
      runBenchmark(EVAL_SET, makeOpts({ tier: 'nope' as unknown as 'full' })),
    ).rejects.toThrow('tier');
    await expect(runBenchmark(EVAL_SET, makeOpts({ sampleSize: 0 }))).rejects.toThrow('sampleSize');
    await expect(
      runBenchmark(EVAL_SET, makeOpts({ varianceSamples: 1.5 })),
    ).rejects.toThrow('varianceSamples');
  });
});

describe('runBenchmark — judge cache wiring (caller injects a withJudgeCache judge)', () => {
  it('dedupes identical judge prompts across configs (5 underlying calls, not 10)', async () => {
    let underlyingCalls = 0;
    const base = mockJudgeFn({ ...FULL_RESPONSES });
    const counting: JudgeFn = (prompt) => {
      underlyingCalls += 1;
      return base(prompt);
    };
    const cached = withJudgeCache(counting, {
      model: 'mock-judge-model',
      promptVersion: JUDGE_PROMPT_VERSION,
    });

    // Two configs returning the SAME chunks → byte-identical judge prompts, so the
    // second config's five judge calls are all served from cache.
    const refSet: EvalSet = {
      version: 'bench-eval-v1',
      queries: [
        { query: 'q', expected: [{ source: 'doc-a.md' }], referenceAnswer: '参考答案。' },
      ],
    };
    await runBenchmark(
      refSet,
      makeOpts({
        judgeFn: cached,
        configs: [
          { name: 'cfg-a', searchFn: searchFnReturning([DOC_A, DOC_B]) },
          { name: 'cfg-b', searchFn: searchFnReturning([DOC_A, DOC_B]) },
        ],
      }),
    );

    // One query × five judge-bearing metrics = 5 distinct prompts; the second
    // config reuses every one. Without the cache this would be 10.
    expect(underlyingCalls).toBe(5);
  });
});
