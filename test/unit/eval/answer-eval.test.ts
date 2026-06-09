import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { runAnswerEval } from '../../../src/eval/answer-eval.js';
import { runEval } from '../../../src/eval/eval-runner.js';
import { JUDGE_PROMPT_VERSION } from '../../../src/eval/llm-judge.js';
import type {
  AnswerCorrectnessStatement,
  AnswerEvalOptions,
  AnswerEvalQueryResult,
  AnswerEvalSummary,
  ClaimVerdict,
  EmbedFn,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
  GenerateFn,
  JudgeFn,
} from '../../../src/eval/types.js';

// ---------------------------------------------------------------------------
// — Mock factories: controlled, offline, no network and no API key. Every
//   injected function is plain synchronous-resolve JS, so the suite is
//   deterministic. The judge dispatches on a unique substring of each prompt.
// ---------------------------------------------------------------------------

const okSearchFn =
  (results: EvalSearchResult[]): EvalSearchFn =>
  () =>
    Promise.resolve(results);

const okGenerateFn =
  (answer: string): GenerateFn =>
  () =>
    Promise.resolve(answer);

const throwingGenerateFn = (): GenerateFn => () =>
  Promise.reject(new Error('generation backend down'));

// Violates the GenerateFn contract by resolving a non-string value; the contract
// is not runtime-enforced by the type system, so the orchestrator must guard it.
const nonStringGenerateFn = (): GenerateFn =>
  (() => Promise.resolve({ text: 'not a string' })) as unknown as GenerateFn;

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

const malformedJudgeFn = (): JudgeFn => () => Promise.resolve('这不是合法的 JSON 输出');
const neverJudgeFn = (): JudgeFn => () => new Promise<string>(() => {});
const rejectingJudgeFn = (): JudgeFn => () => Promise.reject(new Error('judge backend 500'));

// Resolves the reference-free judge prompts but rejects the first reference-based
// one (statement classification), so an infrastructure rejection lands AFTER the
// reference-free metrics have already scored.
const lateRejectingJudgeFn =
  (r: JudgeResponses): JudgeFn =>
  (prompt) => {
    if (prompt.includes('原子论断')) return Promise.resolve(JSON.stringify(r.claims ?? []));
    if (prompt.includes('反推')) return Promise.resolve(JSON.stringify(r.reverseQuestions ?? []));
    if (prompt.includes('检索片段')) return Promise.resolve(JSON.stringify(r.usefulFlags ?? []));
    return Promise.reject(new Error('judge backend 500 (reference-based)'));
  };

// Identical vectors → cosine similarity 1 for every reverse question.
const mockEmbedFn =
  (vector: number[]): EmbedFn =>
  (texts) =>
    Promise.resolve(texts.map(() => [...vector]));
const throwingEmbedFn = (): EmbedFn => () => Promise.reject(new Error('embed backend down'));

// ---------------------------------------------------------------------------
// — Shared fixtures (Chinese, self-authored — no private data, no real keys).
// ---------------------------------------------------------------------------

const ANSWER = '入职第一天需要办理报到并领取办公设备。';
const RESULTS: EvalSearchResult[] = [
  { source: 'doc-a.md', content: '入职报到流程：到前台登记后领取工牌。' },
  { source: 'doc-b.md', content: '设备领取：向 IT 申请笔记本电脑与显示器。' },
];

const FULL_RESPONSES: JudgeResponses = {
  claims: [
    { claim: '入职第一天要办理报到', supported: true },
    { claim: '入职第一天要参加培训', supported: false },
  ],
  reverseQuestions: ['入职第一天要做什么？'],
  usefulFlags: [true, false], // aligned to the two chunks above
  statements: [
    { statement: '办理报到', label: 'TP' },
    { statement: '领取设备', label: 'FP' },
  ],
  attributionFlags: [true, true],
};

const EVAL_SET: EvalSet = {
  version: 'test-eval-v1',
  queries: [
    {
      query: '入职第一天要做什么？',
      expected: [{ source: 'doc-a.md' }],
      category: 'onboarding',
      referenceAnswer: '入职第一天需要办理报到与领取设备。',
    },
  ],
};

function makeOpts(overrides: Partial<AnswerEvalOptions> = {}): AnswerEvalOptions {
  return {
    searchFn: okSearchFn(RESULTS),
    generateFn: okGenerateFn(ANSWER),
    judgeFn: mockJudgeFn(FULL_RESPONSES),
    embedFn: mockEmbedFn([1, 0, 0]),
    generateModel: 'mock-generate-model',
    judgeModel: 'mock-judge-model',
    ...overrides,
  };
}

function rowAt(summary: AnswerEvalSummary, i: number): AnswerEvalQueryResult {
  const row = summary.perQuery[i];
  if (!row) throw new Error(`expected a per-query row at index ${i}`);
  return row;
}

