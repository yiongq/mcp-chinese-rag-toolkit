---
'@yiong/mcp-chinese-rag-toolkit': minor
---

Benchmark: support per-config answer generation. `BenchmarkConfig` gains optional `generateFn` / `generateModel` overrides so configurations that generate answers differently (e.g. different generation models or end-to-end orchestrations) can be compared in one run. Omitting them keeps the shared run-level pair — existing callers are unaffected. When per-config models differ, the summary's `versionMeta.generateModel` becomes an explicit `name=model; name=model` aggregate and the comparison table lists the generation model per configuration.
