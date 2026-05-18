[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / DEFAULT\_PREFIX\_LENGTH

# Variable: DEFAULT\_PREFIX\_LENGTH

> `const` **DEFAULT\_PREFIX\_LENGTH**: `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts:9](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts#L9)

Default prefix length range — picks ~50-100 chars to add a semantic
anchor without bloating chunk size. Source: Anthropic 2024-09 blog
"Introducing Contextual Retrieval" §"Implementing Contextual
Retrieval", recommended bound.

## Type Declaration

### max

> `readonly` **max**: `100` = `100`

### min

> `readonly` **min**: `50` = `50`
