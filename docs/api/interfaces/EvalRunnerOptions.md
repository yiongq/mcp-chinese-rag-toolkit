[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalRunnerOptions

# Interface: EvalRunnerOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:129](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L129)

Options for `runEval()`.

## Properties

### searchFn

> **searchFn**: [`EvalSearchFn`](../type-aliases/EvalSearchFn.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:134](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L134)

Search function under evaluation. Caller injects (a downstream consumer package / a downstream consumer package /
third-party each wire their own).

***

### strict?

> `optional` **strict?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:141](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L141)

When true, `expected.page` (if present) must EXACTLY match a top-K
result.page. When false (default), only source match counts.

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:136](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/types.ts#L136)

Top-K for both Hit Rate@K and MRR@K.

#### Default

```ts
5.
```
