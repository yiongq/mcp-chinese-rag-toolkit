---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Eval: add optional multi-turn conversation history to eval cases. `EvalQuery` gains `history?: ConversationTurn[]` (declared per query in the eval-set YAML, oldest-first); `loadEvalSet` validates the shape (role must be `user` or `assistant`, content a non-empty string) and fails fast with the exact `queries[i].history[j]` location on authoring mistakes. The harness passes the history through verbatim to the injected `searchFn` (new optional `history` in its options) and `generateFn` (new optional `history` on its input) — it never consumes history itself, so whether retrieval or generation is history-aware stays entirely the caller's decision. Purely additive: single-turn eval sets, existing callers, and history-agnostic functions are unaffected.

Also re-exports `aggregateAnswerMeans` (the per-query answer-metric mean aggregator `runBenchmark` already uses internally) at the package level, so downstream verdict layers can aggregate metric means over filtered per-query subsets without re-implementing the formula.
