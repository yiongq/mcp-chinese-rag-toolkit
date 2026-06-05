[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / emitGitHubActionsAnnotation

# Function: emitGitHubActionsAnnotation()

> **emitGitHubActionsAnnotation**(`summary`, `threshold`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/ci-helper.ts:170](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/ci-helper.ts#L170)

GitHub Actions-friendly stdout writer — emits `::error::` annotation on
gate failure + `::notice::` on pass. Mirrors latency-harness
bench `::warning::` idiom for consistency. No-op outside GitHub Actions so
local runs do not pollute stdout.

## Parameters

### summary

[`EvalSummary`](../interfaces/EvalSummary.md)

### threshold

`number`

## Returns

`void`
