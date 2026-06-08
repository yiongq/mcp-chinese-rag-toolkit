import { describe, expect, it, vi } from 'vitest';

import {
  buildClaimSupportPrompt,
  buildContextAttributionPrompt,
  buildContextUsefulnessPrompt,
  buildReverseQuestionsPrompt,
  buildStatementClassificationPrompt,
  callJudge,
  DEFAULT_JUDGE_TIMEOUT_MS,
  JUDGE_PROMPT_VERSION,
  judgeClaimSupport,
  judgeContextAttribution,
  judgeContextUsefulness,
  judgeReverseQuestions,
  judgeStatementClassification,
} from '../../../src/eval/llm-judge.js';
import type { JudgeFn, JudgeOutcome } from '../../../src/eval/types.js';

// Mock judges — controlled, offline, no network and no API key. A judge here is
// just a function of a prompt to a string (or one that never resolves), so the
// whole suite is deterministic pure JS.
function okJudge(raw: string): JudgeFn {
  return () => Promise.resolve(raw);
}
function neverJudge(): JudgeFn {
  // Never resolves — drives the timeout path with no timer of its own, so it is
  // cleaner than a delayed resolve.
  return () => new Promise<string>(() => {});
}
function rejectJudge(err: unknown): JudgeFn {
  return () => Promise.reject(err);
}

function expectOk<T>(outcome: JudgeOutcome<T>): T {
  if (!outcome.ok) {
    throw new Error(`expected an ok outcome but degraded: ${outcome.error.error}`);
  }
  return outcome.value;
}
function expectDegrade<T>(outcome: JudgeOutcome<T>) {
  if (outcome.ok) {
    throw new Error('expected a degrade outcome but the call succeeded');
  }
  return outcome.error;
}

