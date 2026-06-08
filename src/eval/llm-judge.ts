// ---------------------------------------------------------------------------
// — LLM-facing judge layer (prompt construction, judge call, parse, degrade)
// ---------------------------------------------------------------------------
//
// This is the impure boundary that drives an injected language-model judge and
// turns its raw text into the already-structured inputs the pure scoring layer
// (`judges.ts`) consumes. It is the only place in the eval engine that does
// async I/O, builds prompt strings, and parses model output. Two judge-output
// failure modes — a wall-clock timeout and malformed output — DEGRADE here
// (returned, never thrown) so the non-determinism of a real model stays
// contained in this thin, mockable layer and the scoring functions stay pure.
//
// A judge can be exercised in CI with a deterministic mock (a function that
// returns a controlled string, or never resolves), so this layer's robustness
// is testable with no API keys and no network.

import { z } from 'zod';

import { EVAL_ERROR_CODES } from './errors.js';
import type {
  AnswerCorrectnessStatement,
  ClaimVerdict,
  JudgeCallOptions,
  JudgeFn,
  JudgeOutcome,
} from './types.js';

/** Default wall-clock budget for a judge call before it degrades to a timeout. */
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

/**
 * Version stamp for the judge prompt prose, bumped whenever the prompt wording
 * changes so a run can record which prompt produced its scores. A judge's output
 * depends on its prompt, so calibration treats this as part of the run metadata;
 * any edit to the prompt strings below MUST bump this date string.
 */
export const JUDGE_PROMPT_VERSION = '2026-06-09';

/**
 * Drive an LLM judge: race `judgeFn(prompt)` against a wall-clock timeout, then
 * run `parse` on the raw text. Returns a discriminated outcome and NEVER throws
 * for the two judge-output failure modes:
 *  - timeout                       → degrade `EVAL_JUDGE_TIMEOUT` (retryable: true)
 *  - `parse` throws / invalid shape → degrade `EVAL_JUDGE_MALFORMED_OUTPUT` (retryable: false)
 *
 * A `judgeFn` REJECTION that is not a timeout (e.g. a provider 500, a network
 * fault, an auth failure) is an infrastructure fault, not a judge-output fault —
 * it PROPAGATES out of this call unchanged. Deciding whether to catch-and-record
 * or surface that belongs to the orchestration step, not here; folding it into
 * either judge code would blur their precise meaning.
 *
 * The judge function carries no abort signal, so a timeout only stops the
 * waiting: a slow `judgeFn` promise that resolves later is ignored. That is
 * acceptable for an eval call.
 */
