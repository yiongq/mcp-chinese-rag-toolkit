export type { WriteArtifactsOptions } from './ci-helper.js';
export {
  DEFAULT_HIT_RATE_MIN,
  DEFAULT_RESULTS_DIR,
  emitGitHubActionsAnnotation,
  passesGate,
  renderMarkdownReport,
  resolveHitRateMin,
  writeArtifacts,
} from './ci-helper.js';
export type { EvalErrorCode } from './errors.js';
export {
  assertContentPopulated,
  EVAL_ERROR_CODES,
  EvalFrameworkError,
  evalError,
} from './errors.js';
export { DEFAULT_EVAL_TOP_K, loadEvalSet, ndcg, runEval, scoreQuery } from './eval-runner.js';
export {
  answerCorrectness,
  answerRelevance,
  contextPrecision,
  contextRecall,
  cosineSimilarity,
  faithfulness,
} from './judges.js';
export type {
  AnswerCorrectnessResult,
  AnswerCorrectnessStatement,
  AnswerRelevanceInput,
  AnswerRelevanceResult,
  ClaimVerdict,
  ContextPrecisionResult,
  ContextRecallResult,
  CorrectnessLabel,
  EvalExpected,
  EvalQuery,
  EvalQueryResult,
  EvalRunnerOptions,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
  EvalSummary,
  FaithfulnessResult,
  NdcgResult,
} from './types.js';
