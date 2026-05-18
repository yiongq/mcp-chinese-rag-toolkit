[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalSet

# Interface: EvalSet

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:72](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L72)

Top-level eval-set.yml document shape.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:79](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L79)

Optional metadata for report header.

***

### queries

> **queries**: [`EvalQuery`](EvalQuery.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:81](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L81)

≥ 1 queries; toolkit validates at load time.

***

### version

> **version**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:77](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L77)

Eval set version string (free-form, e.g. `'v1-hr-mini'`). Used for
cross-run report comparison; toolkit does NOT enforce semver.
