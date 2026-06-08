---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Extend the eval framework (additive, no breaking changes):

- `EvalQuery` gains an optional `referenceAnswer` field, parsed and validated by `loadEvalSet` (must be a non-empty string when present). Reference-based answer metrics can consume it; retrieval scoring ignores it.
- New `assertContentPopulated(result)` content guard plus a lean eval error layer (`EvalFrameworkError`, `evalError`, `EVAL_ERROR_CODES` with `EVAL_CONTENT_MISSING`). It throws on missing/blank chunk content so answer-quality metrics fail loudly instead of silently scoring low.
- Raise the supported Node engine to `>=22`.
