[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / runStdioLatencyHarness

# Function: runStdioLatencyHarness()

> **runStdioLatencyHarness**(`opts?`): `Promise`\<[`HarnessResult`](../interfaces/HarnessResult.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/latency-harness.ts:182](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/latency-harness.ts#L182)

Run an in-process MCP server + client pair and measure tool-call latency.

Why in-process instead of spawning a subprocess:
  1. Cross-platform fork latency (30–300ms on Windows / Linux / macOS)
     would dominate cold-start measurement noise.
  2.  quantifies the toolkit + MCP SDK protocol layer; subprocess
     fork cost is unrelated to product latency.
  3. CI runners have unstable IPC overhead.

The transport is `InMemoryTransport.createLinkedPair()` — the
SDK-supported pattern for in-process client/server pairs. The JSON-RPC
protocol layer (request/response correlation, schema validation) is
exercised end-to-end; the only thing skipped is stdio-frame
encoding/decoding (~1–3ms per call per the Latency Budget table).
For a downstream consumer package / a downstream consumer package end-to-end stdio validation, run the
/ 6 integration tests with the spawned-subprocess transport.

## Parameters

### opts?

`RunStdioLatencyHarnessOptions` = `{}`

## Returns

`Promise`\<[`HarnessResult`](../interfaces/HarnessResult.md)\>

## Throws

if `warmupRuns < 0`, `measureRuns < 1`, or `queries.length === 0`.

## Throws

if any tool call rejects (no partial / corrupted snapshots).
