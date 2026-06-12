// ---------------------------------------------------------------------------
// — Answer-eval orchestration (retrieval → generation → judge → score → stamp)
// ---------------------------------------------------------------------------
//
// `runAnswerEval` is the single provider-injection entry point that wires the
// already-built layers into one answer-quality evaluation: it retrieves context
// with an injected search function, generates an answer from that context, drives
// the judge tasks, feeds their structured output to the pure scoring functions,
// and stamps the run with reproducible version metadata. It is an ORCHESTRATOR
// only — it neither builds prompts, parses model output, nor computes any metric
// formula; those stay in their own layers and are merely called here.
//
// Resilience mirrors the retrieval runner: a fault fatal to ONE query — a
// throwing search/generate function, a missing chunk, or a judge infrastructure
// rejection — is recorded on that query's row and the run continues, so a single
// bad query never collapses the whole run into an opaque exit. A judge that
// merely DEGRADES (a timeout or malformed output) skips just its own metric while
// the remaining metrics still score.

import { assertContentPopulated, EvalFrameworkError } from './errors.js';
import { DEFAULT_EVAL_TOP_K } from './eval-runner.js';
import {
  answerCorrectness,
  answerRelevance,
  contextPrecision,
  contextRecall,
  faithfulness,
} from './judges.js';
import {
  JUDGE_PROMPT_VERSION,
  judgeClaimSupport,
  judgeContextAttribution,
  judgeContextUsefulness,
  judgeReverseQuestions,
  judgeStatementClassification,
} from './llm-judge.js';
import { readToolkitVersion } from './toolkit-version.js';
import type {
  AnswerEvalOptions,
  AnswerEvalQueryResult,
  AnswerEvalSummary,
  AnswerEvalVersionMeta,
  EvalQuery,
  EvalSearchResult,
  EvalSet,
  JudgeCallOptions,
  JudgeOutcome,
} from './types.js';

/** Skip reason recorded when answer relevance has no injected embed function. */
const NO_EMBED_FN = 'NO_EMBED_FN';
/** Skip reason recorded when a reference-based metric has no reference answer. */
const NO_REFERENCE_ANSWER = 'NO_REFERENCE_ANSWER';

/**
 * Run a whole answer-quality evaluation over an eval set, returning the per-query
 * metrics plus reproducible version metadata. Retrieval, generation, judging and
 * embedding are all caller-injected so the toolkit binds to no specific model or
 * provider; a deterministic mock drives the whole thing in CI with no API key.
 *
 * For each query it retrieves top-K context, generates an answer from it, then
 * computes up to five RAGAS metrics — faithfulness, answer relevance and context
 * precision (reference-free), plus answer correctness and context recall
 * (reference-based, computed only when the query carries a reference answer).
 * Metrics whose inputs are unavailable are skipped (never faked) and explained on
 * the row; per-query faults are recorded, not thrown, so the run completes.
 *
 * Note: `answerCorrectness` reports the statement-level F1 component only; the
 * full RAGAS metric blends it with an answer–reference semantic similarity term,
 * which needs another embedding pass and is left to a later calibration step.
 *
 * @throws when the options are invalid (a non-positive `topK`, a non-function
 *   injection, or a blank model name) — a caller bug worth failing loudly on — or
 *   when the toolkit version cannot be resolved (a broken packaging invariant).
 */
export async function runAnswerEval(
  evalSet: EvalSet,
  opts: AnswerEvalOptions,
): Promise<AnswerEvalSummary> {
  const topK = opts.topK ?? DEFAULT_EVAL_TOP_K;
  validateOptions(opts, topK);

  // Read the toolkit version up front so a broken packaging invariant fails fast,
  // before spending a whole run's worth of judge calls.
  const toolkitVersion = readToolkitVersion();

  const judgeOpts: JudgeCallOptions | undefined =
    opts.judgeTimeoutMs !== undefined ? { timeoutMs: opts.judgeTimeoutMs } : undefined;

  const perQuery: AnswerEvalQueryResult[] = [];
  for (const query of evalSet.queries) {
    perQuery.push(await evaluateQuery(query, opts, topK, judgeOpts));
  }

  const versionMeta: AnswerEvalVersionMeta = {
    generateModel: opts.generateModel,
    judgeModel: opts.judgeModel,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    toolkitVersion,
    evalSpecVersion: evalSet.version,
  };

  return {
    evalSpecVersion: evalSet.version,
    timestamp: new Date().toISOString(),
    totalQueries: perQuery.length,
    topK,
    versionMeta,
    perQuery,
  };
}

