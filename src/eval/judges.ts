// ---------------------------------------------------------------------------
// — Reference-free answer-quality scoring (RAGAS metric family, pure math)
// ---------------------------------------------------------------------------
//
// faithfulness / answerRelevance / contextPrecision score answer quality
// WITHOUT a gold reference. They are intentionally pure: deterministic (same
// input → same output), synchronous, free of I/O, free of model calls and
// embedding calls. Each consumes an already-extracted, structured input (see
// the contract types in `types.ts`) — the language-model extraction (splitting
// an answer into claims, generating reverse questions, judging chunk
// usefulness) and the embedding of text both happen upstream in the caller.
//
// This separation is what lets the metric formulas be tested offline with no
// API keys and no network, and keeps the scoring layer independent of which
// model or embedding provider produced the inputs.

import { evalError } from './errors.js';
import type {
  AnswerRelevanceInput,
  AnswerRelevanceResult,
  ClaimVerdict,
  ContextPrecisionResult,
  FaithfulnessResult,
} from './types.js';

/**
 * Faithfulness — the fraction of an answer's atomic claims that the retrieved
 * context supports. Higher means less hallucination.
 *
 * `score = supportedClaims / totalClaims`, or `0` when there are no claims.
 * The `0/0 → 0` convention is deliberate (an answer that makes no verifiable
 * claim — e.g. an abstention — is scored as unfaithful, matching the common
 * reference implementation); it is a calibration choice, not a bug.
 *
 * The per-claim support decision is made upstream; this function only
 * aggregates. A claim is counted as supported only when its `supported` flag is
 * strictly `true`, so a missing or non-boolean flag from injected data degrades
 * to "not supported" rather than inflating the score.
 *
 * @throws {@link EvalFrameworkError} (`EVAL_INVALID_METRIC_INPUT`) when
 *   `verdicts` is not an array — the input comes from injected data and is not
 *   guaranteed by the static type at runtime.
 */
export function faithfulness(verdicts: readonly ClaimVerdict[]): FaithfulnessResult {
  if (!Array.isArray(verdicts)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `faithfulness: expected an array of claim verdicts, got ${typeof verdicts}`,
    );
  }
  let supportedClaims = 0;
  for (const v of verdicts) {
    if (v?.supported === true) supportedClaims += 1;
  }
  const totalClaims = verdicts.length;
  const score = totalClaims === 0 ? 0 : supportedClaims / totalClaims;
  return { score, supportedClaims, totalClaims };
}

/**
 * Cosine similarity of two equal-length vectors: `dot(a, b) / (‖a‖·‖b‖)`,
 * ∈ [-1, 1].
 *
 * Inputs are NOT assumed to be unit-normalized (an injected embedding function
 * may or may not normalize). A zero-norm vector yields `0` (not `NaN`), since
 * "no direction" carries no similarity signal.
 *
 * @throws {@link EvalFrameworkError} (`EVAL_INVALID_METRIC_INPUT`) when the
 *   inputs are not arrays, have different lengths, contain a non-finite value
 *   (`NaN` / `±Infinity`), or when an intermediate sum overflows to a non-finite
 *   value. These are structural faults from injected data and must fail loudly
 *   rather than silently produce a meaningless number.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      'cosineSimilarity: both inputs must be number arrays',
    );
  }
  if (a.length !== b.length) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined || !Number.isFinite(ai) || !Number.isFinite(bi)) {
      throw evalError(
        'EVAL_INVALID_METRIC_INPUT',
        `cosineSimilarity: vector contains a non-finite value at index ${i}`,
      );
    }
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  // Individually-finite inputs can still overflow when summed (e.g. components
  // near `Number.MAX_VALUE`), turning an accumulator into `±Infinity` and the
  // result into `NaN`. Catch that here rather than returning a meaningless value.
  if (!Number.isFinite(dot) || !Number.isFinite(normA) || !Number.isFinite(normB)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      'cosineSimilarity: intermediate sum overflowed to a non-finite value',
    );
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Answer relevance — how well an answer addresses the original query, scored by
 * the RAGAS reverse-question method. Reverse questions are generated upstream
 * from the answer; this function measures how close each one is to the original
 * query via cosine similarity, then averages.
 *
 * `score = mean(perQuestionSimilarity)`, or `0` when there are no reverse
 * questions. The score is NOT clamped: it ranges over [-1, 1], where a negative
 * value means the reverse question points away from the query. Filtering out
 * evasive ("noncommittal") answers is the caller's responsibility, not this
 * function's.
 *
 * @throws {@link EvalFrameworkError} (`EVAL_INVALID_METRIC_INPUT`) when `input`
 *   is not an object, or either embedding field is not an array, or (propagated
 *   from {@link cosineSimilarity}) an embedding has a length mismatch against
 *   the query embedding or contains a non-finite value. Like the other scoring
 *   functions, these structural faults from injected data fail loudly here.
 */
