[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / EvalQuery

# Interface: EvalQuery

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:50](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L50)

One row of an eval set, declared in YAML. Order of fields in YAML is
preserved by `yaml@^2` parse and used by `report.md` deterministic output.

## Properties

### category?

> `optional` **category?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:62](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L62)

kebab-case category (architecture L440), e.g. `'engine-routing'`,
`'hooks'`, `'leave-policy'`. Used by report.md aggregation.

***

### expected

> **expected**: [`EvalExpected`](EvalExpected.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:57](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L57)

≥ 1 expected hit (OR semantics — any match scores hit). Toolkit validates
non-empty at load time and throws an actionable error.

***

### query

> **query**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:52](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L52)

Free-form Chinese query, e.g. `'试用期多久'`.

***

### reason?

> `optional` **reason?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/types.ts:68](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/types.ts#L68)

Author-supplied YAML comment captured as `# reason: ...` (AI Agent
Rule #9). Toolkit extracts and surfaces in report.md when CI fails.
Inline `reason:` YAML field takes precedence over the comment fallback.
