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
export { DEFAULT_EVAL_TOP_K, loadEvalSet, runEval, scoreQuery } from './eval-runner.js';
export {
  answerRelevance,
  contextPrecision,
  cosineSimilarity,
  faithfulness,
} from './judges.js';
export type {
  AnswerRelevanceInput,
  AnswerRelevanceResult,
  ClaimVerdict,
  ContextPrecisionResult,
  EvalExpected,
  EvalQuery,
  EvalQueryResult,
  EvalRunnerOptions,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
  EvalSummary,
  FaithfulnessResult,
} from './types.js';