describe('runAnswerEval', () => {
  it('computes all five metrics on the happy path (reference + embed present)', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts());
    const row = rowAt(summary, 0);

    expect(row.error).toBeUndefined();
    expect(row.skipped).toBeUndefined();
    expect(row.answer).toBe(ANSWER);
    expect(row.category).toBe('onboarding');
    // faithfulness: 1 of 2 claims supported.
    expect(row.metrics.faithfulness?.score).toBeCloseTo(0.5);
    // contextPrecision: useful chunk ranked first → average precision 1.
    expect(row.metrics.contextPrecision?.score).toBeCloseTo(1);
    // answerRelevance: identical embeddings → cosine 1.
    expect(row.metrics.answerRelevance?.score).toBeCloseTo(1);
    // answerCorrectness: TP=1, FP=1, FN=0 → F1 = 1 / (1 + 0.5).
    expect(row.metrics.answerCorrectness?.score).toBeCloseTo(2 / 3);
    // contextRecall: both reference sentences attributable → 1.
    expect(row.metrics.contextRecall?.score).toBeCloseTo(1);
  });

  it('skips the reference-based pair when the query has no reference answer', async () => {
    const noRef: EvalSet = {
      version: 'test-eval-v1',
      queries: [{ query: '入职第一天要做什么？', expected: [{ source: 'doc-a.md' }] }],
    };
    const summary = await runAnswerEval(noRef, makeOpts());
    const row = rowAt(summary, 0);

    expect(row.error).toBeUndefined();
    expect(row.metrics.faithfulness).toBeDefined();
    expect(row.metrics.answerRelevance).toBeDefined();
    expect(row.metrics.contextPrecision).toBeDefined();
    expect(row.metrics.answerCorrectness).toBeUndefined();
    expect(row.metrics.contextRecall).toBeUndefined();
    expect(row.skipped?.answerCorrectness).toBe('NO_REFERENCE_ANSWER');
    expect(row.skipped?.contextRecall).toBe('NO_REFERENCE_ANSWER');
  });

  it('skips answer relevance when no embed function is injected', async () => {
    const optsNoEmbed: AnswerEvalOptions = {
      searchFn: okSearchFn(RESULTS),
      generateFn: okGenerateFn(ANSWER),
      judgeFn: mockJudgeFn(FULL_RESPONSES),
      generateModel: 'mock-generate-model',
      judgeModel: 'mock-judge-model',
    };
    const summary = await runAnswerEval(EVAL_SET, optsNoEmbed);
    const row = rowAt(summary, 0);

    expect(row.skipped?.answerRelevance).toBe('NO_EMBED_FN');
    expect(row.metrics.answerRelevance).toBeUndefined();
    // The other four metrics are unaffected.
    expect(row.metrics.faithfulness).toBeDefined();
    expect(row.metrics.contextPrecision).toBeDefined();
    expect(row.metrics.answerCorrectness).toBeDefined();
    expect(row.metrics.contextRecall).toBeDefined();
  });

  it('records a missing-chunk error per query without crashing the run', async () => {
    const set: EvalSet = {
      version: 'test-eval-v1',
      queries: [
        { query: 'q-blank', expected: [{ source: 'doc-a.md' }] },
        { query: 'q-good', expected: [{ source: 'doc-a.md' }], referenceAnswer: '参考答案。' },
      ],
    };
    const searchFn: EvalSearchFn = (query) =>
      Promise.resolve(query === 'q-blank' ? [{ source: 'doc-a.md', content: '   ' }] : RESULTS);
    const summary = await runAnswerEval(set, makeOpts({ searchFn }));

    const blank = rowAt(summary, 0);
    expect(blank.error).toContain('EVAL_CONTENT_MISSING');
    expect(blank.metrics.faithfulness).toBeUndefined();

    const good = rowAt(summary, 1);
    expect(good.error).toBeUndefined();
    expect(good.metrics.faithfulness).toBeDefined();
  });

  it('degrades a metric (not the query) when its judge call is malformed', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts({ judgeFn: malformedJudgeFn() }));
    const row = rowAt(summary, 0);

    expect(row.error).toBeUndefined();
    expect(row.metrics.faithfulness).toBeUndefined();
    for (const metric of [
      'faithfulness',
      'contextPrecision',
      'answerRelevance',
      'answerCorrectness',
      'contextRecall',
    ]) {
      expect(row.skipped?.[metric]).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
    }
  });

  it('degrades to a judge-timeout skip when a judge never resolves', async () => {
    const summary = await runAnswerEval(
      EVAL_SET,
      makeOpts({ judgeFn: neverJudgeFn(), judgeTimeoutMs: 10 }),
    );
    const row = rowAt(summary, 0);

    expect(row.error).toBeUndefined();
    expect(row.skipped?.faithfulness).toBe('EVAL_JUDGE_TIMEOUT');
    expect(row.skipped?.contextPrecision).toBe('EVAL_JUDGE_TIMEOUT');
  });

  it('records a per-query error when searchFn throws, continuing other queries', async () => {
    const set: EvalSet = {
      version: 'test-eval-v1',
      queries: [
        { query: 'q-throw', expected: [{ source: 'doc-a.md' }] },
        { query: 'q-ok', expected: [{ source: 'doc-a.md' }], referenceAnswer: '参考答案。' },
      ],
    };
    const searchFn: EvalSearchFn = (query) =>
      query === 'q-throw'
        ? Promise.reject(new Error('search backend down'))
        : Promise.resolve(RESULTS);
    const summary = await runAnswerEval(set, makeOpts({ searchFn }));

    expect(rowAt(summary, 0).error).toContain('search backend down');
    expect(rowAt(summary, 1).error).toBeUndefined();
    expect(rowAt(summary, 1).metrics.faithfulness).toBeDefined();
  });

  it('records a per-query error when generateFn throws', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts({ generateFn: throwingGenerateFn() }));
    expect(rowAt(summary, 0).error).toContain('generation backend down');
  });

  it('records a per-query error when generateFn returns a non-string answer', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts({ generateFn: nonStringGenerateFn() }));
    const row = rowAt(summary, 0);

    // The contract violation is fatal for this query (recorded, not thrown out of
    // the run), and no judge ran so no metric scored and no answer was stored.
    expect(row.error).toContain('non-string answer');
    expect(row.answer).toBeUndefined();
    expect(row.metrics.faithfulness).toBeUndefined();
  });

  it('records a per-query error when the judge backend rejects (infrastructure)', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts({ judgeFn: rejectingJudgeFn() }));
    const row = rowAt(summary, 0);
    expect(row.error).toContain('judge backend 500');
    expect(row.metrics.faithfulness).toBeUndefined();
  });

  it('keeps reference-free metrics when a later reference-based judge call rejects', async () => {
    const summary = await runAnswerEval(
      EVAL_SET,
      makeOpts({ judgeFn: lateRejectingJudgeFn(FULL_RESPONSES) }),
    );
    const row = rowAt(summary, 0);

    // The infrastructure reject lands on a reference-based metric and is recorded
    // as the query's error — but the reference-free metrics scored earlier survive
    // (error and partial metrics legitimately coexist; metrics-when-present stay
    // authoritative).
    expect(row.error).toContain('judge backend 500 (reference-based)');
    expect(row.metrics.faithfulness).toBeDefined();
    expect(row.metrics.contextPrecision).toBeDefined();
    expect(row.metrics.answerRelevance).toBeDefined();
    // The reference-based pair never scored.
    expect(row.metrics.answerCorrectness).toBeUndefined();
    expect(row.metrics.contextRecall).toBeUndefined();
  });

  it('localizes an embed-function failure to answer relevance only', async () => {
    const summary = await runAnswerEval(EVAL_SET, makeOpts({ embedFn: throwingEmbedFn() }));
    const row = rowAt(summary, 0);

    expect(row.error).toBeUndefined();
    expect(row.skipped?.answerRelevance).toContain('embed backend down');
    expect(row.metrics.answerRelevance).toBeUndefined();
    // The other metrics still score.
    expect(row.metrics.faithfulness).toBeDefined();
    expect(row.metrics.contextPrecision).toBeDefined();
    expect(row.metrics.answerCorrectness).toBeDefined();
    expect(row.metrics.contextRecall).toBeDefined();
  });

  it('stamps reproducible version metadata onto the summary', async () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../../package.json') as { version: string };
    const summary = await runAnswerEval(EVAL_SET, makeOpts());

    expect(summary.versionMeta).toEqual({
      generateModel: 'mock-generate-model',
      judgeModel: 'mock-judge-model',
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      toolkitVersion: pkg.version,
      evalSpecVersion: 'test-eval-v1',
    });
    expect(summary.evalSpecVersion).toBe('test-eval-v1');
    expect(summary.topK).toBe(5);
    expect(summary.totalQueries).toBe(1);
    expect(typeof summary.timestamp).toBe('string');
  });

  it('rejects invalid options loudly (blank model, bad topK, missing function)', async () => {
    await expect(runAnswerEval(EVAL_SET, makeOpts({ generateModel: '   ' }))).rejects.toThrow(
      'generateModel',
    );
    await expect(runAnswerEval(EVAL_SET, makeOpts({ judgeModel: '' }))).rejects.toThrow(
      'judgeModel',
    );
    await expect(runAnswerEval(EVAL_SET, makeOpts({ topK: 0 }))).rejects.toThrow('topK');
    await expect(runAnswerEval(EVAL_SET, makeOpts({ topK: -3 }))).rejects.toThrow('topK');
    await expect(runAnswerEval(EVAL_SET, makeOpts({ topK: 1.5 }))).rejects.toThrow('topK');

    const noGenerate = {
      searchFn: okSearchFn(RESULTS),
      judgeFn: mockJudgeFn(FULL_RESPONSES),
      generateModel: 'm',
      judgeModel: 'm',
    } as unknown as AnswerEvalOptions;
    await expect(runAnswerEval(EVAL_SET, noGenerate)).rejects.toThrow('generateFn');
  });

  it('leaves the retrieval runner unchanged (no regression)', async () => {
    const summary = await runEval(
      { version: 'test-eval-v1', queries: [{ query: 'q', expected: [{ source: 'doc-a.md' }] }] },
      { searchFn: okSearchFn([{ source: 'doc-a.md' }]) },
    );
    expect(summary.hitRate).toBe(1);
    expect(summary.totalQueries).toBe(1);
  });
});
