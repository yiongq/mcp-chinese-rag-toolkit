[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / canonicalize

# Function: canonicalize()

> **canonicalize**(`args`): `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:33](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/middleware/with-lru-cache.ts#L33)

Canonicalize args for cache-key stability:

1. JSON keys recursively sorted, so `{a:1,b:2}` ≡ `{b:2,a:1}`.
2. String values trimmed + 全角空格 `'　'` → 半角 `' '`.
3. Case PRESERVED — `'Apple'` ≠ `'apple'` (proper-noun-sensitive; HR /
   modeling docs contain model numbers, customer names, factory names
   where case is identity, not formatting).
4. Non-plain-object branches pass through unchanged (number / bool /
   null / array element order is meaningful and kept).

Output is the canonical `JSON.stringify` of the normalized value.

## Parameters

### args

`unknown`

## Returns

`string`
