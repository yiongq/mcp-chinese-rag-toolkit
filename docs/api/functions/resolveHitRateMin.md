[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / resolveHitRateMin

# Function: resolveHitRateMin()

> **resolveHitRateMin**(`envValue?`): `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/ci-helper.ts:147](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/ci-helper.ts#L147)

Read `RAG_EVAL_HIT_RATE_MIN` env var, fall back to [DEFAULT\_HIT\_RATE\_MIN](../variables/DEFAULT_HIT_RATE_MIN.md).
Validates the parsed value is a finite float in [0, 1]; throws actionable
error otherwise (教训 3 — error message contains the env var name
so reviewers see immediately which knob is wrong).

## Parameters

### envValue?

`string`

## Returns

`number`
