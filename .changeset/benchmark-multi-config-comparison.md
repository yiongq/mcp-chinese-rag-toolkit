---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Add `runBenchmark` — run one eval set through several named retrieval configurations and lay the results out as a single comparison table (additive, no breaking changes). It is an orchestrator only: it reuses the retrieval runner, the answer-eval orchestrator and the ranking-gain metric, and reimplements none of their formulas.

- `runBenchmark(evalSet, opts)` — for each `{ name, searchFn }` configuration it scores retrieval (Hit Rate@K, MRR, and a mean nDCG@K derived from the existing expected-hit labels) and answer quality (the five RAGAS metrics), keeping the full per-config sub-results alongside the aggregates. Each row is stamped with the same reproducible version metadata, so the table is comparable and auditable across runs.
- Stays provider-agnostic: the toolkit never learns how a retrieval configuration is built (reranking, lexical vs vector, tokenizer choices). The caller pre-wires each configuration as a `searchFn`; the toolkit only iterates over them.
- `renderBenchmarkTable(summary)` — render the comparison as deterministic GitHub-flavoured markdown, one row per configuration. A never-measured answer metric renders as `n/a` (never faked to `0`), and there is deliberately no aggregate "overall" column — the metrics measure different things on different scales.
- New types `BenchmarkConfig`, `BenchmarkOptions`, `BenchmarkConfigResult` and `BenchmarkSummary` are exported from the package root.

The mean nDCG@K is derived from the existing binary expected-hit labels (a hit scores gain `1`, a miss `0`); even so it is informative, rewarding a configuration that ranks a hit higher — something Hit Rate@K and MRR do not capture. Graded relevance labels are a future, purely-additive extension.