export function answerRelevance(input: AnswerRelevanceInput): AnswerRelevanceResult {
  // `input` is provider-injected and not guaranteed by the static type at
  // runtime, so guard its shape before destructuring (a raw `TypeError` would
  // otherwise escape uncoded and bypass the `EVAL_INVALID_METRIC_INPUT` branch).
  const raw = input as unknown;
  if (raw === null || typeof raw !== 'object') {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `answerRelevance: expected an input object, got ${raw === null ? 'null' : typeof raw}`,
    );
  }
  const { queryEmbedding, generatedQuestionEmbeddings } = input;
  if (!Array.isArray(queryEmbedding)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `answerRelevance: queryEmbedding must be an array, got ${typeof queryEmbedding}`,
    );
  }
  if (!Array.isArray(generatedQuestionEmbeddings)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `answerRelevance: generatedQuestionEmbeddings must be an array, got ${typeof generatedQuestionEmbeddings}`,
    );
  }
  const perQuestionSimilarity: number[] = [];
  for (const questionEmbedding of generatedQuestionEmbeddings) {
    // Query first so a propagated length-mismatch message reads "(query vs
    // question)"; cosine is symmetric, so the score is unaffected by the order.
    perQuestionSimilarity.push(cosineSimilarity(queryEmbedding, questionEmbedding));
  }
  const score =
    perQuestionSimilarity.length === 0
      ? 0
      : perQuestionSimilarity.reduce((sum, s) => sum + s, 0) / perQuestionSimilarity.length;
  return { score, perQuestionSimilarity };
}

/**
 * Context precision — order-sensitive average precision over a ranked list of
 * retrieved chunks, each flagged useful or not. Useful chunks that rank higher
 * contribute more, rewarding a retriever that puts the relevant context first.
 * This follows the average-precision intuition (Manning & Raghavan §8.4),
 * normalized over the useful chunks present in the provided ranked list — so the
 * score reflects ordering within what was retrieved, not corpus-level recall.
 *
 * For each position `k` (1-indexed), `precision@k = (useful in first k) / k`.
 * The score sums `precision@k` over only the useful positions and divides by the
 * total number of useful chunks (i.e. the mean of `precision@k` across the
 * useful positions). It is `0` when the list is empty or contains no useful
 * chunk.
 *
 * A chunk counts as useful only when its flag is strictly `true`, so a
 * malformed (non-boolean) flag degrades to "not useful".
 *
 * @throws {@link EvalFrameworkError} (`EVAL_INVALID_METRIC_INPUT`) when
 *   `usefulFlags` is not an array.
 */
export function contextPrecision(usefulFlags: readonly boolean[]): ContextPrecisionResult {
  if (!Array.isArray(usefulFlags)) {
    throw evalError(
      'EVAL_INVALID_METRIC_INPUT',
      `contextPrecision: expected an array of usefulness flags, got ${typeof usefulFlags}`,
    );
  }
  const total = usefulFlags.length;
  let usefulCount = 0;
  let precisionSum = 0;
  for (let i = 0; i < total; i += 1) {
    if (usefulFlags[i] === true) {
      usefulCount += 1;
      precisionSum += usefulCount / (i + 1);
    }
  }
  const score = usefulCount === 0 ? 0 : precisionSum / usefulCount;
  return { score, usefulCount, total };
}
