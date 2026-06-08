import { describe, expect, it } from 'vitest';

import { EvalFrameworkError } from '../../../src/eval/errors.js';
import {
  answerRelevance,
  contextPrecision,
  cosineSimilarity,
  faithfulness,
} from '../../../src/eval/judges.js';
import type { ClaimVerdict } from '../../../src/eval/types.js';

// Small offline fixtures. Claim text is neutral Chinese so the suite needs no
// model, no embeddings download, and no network. Embeddings are hand-written
// constant vectors so every expected value is exact and auditable.
function claim(text: string, supported: boolean): ClaimVerdict {
  return { claim: text, supported };
}

describe('faithfulness', () => {
  const cases: Array<{ label: string; verdicts: ClaimVerdict[]; score: number }> = [
    {
      label: 'all claims supported → 1',
      verdicts: [claim('试用期为六个月。', true), claim('每年享有带薪年假。', true)],
      score: 1,
    },
    {
      label: 'no claims supported → 0',
      verdicts: [claim('公司提供免费午餐。', false), claim('周末双休。', false)],
      score: 0,
    },
    {
      label: 'half supported → 0.5',
      verdicts: [
        claim('试用期为六个月。', true),
        claim('每年享有带薪年假。', true),
        claim('公司提供免费午餐。', false),
        claim('周末双休。', false),
      ],
      score: 0.5,
    },
    { label: 'single supported claim → 1', verdicts: [claim('试用期为六个月。', true)], score: 1 },
    { label: 'single unsupported claim → 0', verdicts: [claim('周末双休。', false)], score: 0 },
    { label: 'empty claim list → 0', verdicts: [], score: 0 },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const result = faithfulness(c.verdicts);
      expect(result.score).toBe(c.score);
      expect(result.totalClaims).toBe(c.verdicts.length);
      expect(result.supportedClaims).toBe(c.verdicts.filter((v) => v.supported).length);
    });
  }

  it('returns auditable supported / total counts', () => {
    const result = faithfulness([claim('a', true), claim('b', true), claim('c', false)]);
    expect(result).toEqual({ score: 2 / 3, supportedClaims: 2, totalClaims: 3 });
  });

  it('is deterministic: same input yields an equal result twice', () => {
    const verdicts = [claim('试用期为六个月。', true), claim('周末双休。', false)];
    expect(faithfulness(verdicts)).toEqual(faithfulness(verdicts));
  });

  it('throws EVAL_INVALID_METRIC_INPUT for a non-array input', () => {
    const bad = null as unknown as ClaimVerdict[];
    expect(() => faithfulness(bad)).toThrow(EvalFrameworkError);
    try {
      faithfulness(bad);
    } catch (e) {
      expect((e as EvalFrameworkError).code).toBe('EVAL_INVALID_METRIC_INPUT');
    }
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 12);
  });

  it('returns 1 for same-direction non-unit vectors (no normalization assumed)', () => {
    expect(cosineSimilarity([3, 0], [5, 0])).toBeCloseTo(1, 12);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 12);
  });

  it('matches a known closed-form value', () => {
    // a·b = 4, ‖a‖ = ‖b‖ = √5, so cos = 4 / 5 = 0.8
    expect(cosineSimilarity([1, 2], [2, 1])).toBeCloseTo(0.8, 12);
  });

  it('returns 0 when either vector has zero norm (no NaN)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('throws EVAL_INVALID_METRIC_INPUT on length mismatch', () => {
    let caught: unknown;
    try {
      cosineSimilarity([1, 0], [1, 0, 0]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EvalFrameworkError);
    expect((caught as EvalFrameworkError).code).toBe('EVAL_INVALID_METRIC_INPUT');
  });

  const nonFiniteCases: Array<{ label: string; a: number[]; b: number[] }> = [
    { label: 'NaN', a: [Number.NaN, 1], b: [1, 1] },
    { label: '+Infinity', a: [1, 1], b: [Number.POSITIVE_INFINITY, 1] },
    { label: '-Infinity', a: [Number.NEGATIVE_INFINITY, 1], b: [1, 1] },
  ];
  for (const c of nonFiniteCases) {
    it(`throws EVAL_INVALID_METRIC_INPUT on a ${c.label} value`, () => {
      let caught: unknown;
      try {
        cosineSimilarity(c.a, c.b);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EvalFrameworkError);
      expect((caught as EvalFrameworkError).code).toBe('EVAL_INVALID_METRIC_INPUT');
    });
  }
});

