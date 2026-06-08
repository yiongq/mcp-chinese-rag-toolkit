---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add the LLM-facing judge layer to the eval framework (additive, no breaking changes). This is the impure counterpart to the pure scoring functions: it builds a prompt, calls an injected judge, and parses the model's text into the structured inputs the scoring layer consumes — keeping that scoring layer pure.

- `callJudge(judgeFn, prompt, parse, opts?)` — drives a judge function, racing it against a wall-clock timeout and parsing the result. It NEVER throws for the two judge-output failure modes: a timeout degrades to `EVAL_JUDGE_TIMEOUT` (retryable) and unparseable / wrong-shape output degrades to `EVAL_JUDGE_MALFORMED_OUTPUT` (not retryable), both returned as a discriminated `JudgeOutcome`. A non-timeout rejection from the judge itself (e.g. a provider error) propagates unchanged.
- Five judge tasks — `judgeClaimSupport`, `judgeReverseQuestions`, `judgeContextUsefulness`, `judgeStatementClassification`, `judgeContextAttribution` — each build a prompt and parse the judge's JSON (tolerant of code fences and surrounding prose) into the structured input one scoring metric consumes. Output is validated against the target shape (required fields and value types are enforced; unrecognized extra keys are ignored).
- New types `JudgeFn` (`(prompt: string) => Promise<string>`), `JudgeCallOptions`, `JudgeOutcome<T>`, and the lean degrade core `EvalErrorCore`, plus the `JUDGE_PROMPT_VERSION` and `DEFAULT_JUDGE_TIMEOUT_MS` constants and the two new error codes, are exported from the package root.

The judge signature is provider-agnostic and free of any business / envelope fields, so the layer can be exercised in CI with a deterministic mock judge — no API keys and no network.

Also reject negative graded labels in `ndcg` (alongside the existing non-finite guard), since a negative gain would push the score outside the documented `[0, 1]` range.