/** Fail loudly on a caller mistake before doing any work (mirrors `runEval`). */
function validateOptions(opts: AnswerEvalOptions, topK: number): void {
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`runAnswerEval: topK must be a positive integer, got ${String(topK)}`);
  }
  if (typeof opts.searchFn !== 'function') {
    throw new Error('runAnswerEval: opts.searchFn must be a function');
  }
  if (typeof opts.generateFn !== 'function') {
    throw new Error('runAnswerEval: opts.generateFn must be a function');
  }
  if (typeof opts.judgeFn !== 'function') {
    throw new Error('runAnswerEval: opts.judgeFn must be a function');
  }
  if (opts.embedFn !== undefined && typeof opts.embedFn !== 'function') {
    throw new Error('runAnswerEval: opts.embedFn must be a function when provided');
  }
  // A blank model name would silently poison the audit trail — metadata that
  // cannot be trusted is worse than metadata that is loudly missing.
  if (typeof opts.generateModel !== 'string' || opts.generateModel.trim() === '') {
    throw new Error('runAnswerEval: opts.generateModel must be a non-empty string');
  }
  if (typeof opts.judgeModel !== 'string' || opts.judgeModel.trim() === '') {
    throw new Error('runAnswerEval: opts.judgeModel must be a non-empty string');
  }
}

/**
 * Evaluate one query end to end. Two failure granularities, by design:
 *  - a judge DEGRADE (timeout / malformed) skips only its own metric;
 *  - a fault fatal to the query — a throwing search/generate function, a missing
 *    chunk, or a judge INFRASTRUCTURE rejection (the shared judge backend is down,
 *    so the remaining judge metrics could not run either) — is recorded as the
 *    row's `error`. An embed-function failure is localized to answer relevance
 *    (its only consumer), so it degrades that metric alone, not the whole query.
 */
async function evaluateQuery(
  query: EvalQuery,
  opts: AnswerEvalOptions,
  topK: number,
  judgeOpts: JudgeCallOptions | undefined,
): Promise<AnswerEvalQueryResult> {
  const row: AnswerEvalQueryResult = { query: query.query, metrics: {} };
  if (query.category !== undefined) row.category = query.category;
  const skipped: Record<string, string> = {};

  try {
    // 1. Retrieve context. A throw or a non-array is fatal for this query.
    let rawResults: EvalSearchResult[];
    try {
      rawResults = await opts.searchFn(query.query, {
        topK,
        // Conditional spread keeps single-turn calls byte-identical under
        // exactOptionalPropertyTypes (no `history: undefined` key).
        ...(query.history !== undefined ? { history: query.history } : {}),
      });
    } catch (err) {
      row.error = errorMessage(err);
      return finalize(row, skipped);
    }
    if (!Array.isArray(rawResults)) {
      row.error = `runAnswerEval: searchFn for query="${query.query}" returned a non-array (got ${typeof rawResults})`;
      return finalize(row, skipped);
    }
    // Enforce the same top-K bound the retriever was asked for, so an over-eager
    // provider returning extra rows cannot widen the judged context.
    const results = rawResults.slice(0, topK);

    // 2. Require usable content on every chunk (no `content!` shortcut). A blank
    //    or non-string chunk is a fatal-for-this-query EVAL_CONTENT_MISSING.
    const chunks: string[] = [];
    for (const result of results) {
      assertContentPopulated(result);
      chunks.push(result.content);
    }
    const context = chunks.join('\n\n');

    // 3. Generate the answer under evaluation. A throw is fatal for this query.
    //    generateFn is caller-injected and not runtime type-checked, so a
    //    non-string return would silently stringify into the judge prompts (as
    //    '[object Object]', 'null', etc.) and corrupt every score with no error.
    //    Treat a non-string answer as fatal-for-this-query, mirroring the content
    //    guard on retrieved chunks. (An empty string IS a valid answer — a model
    //    abstention scores 0 by design — so only the type, not the length, is
    //    enforced here.)
    const answer = await opts.generateFn({
      query: query.query,
      context,
      ...(query.history !== undefined ? { history: query.history } : {}),
    });
    if (typeof answer !== 'string') {
      throw new Error(
        `runAnswerEval: generateFn for query="${query.query}" returned a non-string answer ` +
          `(got ${typeof answer})`,
      );
    }
    row.answer = answer;

    // 4. Reference-free metrics.
    const claims = await runJudgeMetric(
      judgeClaimSupport(opts.judgeFn, { answer, context }, judgeOpts),
      'faithfulness',
      skipped,
    );
    if (claims !== undefined) row.metrics.faithfulness = faithfulness(claims);

    const usefulFlags = await runJudgeMetric(
      judgeContextUsefulness(opts.judgeFn, { query: query.query, chunks }, judgeOpts),
      'contextPrecision',
      skipped,
    );
    if (usefulFlags !== undefined) row.metrics.contextPrecision = contextPrecision(usefulFlags);

    await scoreAnswerRelevance(row, skipped, query.query, answer, opts, judgeOpts);

    // 5. Reference-based metrics — only when the query carries a reference answer.
    const referenceAnswer = query.referenceAnswer;
    if (referenceAnswer === undefined) {
      skipped.answerCorrectness = NO_REFERENCE_ANSWER;
      skipped.contextRecall = NO_REFERENCE_ANSWER;
    } else {
      const statements = await runJudgeMetric(
        judgeStatementClassification(opts.judgeFn, { answer, referenceAnswer }, judgeOpts),
        'answerCorrectness',
        skipped,
      );
      if (statements !== undefined) row.metrics.answerCorrectness = answerCorrectness(statements);

      const attribution = await runJudgeMetric(
        judgeContextAttribution(opts.judgeFn, { referenceAnswer, context }, judgeOpts),
        'contextRecall',
        skipped,
      );
      if (attribution !== undefined) row.metrics.contextRecall = contextRecall(attribution);
    }
  } catch (err) {
    // A fault that propagated out of a step above is fatal for this query only: a
    // missing chunk, a throwing generate function, or a judge infrastructure
    // rejection. Record it and let the run continue with the next query.
    row.error = errorMessage(err);
  }

  return finalize(row, skipped);
}

