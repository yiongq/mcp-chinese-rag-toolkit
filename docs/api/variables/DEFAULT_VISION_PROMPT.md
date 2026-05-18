[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / DEFAULT\_VISION\_PROMPT

# Variable: DEFAULT\_VISION\_PROMPT

> `const` **DEFAULT\_VISION\_PROMPT**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/with-vision-caption.ts:25](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/with-vision-caption.ts#L25)

Default Chinese prompt template — taken verbatim from ADR-0008 §Caption
Prompt 模板. Callers can override via `opts.promptTemplate`; doing so
invalidates the caption cache (intentional, since different prompts
produce different captions).
