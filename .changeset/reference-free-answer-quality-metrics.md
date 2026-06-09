---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add reference-free answer-quality scoring to the eval framework (additive, no breaking changes):

- `faithfulness(verdicts)` — fraction of an answer's atomic claims supported by the retrieved context (`0/0 → 0`).
- `answerRelevance({ queryEmbedding, generatedQuestionEmbeddings })` — mean cosine similarity between the original query and reverse questions generated from the answer (unclamped, ∈ [-1, 1]).
- `contextPrecision(usefulFlags)` — order-sensitive average precision over a ranked list of useful/not-useful chunks.
- `cosineSimilarity(a, b)` helper — zero-norm vectors yield `0`; length mismatch or non-finite values throw a coded `EvalFrameworkError`.

All four are deterministic pure functions (no model calls, no embedding calls, no I/O), so they can be regression-tested offline with no API keys. New result/input types (`ClaimVerdict`, `FaithfulnessResult`, `AnswerRelevanceInput`, `AnswerRelevanceResult`, `ContextPrecisionResult`) and a new `EVAL_INVALID_METRIC_INPUT` error code are exported from the package root.