describe('callJudge', () => {
  it('parses a normal judge response into the requested value', async () => {
    const outcome = await callJudge(okJudge('{"x":1}'), 'p', (raw) => JSON.parse(raw));
    expect(outcome.ok).toBe(true);
    expect(expectOk(outcome)).toEqual({ x: 1 });
  });

  it('degrades non-JSON output to a non-retryable malformed error (no throw)', async () => {
    const outcome = await callJudge(okJudge('not json at all'), 'p', (raw) => JSON.parse(raw));
    const error = expectDegrade(outcome);
    expect(error.error).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('judge output could not be parsed');
  });

  it('degrades when the parser rejects the shape', async () => {
    // The parser demands an array; a bare object is valid JSON of the wrong shape.
    const parse = (raw: string): number[] => {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) throw new TypeError('expected an array');
      return value;
    };
    const outcome = await callJudge(okJudge('{}'), 'p', parse);
    expect(expectDegrade(outcome).error).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
  });

  it('degrades to a retryable timeout when the judge never resolves', async () => {
    const outcome = await callJudge(neverJudge(), 'p', (raw) => raw, { timeoutMs: 10 });
    const error = expectDegrade(outcome);
    expect(error.error).toBe('EVAL_JUDGE_TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('10ms');
  });

  it('propagates a non-timeout judge rejection instead of swallowing it', async () => {
    // A provider/infra failure is neither malformed output nor a wall-clock
    // timeout, so it must surface — the orchestration layer decides what to do.
    await expect(
      callJudge(rejectJudge(new Error('provider 500')), 'p', (raw) => raw),
    ).rejects.toThrow('provider 500');
  });

  it('clears its timeout timer on the happy path (no dangling handle)', async () => {
    vi.useFakeTimers();
    try {
      const outcome = await callJudge(okJudge('{"ok":true}'), 'p', (raw) => JSON.parse(raw));
      expect(outcome.ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes a default timeout constant and a dated prompt version', () => {
    expect(DEFAULT_JUDGE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(JUDGE_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('judgeClaimSupport', () => {
  const answer = '试用期为六个月，期间享有带薪年假。';
  const context = '员工手册：试用期六个月。员工每年享有带薪年假。';

  it('parses claim verdicts from plain JSON', async () => {
    const raw = JSON.stringify([
      { claim: '试用期为六个月', supported: true },
      { claim: '享有带薪年假', supported: true },
    ]);
    const outcome = await judgeClaimSupport(okJudge(raw), { answer, context });
    const verdicts = expectOk(outcome);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toEqual({ claim: '试用期为六个月', supported: true });
  });

  it('tolerates a fenced ```json block', async () => {
    const raw = '```json\n[{"claim":"试用期为六个月","supported":true}]\n```';
    const verdicts = expectOk(await judgeClaimSupport(okJudge(raw), { answer, context }));
    expect(verdicts).toEqual([{ claim: '试用期为六个月', supported: true }]);
  });

  it('tolerates a fenced block wrapped in surrounding prose', async () => {
    const raw =
      '评审结果如下：\n```json\n[{"claim":"享有带薪年假","supported":false}]\n```\n以上。';
    const verdicts = expectOk(await judgeClaimSupport(okJudge(raw), { answer, context }));
    expect(verdicts).toEqual([{ claim: '享有带薪年假', supported: false }]);
  });

  it('degrades when a verdict is missing the supported flag', async () => {
    const raw = JSON.stringify([{ claim: '缺少字段' }]);
    expect(expectDegrade(await judgeClaimSupport(okJudge(raw), { answer, context })).error).toBe(
      'EVAL_JUDGE_MALFORMED_OUTPUT',
    );
  });

  it('degrades on output that is not JSON', async () => {
    const raw = '我认为这些论断基本属实。';
    expect(expectDegrade(await judgeClaimSupport(okJudge(raw), { answer, context })).error).toBe(
      'EVAL_JUDGE_MALFORMED_OUTPUT',
    );
  });

  it('builds a pure prompt carrying the answer, context, and a JSON constraint', () => {
    const prompt = buildClaimSupportPrompt({ answer, context });
    expect(prompt).toBe(buildClaimSupportPrompt({ answer, context }));
    expect(prompt).toContain(answer);
    expect(prompt).toContain(context);
    expect(prompt).toContain('JSON');
    expect(prompt).not.toMatch(/claude|gpt|glm/i);
    expect(prompt).not.toMatch(/serviceId|tenant|citation|confidence/i);
  });
});

describe('judgeReverseQuestions', () => {
  const answer = '试用期为六个月。';

  it('parses a string array of reverse questions', async () => {
    const raw = JSON.stringify(['试用期多久？', '试用期有多长？']);
    const questions = expectOk(await judgeReverseQuestions(okJudge(raw), { answer }));
    expect(questions).toEqual(['试用期多久？', '试用期有多长？']);
  });

  it('degrades when an element is not a string', async () => {
    const raw = JSON.stringify(['试用期多久？', 42]);
    expect(expectDegrade(await judgeReverseQuestions(okJudge(raw), { answer })).error).toBe(
      'EVAL_JUDGE_MALFORMED_OUTPUT',
    );
  });

  it('builds a pure prompt carrying the answer and a JSON constraint', () => {
    const prompt = buildReverseQuestionsPrompt({ answer });
    expect(prompt).toContain(answer);
    expect(prompt).toContain('JSON');
    expect(prompt).not.toMatch(/claude|gpt|glm/i);
  });
});

describe('judgeContextUsefulness', () => {
  const query = '试用期多久？';
  const chunks = ['试用期六个月。', '公司提供免费咖啡。'] as const;

  it('parses a boolean array aligned one-to-one with the chunks', async () => {
    const raw = JSON.stringify([true, false]);
    const flags = expectOk(await judgeContextUsefulness(okJudge(raw), { query, chunks }));
    expect(flags).toEqual([true, false]);
    expect(flags).toHaveLength(chunks.length);
  });

  it('degrades when the flag count does not match the chunk count', async () => {
    const raw = JSON.stringify([true]);
    const error = expectDegrade(await judgeContextUsefulness(okJudge(raw), { query, chunks }));
    expect(error.error).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
  });

  it('degrades when an element is not a boolean', async () => {
    const raw = JSON.stringify([true, 'yes']);
    expect(expectDegrade(await judgeContextUsefulness(okJudge(raw), { query, chunks })).error).toBe(
      'EVAL_JUDGE_MALFORMED_OUTPUT',
    );
  });

  it('builds a pure prompt carrying the query, every chunk, and a JSON constraint', () => {
    const prompt = buildContextUsefulnessPrompt({ query, chunks });
    expect(prompt).toContain(query);
    for (const c of chunks) expect(prompt).toContain(c);
    expect(prompt).toContain('JSON');
    expect(prompt).not.toMatch(/claude|gpt|glm/i);
  });
});

describe('judgeStatementClassification', () => {
  const answer = '试用期为六个月，转正后薪资上调。';
  const referenceAnswer = '试用期为六个月。转正后薪资保持不变。';

  it('parses TP/FP/FN classified statements', async () => {
    const raw = JSON.stringify([
      { statement: '试用期为六个月', label: 'TP' },
      { statement: '转正后薪资上调', label: 'FP' },
      { statement: '转正后薪资保持不变', label: 'FN' },
    ]);
    const statements = expectOk(
      await judgeStatementClassification(okJudge(raw), { answer, referenceAnswer }),
    );
    expect(statements).toHaveLength(3);
    expect(statements.map((s) => s.label)).toEqual(['TP', 'FP', 'FN']);
  });

  it('degrades on a label outside the allowed set', async () => {
    const raw = JSON.stringify([{ statement: '试用期为六个月', label: 'MAYBE' }]);
    expect(
      expectDegrade(await judgeStatementClassification(okJudge(raw), { answer, referenceAnswer }))
        .error,
    ).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
  });

  it('builds a pure prompt carrying both texts and a JSON constraint', () => {
    const prompt = buildStatementClassificationPrompt({ answer, referenceAnswer });
    expect(prompt).toContain(answer);
    expect(prompt).toContain(referenceAnswer);
    expect(prompt).toContain('JSON');
    expect(prompt).not.toMatch(/claude|gpt|glm/i);
  });
});

describe('judgeContextAttribution', () => {
  const referenceAnswer = '试用期为六个月。期间享有带薪年假。';
  const context = '员工手册：试用期六个月，享有带薪年假。';

  it('parses a boolean array in reference-sentence order', async () => {
    const raw = JSON.stringify([true, false]);
    const flags = expectOk(
      await judgeContextAttribution(okJudge(raw), { referenceAnswer, context }),
    );
    expect(flags).toEqual([true, false]);
  });

  it('degrades when an element is not a boolean', async () => {
    const raw = JSON.stringify(['true', false]);
    expect(
      expectDegrade(await judgeContextAttribution(okJudge(raw), { referenceAnswer, context }))
        .error,
    ).toBe('EVAL_JUDGE_MALFORMED_OUTPUT');
  });

  it('builds a pure prompt carrying the reference, context, and a JSON constraint', () => {
    const prompt = buildContextAttributionPrompt({ referenceAnswer, context });
    expect(prompt).toContain(referenceAnswer);
    expect(prompt).toContain(context);
    expect(prompt).toContain('JSON');
    expect(prompt).not.toMatch(/claude|gpt|glm/i);
  });
});
