[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / writeArtifacts

# Function: writeArtifacts()

> **writeArtifacts**(`summary`, `opts?`): `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/ci-helper.ts:32](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/eval/ci-helper.ts#L32)

Write summary.json / report.md / per-query.json into outDir. Creates the
directory if it does not exist. Atomic per-file write is NOT used — eval is
non-interactive batch and CI re-runs are cheap (mirrors Story 2.5 bench's
straight write); partial output on crash is acceptable because the gate
step fails fast and the report becomes worthless either way.

## Parameters

### summary

[`EvalSummary`](../interfaces/EvalSummary.md)

### opts?

[`WriteArtifactsOptions`](../interfaces/WriteArtifactsOptions.md) = `{}`

## Returns

`object`

### perQueryPath

> **perQueryPath**: `string`

### reportPath

> **reportPath**: `string`

### summaryPath

> **summaryPath**: `string`