export async function callJudge<T>(
  judgeFn: JudgeFn,
  prompt: string,
  parse: (raw: string) => T,
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<T>> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  // A resolved sentinel (not a rejection) keeps "timed out" a definite value
  // check, never confused with a genuine `judgeFn` rejection.
  const TIMEOUT = Symbol('judge-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      judgeFn(prompt),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
      }),
    ]);
    if (raced === TIMEOUT) {
      return {
        ok: false,
        error: {
          error: EVAL_ERROR_CODES.EVAL_JUDGE_TIMEOUT,
          message: `judge call exceeded ${timeoutMs}ms`,
          retryable: true,
        },
      };
    }
    try {
      return { ok: true, value: parse(raced) };
    } catch (e) {
      return {
        ok: false,
        error: {
          error: EVAL_ERROR_CODES.EVAL_JUDGE_MALFORMED_OUTPUT,
          message: `judge output could not be parsed: ${
            e instanceof Error ? e.message : 'unknown error'
          }`,
          retryable: false,
        },
      };
    }
  } finally {
    // Must clear on every path — the happy path would otherwise leave a dangling
    // timer that keeps the process (and the test runner) awake.
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// — JSON extraction (tolerant of fences / surrounding prose, strict on shape)
// ---------------------------------------------------------------------------

/**
 * Pull a JSON value out of a judge's raw text. A real model almost always wraps
 * its JSON in a ```` ```json ```` fence or surrounds it with prose; a bare
 * `JSON.parse` would then flag every real call as malformed. This relaxes the
 * WRAPPING only — it strips a fenced block, trims, and as a last resort slices
 * from the first `{`/`[` to the last `}`/`]` — then parses. The shape is still
 * validated strictly by the caller's schema; this never relaxes the shape.
 *
 * Throws `SyntaxError` when no JSON value can be recovered (the caller's
 * `callJudge` turns that into a malformed-output degrade).
 */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to a best-effort slice between the outermost brackets.
  }
  const firstBracket = candidate.search(/[[{]/);
  const lastCurly = candidate.lastIndexOf('}');
  const lastSquare = candidate.lastIndexOf(']');
  const lastBracket = Math.max(lastCurly, lastSquare);
  if (firstBracket === -1 || lastBracket <= firstBracket) {
    throw new SyntaxError('no JSON object or array found in judge output');
  }
  return JSON.parse(candidate.slice(firstBracket, lastBracket + 1));
}

// ---------------------------------------------------------------------------
// — Parsers (zod-strict on the target shape; malformed input throws → degrade)
// ---------------------------------------------------------------------------

const claimVerdictsSchema = z.array(z.object({ claim: z.string(), supported: z.boolean() }));
const reverseQuestionsSchema = z.array(z.string());
const booleanFlagsSchema = z.array(z.boolean());
const statementsSchema = z.array(
  z.object({ statement: z.string(), label: z.enum(['TP', 'FP', 'FN']) }),
);

function parseClaimVerdicts(raw: string): ClaimVerdict[] {
  return claimVerdictsSchema.parse(extractJson(raw));
}

function parseReverseQuestions(raw: string): string[] {
  return reverseQuestionsSchema.parse(extractJson(raw));
}

function parseStatements(raw: string): AnswerCorrectnessStatement[] {
  return statementsSchema.parse(extractJson(raw));
}

/** Parse a boolean array and require it to line up one-to-one with the input. */
function parseAlignedFlags(raw: string, expectedLength: number): boolean[] {
  const flags = booleanFlagsSchema.parse(extractJson(raw));
  if (flags.length !== expectedLength) {
    throw new RangeError(
      `expected ${expectedLength} flags aligned to the input, got ${flags.length}`,
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// — Prompt builders (pure: same input → same string; testable without a judge)
// ---------------------------------------------------------------------------

// A shared instruction tail keeps every prompt's output contract identical: the
// judge must emit ONLY JSON, no prose, no fence — the parser is tolerant of a
// fence anyway, but asking for clean JSON keeps real calls cheap to parse.
const JSON_ONLY = '只输出 JSON，不要附加任何解释、说明或代码围栏。';

/** Build the prompt that splits an answer into atomic claims and marks support. */
export function buildClaimSupportPrompt(input: { answer: string; context: string }): string {
  return [
    '你是严谨的评审。把下面的「回答」拆成若干原子论断，',
    '并依据「上下文」判断每条论断是否被上下文支撑。',
    '输出 JSON 数组，每个元素形如 {"claim": "论断文本", "supported": true 或 false}。',
    JSON_ONLY,
    '',
    `【回答】\n${input.answer}`,
    '',
    `【上下文】\n${input.context}`,
  ].join('\n');
}

/** Build the prompt that derives the questions an answer is implicitly answering. */
export function buildReverseQuestionsPrompt(input: { answer: string }): string {
  return [
    '你是严谨的评审。阅读下面的「回答」，反推它实际在回答哪些问题。',
    '输出 JSON 字符串数组，每个元素是一个问题文本。',
    JSON_ONLY,
    '',
    `【回答】\n${input.answer}`,
  ].join('\n');
}

/** Build the prompt that flags each retrieved chunk as useful for the query. */
export function buildContextUsefulnessPrompt(input: {
  query: string;
  chunks: readonly string[];
}): string {
  const numbered = input.chunks.map((c, i) => `[${i}] ${c}`).join('\n');
  return [
    '你是严谨的评审。对下面每个带编号的「检索片段」，',
    '判断它对回答「问题」是否有用。',
    `输出 JSON 布尔数组，长度等于片段数量（${input.chunks.length}），`,
    '顺序与片段编号一一对应：第 i 个布尔值对应编号 [i] 的片段。',
    JSON_ONLY,
    '',
    `【问题】\n${input.query}`,
    '',
    `【检索片段】\n${numbered}`,
  ].join('\n');
}

/** Build the prompt that classifies each answer statement against a reference. */
export function buildStatementClassificationPrompt(input: {
  answer: string;
  referenceAnswer: string;
}): string {
  return [
    '你是严谨的评审。对照「参考答案」，把「回答」拆成若干陈述并分类：',
    'TP 表示该陈述同时出现在回答与参考答案；',
    'FP 表示该陈述出现在回答但不在参考答案；',
    'FN 表示该陈述出现在参考答案但回答遗漏。',
    '输出 JSON 数组，每个元素形如 {"statement": "陈述文本", "label": "TP" 或 "FP" 或 "FN"}。',
    JSON_ONLY,
    '',
    `【回答】\n${input.answer}`,
    '',
    `【参考答案】\n${input.referenceAnswer}`,
  ].join('\n');
}

/** Build the prompt that judges whether each reference sentence is attributable. */
export function buildContextAttributionPrompt(input: {
  referenceAnswer: string;
  context: string;
}): string {
  return [
    '你是严谨的评审。把「参考答案」拆成句子，',
    '依据「上下文」判断每个句子是否能由上下文归因（即上下文支持该句子）。',
    '输出 JSON 布尔数组，按参考答案的句子顺序排列，每个布尔值对应一个句子。',
    JSON_ONLY,
    '',
    `【参考答案】\n${input.referenceAnswer}`,
    '',
    `【上下文】\n${input.context}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// — Judge tasks (build prompt → call → parse → outcome), one per scoring metric
// ---------------------------------------------------------------------------
//
// Each task is one instance of the same {build prompt, parse with a strict
// schema, call through `callJudge`} pattern — five instances of one verified
// mechanism, not five separate mechanisms.

/** Extract atomic claims and per-claim support, feeding the faithfulness score. */
export function judgeClaimSupport(
  judgeFn: JudgeFn,
  input: { answer: string; context: string },
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<ClaimVerdict[]>> {
  return callJudge(judgeFn, buildClaimSupportPrompt(input), parseClaimVerdicts, opts);
}

/** Derive the reverse questions an answer answers (vectorized upstream later). */
export function judgeReverseQuestions(
  judgeFn: JudgeFn,
  input: { answer: string },
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<string[]>> {
  return callJudge(judgeFn, buildReverseQuestionsPrompt(input), parseReverseQuestions, opts);
}

/** Flag each retrieved chunk as useful for the query (aligned to input order). */
export function judgeContextUsefulness(
  judgeFn: JudgeFn,
  input: { query: string; chunks: readonly string[] },
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<boolean[]>> {
  return callJudge(
    judgeFn,
    buildContextUsefulnessPrompt(input),
    (raw) => parseAlignedFlags(raw, input.chunks.length),
    opts,
  );
}

/** Classify each answer statement TP/FP/FN against the reference answer. */
export function judgeStatementClassification(
  judgeFn: JudgeFn,
  input: { answer: string; referenceAnswer: string },
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<AnswerCorrectnessStatement[]>> {
  return callJudge(judgeFn, buildStatementClassificationPrompt(input), parseStatements, opts);
}

/** Judge whether each reference sentence is attributable to the context. */
export function judgeContextAttribution(
  judgeFn: JudgeFn,
  input: { referenceAnswer: string; context: string },
  opts?: JudgeCallOptions,
): Promise<JudgeOutcome<boolean[]>> {
  return callJudge(
    judgeFn,
    buildContextAttributionPrompt(input),
    (raw) => booleanFlagsSchema.parse(extractJson(raw)),
    opts,
  );
}
