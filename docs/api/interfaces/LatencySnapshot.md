[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / LatencySnapshot

# Interface: LatencySnapshot

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:495](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L495)

Snapshot returned by `runStdioLatencyHarness` — schema also written to
`bench/baseline.json` by `bin/latency-harness.ts`.

## Properties

### coldStartMs

> **coldStartMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:510](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L510)

Cold start latency — total elapsed time of the warmup loop (ms). When
`warmupRuns === 0` this is approximately `0` (loop never ran) and the
first measured sample carries the cold-start cost; treat the field as
informational only in that case.

***

### environment

> **environment**: `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:528](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L528)

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

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:522](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L522)

Max warm latency (ms).

***

### meanMs

> **meanMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:518](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L518)

Mean warm latency (ms).

***

### measureRuns

> **measureRuns**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:503](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L503)

Number of measured runs.

***

### minMs

> **minMs**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:520](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L520)

Min warm latency (ms).

***

### p50Ms

> **p50Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:512](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L512)

Warm-only P50 latency (ms).

***

### p95Ms

> **p95Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:514](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L514)

Warm-only P95 latency (ms). : must stay < 200.

***

### p99Ms

> **p99Ms**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:516](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L516)

Warm-only P99 latency (ms).

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:497](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L497)

ISO-8601 timestamp when the harness completed.

***

### toolName

> **toolName**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:499](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L499)

Tool name that was measured.

***

### warmupRuns

> **warmupRuns**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:501](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L501)

Number of warmup runs that completed successfully.