describe('answerRelevance', () => {
  it('returns 1 when the single reverse question matches the query direction', () => {
    const result = answerRelevance({
      queryEmbedding: [1, 0, 0],
      generatedQuestionEmbeddings: [[1, 0, 0]],
    });
    expect(result.score).toBeCloseTo(1, 12);
    expect(result.perQuestionSimilarity).toHaveLength(1);
  });

  it('averages the per-question similarities for mixed reverse questions', () => {
    const result = answerRelevance({
      queryEmbedding: [1, 0],
      generatedQuestionEmbeddings: [
        [1, 0],
        [0, 1],
      ],
    });
    expect(result.perQuestionSimilarity[0]).toBeCloseTo(1, 12);
    expect(result.perQuestionSimilarity[1]).toBeCloseTo(0, 12);
    expect(result.score).toBeCloseTo(0.5, 12);
  });

  it('returns 0 for an empty reverse-question list', () => {
    const result = answerRelevance({ queryEmbedding: [1, 0], generatedQuestionEmbeddings: [] });
    expect(result.score).toBe(0);
    expect(result.perQuestionSimilarity).toEqual([]);
  });

  it('keeps perQuestionSimilarity aligned with the input length', () => {
    const result = answerRelevance({
      queryEmbedding: [1, 0],
      generatedQuestionEmbeddings: [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
    });
    expect(result.perQuestionSimilarity).toHaveLength(3);
  });

  it('is deterministic across repeated calls', () => {
    const input = {
      queryEmbedding: [1, 0],
      generatedQuestionEmbeddings: [
        [1, 0],
        [0, 1],
      ],
    };
    expect(answerRelevance(input)).toEqual(answerRelevance(input));
  });
});

describe('contextPrecision', () => {
  const cases: Array<{ label: string; flags: boolean[]; score: number }> = [
    { label: '[true] → 1', flags: [true], score: 1 },
    { label: '[false] → 0', flags: [false], score: 0 },
    { label: '[true, false] → 1', flags: [true, false], score: 1 },
    { label: '[false, true] → 0.5', flags: [false, true], score: 0.5 },
    { label: '[true, true] → 1', flags: [true, true], score: 1 },
    { label: '[false, false] → 0', flags: [false, false], score: 0 },
    { label: '[] → 0', flags: [], score: 0 },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const result = contextPrecision(c.flags);
      expect(result.score).toBeCloseTo(c.score, 12);
      expect(result.total).toBe(c.flags.length);
      expect(result.usefulCount).toBe(c.flags.filter((f) => f).length);
    });
  }

  it('is order-sensitive: an earlier useful chunk scores higher', () => {
    const front = contextPrecision([true, false, true]);
    const back = contextPrecision([false, true, true]);
    expect(front.score).toBeGreaterThan(back.score);
    // Closed-form: front = (1/1 + 2/3) / 2 ≈ 0.8333; back = (1/2 + 2/3) / 2 ≈ 0.5833
    expect(front.score).toBeCloseTo((1 + 2 / 3) / 2, 12);
    expect(back.score).toBeCloseTo((0.5 + 2 / 3) / 2, 12);
  });

  it('throws EVAL_INVALID_METRIC_INPUT for a non-array input', () => {
    const bad = undefined as unknown as boolean[];
    expect(() => contextPrecision(bad)).toThrow(EvalFrameworkError);
    try {
      contextPrecision(bad);
    } catch (e) {
      expect((e as EvalFrameworkError).code).toBe('EVAL_INVALID_METRIC_INPUT');
    }
  });
});
