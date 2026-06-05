[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / McpServerConfig

# Interface: McpServerConfig

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:52](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L52)

## Properties

### cache?

> `optional` **cache?**: [`McpServerCacheConfig`](McpServerCacheConfig.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:68](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L68)

— L0 tool-result LRU cache. Omit (or pass `{}` without
`indexVersion`) to disable. Disabled by default to preserve 
walking-skeleton behaviour for callers that haven't opted in.

***

### cors?

> `optional` **cors?**: `CorsOptions`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:74](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L74)

— CORS whitelist, forwarded to the HTTP transport. Ignored for
`transport: 'stdio'` (stdio has no origin concept). Omit to disable CORS.
See CorsOptions; a downstream consumer package passes `{ origins: ['chrome-extension://*'] }`.

***

### handleSignals?

> `optional` **handleSignals?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:62](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L62)

Forwarded to stdio transport when applicable. Default true.

***

### host?

> `optional` **host?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:60](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L60)

***

### name

> **name**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:53](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L53)

***

### port?

> `optional` **port?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:59](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L59)

***

### prompts?

> `optional` **prompts?**: `unknown`[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:57](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L57)

***

### resources?

> `optional` **resources?**: [`ResourceDefinition`](ResourceDefinition.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:56](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L56)

***

### tools?

> `optional` **tools?**: [`McpToolDefinition`](McpToolDefinition.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:55](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L55)

***

### transport?

> `optional` **transport?**: `TransportKind`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:58](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L58)

***

### version

> **version**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:54](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L54)
