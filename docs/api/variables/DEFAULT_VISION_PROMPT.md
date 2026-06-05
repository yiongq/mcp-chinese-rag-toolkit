[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / DEFAULT\_VISION\_PROMPT

# Variable: DEFAULT\_VISION\_PROMPT

> `const` **DEFAULT\_VISION\_PROMPT**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-engine.ts:20](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/caption-engine.ts#L20)

Default Chinese prompt template — taken verbatim from ADR-0008 §Caption
Prompt 模板. Shared by both caption plugins; callers override via
`opts.promptTemplate`, which invalidates the caption cache (intentional,
since different prompts produce different captions).
