[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ToolHooks

# Interface: ToolHooks

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts:8](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts#L8)

## Properties

### after?

> `optional` **after?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts:10](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts#L10)

#### Parameters

##### ctx

[`ToolHookContext`](ToolHookContext.md) & `object`

#### Returns

`void` \| `Promise`\<`void`\>

***

### before?

> `optional` **before?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts:9](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts#L9)

#### Parameters

##### ctx

[`ToolHookContext`](ToolHookContext.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### error?

> `optional` **error?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts:13](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/instrumentation-hooks.ts#L13)

#### Parameters

##### ctx

[`ToolHookContext`](ToolHookContext.md) & `object`

#### Returns

`void` \| `Promise`\<`void`\>
