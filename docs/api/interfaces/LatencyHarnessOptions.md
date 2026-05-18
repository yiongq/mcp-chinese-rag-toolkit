[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / LatencyHarnessOptions

# Interface: LatencyHarnessOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:466](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L466)

Options for `runStdioLatencyHarness`.

## Properties

### measureRuns?

> `optional` **measureRuns?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:470](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L470)

Number of measured tool calls.

#### Default

```ts
100
```

***

### queries?

> `optional` **queries?**: `string`[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:475](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L475)

Fixture: query strings cycled through during measurement.

#### Default

```ts
['试用期', '加班', '请假', '差旅报销', '保密协议']
```

***

### toolName?

> `optional` **toolName?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:480](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L480)

Tool name to invoke. Default tool is a hybrid + rerank pipeline over an
in-memory 12-chunk HR fixture (mirrors the integration test fixture).

***

### warmupRuns?

> `optional` **warmupRuns?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:468](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L468)

Number of throwaway warm-up calls before measurement starts.

#### Default

```ts
5
```
