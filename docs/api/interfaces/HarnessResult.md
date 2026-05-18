[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / HarnessResult

# Interface: HarnessResult

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:539](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L539)

Result returned by `runStdioLatencyHarness` — includes raw samples for debug.

## Properties

### samples

> **samples**: `number`[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:542](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L542)

Raw per-call latency array (warm runs only) — for histograms / debug.

***

### snapshot

> **snapshot**: [`LatencySnapshot`](LatencySnapshot.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:540](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L540)
