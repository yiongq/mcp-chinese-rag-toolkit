[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / DEFAULT\_HIT\_RATE\_MIN

# Variable: DEFAULT\_HIT\_RATE\_MIN

> `const` **DEFAULT\_HIT\_RATE\_MIN**: `0.9` = `0.9`

Defined in: [packages/mcp-chinese-rag-toolkit/src/eval/ci-helper.ts:18](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/eval/ci-helper.ts#L18)

Default minimum Hit Rate@K — matches  (90%). Can be overridden via the
`RAG_EVAL_HIT_RATE_MIN` env var (parsed as float ∈ [0, 1]). Production CI
MUST keep the default; dev override exists only for debugging.
