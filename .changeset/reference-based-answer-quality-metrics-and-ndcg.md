---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add reference-based answer-quality scoring and a graded-relevance ranking metric to the eval framework (additive, no breaking changes):

- `answerCorrectness(statements)` — statement-level F1 between an answer and a gold reference, from per-statement TP/FP/FN classifications (`2·tp / (2·tp + fp + fn)`). Returns precision, recall, and the raw counts for auditing. Implements the factual F1 component only; the optional semantic-similarity term is left to the caller so the function stays embedding-free.
- `contextRecall(attributedFlags)` — fraction of reference sentences attributable to the retrieved context. A sentence counts only when its flag is strictly `true`.
- `ndcg(gains, opts?)` — Normalized Discounted Cumulative Gain over a ranked list of graded relevance labels, complementing the existing binary Hit Rate@K / MRR@K. Uses the standard linear gain with a log2 position discount (`DCG@k / IDCG@k`); `opts.k` truncates the ranking. Returns the raw `dcg` / `idcg` / effective `k` for auditing.

All three are deterministic pure functions (no model calls, no embedding calls, no I/O), so they can be regression-tested offline with no API keys. New result/input types (`AnswerCorrectnessStatement`, `AnswerCorrectnessResult`, `ContextRecallResult`, `NdcgResult`, `CorrectnessLabel`) are exported from the package root. Structurally malformed input (a non-array, a non-finite gain, or a bad `k`) throws the existing coded `EvalFrameworkError` (`EVAL_INVALID_METRIC_INPUT`).