/**
 * Answer relevance needs reverse questions (from the judge) embedded alongside the
 * query (from the embed function). It is skipped when no embed function is
 * injected; an embed-function fault degrades THIS metric only — it is the metric's
 * sole input and cannot invalidate the others — rather than failing the query. A
 * judge rejection here still propagates (it is the shared judge backend) and is
 * handled by the per-query error path.
 */
async function scoreAnswerRelevance(
  row: AnswerEvalQueryResult,
  skipped: Record<string, string>,
  query: string,
  answer: string,
  opts: AnswerEvalOptions,
  judgeOpts: JudgeCallOptions | undefined,
): Promise<void> {
  const embedFn = opts.embedFn;
  if (embedFn === undefined) {
    skipped.answerRelevance = NO_EMBED_FN;
    return;
  }
  const questions = await runJudgeMetric(
    judgeReverseQuestions(opts.judgeFn, { answer }, judgeOpts),
    'answerRelevance',
    skipped,
  );
  if (questions === undefined) return; // judge degraded; already recorded as a skip
  try {
    const embeddings = await embedFn([query, ...questions]);
    const expected = questions.length + 1;
    if (!Array.isArray(embeddings) || embeddings.length !== expected) {
      skipped.answerRelevance = `embed function returned ${
        Array.isArray(embeddings) ? embeddings.length : 'a non-array'
      } vectors, expected ${expected}`;
      return;
    }
    const queryEmbedding = embeddings[0];
    if (queryEmbedding === undefined) {
      skipped.answerRelevance = 'embed function returned an empty query embedding';
      return;
    }
    row.metrics.answerRelevance = answerRelevance({
      queryEmbedding,
      generatedQuestionEmbeddings: embeddings.slice(1),
    });
  } catch (err) {
    skipped.answerRelevance = errorMessage(err);
  }
}

/**
 * Await a judge task and split its outcome: an OK outcome returns the parsed value
 * to score; a DEGRADE (timeout / malformed) records a metric-level skip and
 * returns `undefined`. A judge REJECTION is an infrastructure fault and is NOT
 * caught here — it propagates so the per-query handler records it as a query
 * error (the shared judge backend being down means no metric could run anyway).
 */
async function runJudgeMetric<T>(
  task: Promise<JudgeOutcome<T>>,
  metric: string,
  skipped: Record<string, string>,
): Promise<T | undefined> {
  const outcome = await task;
  if (outcome.ok) return outcome.value;
  skipped[metric] = outcome.error.error;
  return undefined;
}

/** Attach the skip map only when non-empty (exactOptionalPropertyTypes). */
function finalize(
  row: AnswerEvalQueryResult,
  skipped: Record<string, string>,
): AnswerEvalQueryResult {
  if (Object.keys(skipped).length > 0) row.skipped = skipped;
  return row;
}

/**
 * Normalize an unknown thrown value to a message. An eval framework error is
 * prefixed with its stable code so a coded fault (e.g. a missing chunk's
 * EVAL_CONTENT_MISSING) stays greppable in the recorded `error` string.
 */
function errorMessage(err: unknown): string {
  if (err instanceof EvalFrameworkError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? (err.message ?? String(err)) : String(err);
}
