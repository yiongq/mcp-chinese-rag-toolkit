---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add a judge result cache and benchmark query sampling (additive, no breaking changes).

- `withJudgeCache(judgeFn, opts)` wraps a judge function so identical calls are memoized. The cache key is a content hash of the prompt (via `computeJudgeCacheKey`), so only hashes are stored — never the raw prompt or output. `createMemoryJudgeCacheStore(max?)` provides a default bounded in-memory store, and the `JudgeCacheStore` / `JudgeCacheOptions` types let callers plug in their own. Caching is opt-in at the call site, so variance sampling (which must drive the raw judge) is never collapsed to a single cached value.
- `sampleQueries(evalSet, n, opts?)` deterministically selects a subset of an eval-set, so a benchmark can run a cheap PR-smoke subset and the full set on a nightly schedule from the same data.

Both are exported from the package root.
