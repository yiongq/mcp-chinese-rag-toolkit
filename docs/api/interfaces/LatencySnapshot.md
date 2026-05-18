[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / LatencySnapshot

# Interface: LatencySnapshot

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:487](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L487)

Snapshot returned by `runStdioLatencyHarness` — schema also written to
`bench/baseline.json` by `bin/latency-harness.ts`.

## Properties

### coldStartMs

> **coldStartMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:502](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L502)

Cold start latency — total elapsed time of the warmup loop (ms). When
`warmupRuns === 0` this is approximately `0` (loop never ran) and the
first measured sample carries the cold-start cost; treat the field as
informational only in that case.

***

### environment

> **environment**: `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:520](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L520)

Toolkit + reranker provenance — frozen into the snapshot so
baseline.json regressions are debuggable years later without
re-running git archaeology.

#### arch

> **arch**: `string`

Arch (`arm64` / `x64`).

#### embedderModelId

> **embedderModelId**: `string`

Embedder manifest modelId.

#### jiebaVersion

> **jiebaVersion**: `string`

`JIEBA_VERSION` constant.

#### node

> **node**: `string`

Node version (e.g. 'v22.10.0').

#### platform

> **platform**: `string`

Platform (`darwin` / `linux` / `win32`).

#### rerankerModelId

> **rerankerModelId**: `string`

Reranker manifest modelId.

#### toolkitVersion

> **toolkitVersion**: `string`

Toolkit `package.json` version.

***

### maxMs

> **maxMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:514](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L514)

Max warm latency (ms).

***

### meanMs

> **meanMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:510](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L510)

Mean warm latency (ms).

***

### measureRuns

> **measureRuns**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:495](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L495)

Number of measured runs.

***

### minMs

> **minMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:512](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L512)

Min warm latency (ms).

***

### p50Ms

> **p50Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:504](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L504)

Warm-only P50 latency (ms).

***

### p95Ms

> **p95Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:506](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L506)

Warm-only P95 latency (ms). NFR1: must stay < 200.

***

### p99Ms

> **p99Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:508](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L508)

Warm-only P99 latency (ms).

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:489](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L489)

ISO-8601 timestamp when the harness completed.

***

### toolName

> **toolName**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:491](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L491)

Tool name that was measured.

***

### warmupRuns

> **warmupRuns**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:493](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L493)

Number of warmup runs that completed successfully.
