[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / McpServerConfig

# Interface: McpServerConfig

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:45](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L45)

## Properties

### cache?

> `optional` **cache?**: [`McpServerCacheConfig`](McpServerCacheConfig.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:61](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L61)

Story 2.6 — L0 tool-result LRU cache. Omit (or pass `{}` without
`indexVersion`) to disable. Disabled by default to preserve Epic 1
walking-skeleton behaviour for callers that haven't opted in.

***

### handleSignals?

> `optional` **handleSignals?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:55](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L55)

Forwarded to stdio transport when applicable. Default true.

***

### host?

> `optional` **host?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:53](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L53)

***

### name

> **name**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:46](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L46)

***

### port?

> `optional` **port?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:52](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L52)

***

### prompts?

> `optional` **prompts?**: `unknown`[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:50](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L50)

***

### resources?

> `optional` **resources?**: [`ResourceDefinition`](ResourceDefinition.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:49](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L49)

***

### tools?

> `optional` **tools?**: [`McpToolDefinition`](McpToolDefinition.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:48](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L48)

***

### transport?

> `optional` **transport?**: `TransportKind`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:51](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L51)

***

### version

> **version**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:47](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts#L47)
