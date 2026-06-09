---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add `runAnswerEval` — a single provider-injection entry point that runs a whole answer-quality evaluation (additive, no breaking changes). It wires the existing layers into one flow: retrieve context, generate an answer from it, drive the judge tasks, feed their structured output to the pure scoring functions, and stamp the run with reproducible version metadata. It is an orchestrator only — it does not build prompts, parse model output, or compute any metric formula.

- `runAnswerEval(evalSet, opts)` — for each query it retrieves top-K context, generates an answer, and computes up to five RAGAS metrics: faithfulness, answer relevance and context precision (reference-free), plus answer correctness and context recall (reference-based, computed only when the query carries a reference answer). Retrieval, generation, judging and embedding are all caller-injected, so a deterministic mock drives the whole thing in CI with no API key and no network.
- Graceful skips, never faked scores: the reference-based pair is skipped (`NO_REFERENCE_ANSWER`) when a query has no reference answer, and answer relevance is skipped (`NO_EMBED_FN`) when no embed function is injected. A degraded judge call (timeout or malformed output) skips just its own metric.
- Resilient per query, like the retrieval runner: a fault fatal to one query — a throwing search/generate function, a missing chunk, or a judge infrastructure rejection — is recorded on that query's row and the run continues. An embed-function failure is localized to answer relevance, its only consumer.
- Reproducible version metadata `{ generateModel, judgeModel, judgePromptVersion, toolkitVersion, evalSpecVersion }` is stamped onto every run, with each field carrying its own provenance (model names are caller-injected, the toolkit version is read from package.json, never hardcoded), so scores stay comparable and auditable across time and configurations.
- New types `GenerateFn`, `EmbedFn`, `AnswerEvalOptions`, `AnswerEvalMetrics`, `AnswerEvalQueryResult`, `AnswerEvalSummary` and `AnswerEvalVersionMeta` are exported from the package root.

`answerCorrectness` reports the statement-level F1 component only; the full RAGAS metric blends it with an answer–reference semantic similarity term, which needs another embedding pass and is left to a later calibration step.
