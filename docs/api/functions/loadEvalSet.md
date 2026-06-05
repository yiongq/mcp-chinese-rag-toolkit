[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / loadEvalSet

# Function: loadEvalSet()

> **loadEvalSet**(`evalSetPath`): [`EvalSet`](../interfaces/EvalSet.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/eval-runner.ts:41](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/eval-runner.ts#L41)

Parse an eval-set.yml file from disk into a typed [EvalSet](../interfaces/EvalSet.md).

EXTRACTS `# reason: <text>` line comments preceding each query item and
attaches them to [EvalQuery.reason](../interfaces/EvalQuery.md#reason) — this lets the markdown report
surface "why this query matters" when CI flags a regression (AI Agent
Rule #9). An inline `reason: ...` YAML field is honoured as well and
takes precedence over the leading comment fallback.

THROWS friendly errors when:
  - file does not exist / is empty
  - top-level shape is not `{ version, queries: [...] }`
  - any query has `expected: []` (empty)
  - any expected entry lacks `source`
  - any expected.page is not a positive integer

Reason: a silent "use defaults" path on a broken eval set would let the CI
gate hide regressions; fail-fast keeps  honest.

## Parameters

### evalSetPath

`string`

## Returns

[`EvalSet`](../interfaces/EvalSet.md)
