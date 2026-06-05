[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / JIEBA\_VERSION

# Variable: JIEBA\_VERSION

> `const` **JIEBA\_VERSION**: `"@node-rs/jieba@2.0.1"`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/tokenizer-meta.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/tokenizer-meta.ts#L16)

Canonical tokenizer-identity string written into `meta.tokenizer_version`.
Hardcoded against `@node-rs/jieba@2.0.1` (the version pinned by
`packages/mcp-chinese-rag-toolkit/package.json#dependencies`).

Bump this literal whenever the jieba runtime dep is upgraded AND
eval confirms no Hit Rate@5 regression. Reading from
`node:fs` at runtime would couple the toolkit to its on-disk layout
(npm tarball / bundle / pnpm hoisting all reshape `node_modules`);
the literal IS the contract. `tokenizer-meta.test.ts` cross-checks
this against `package.json#dependencies['@node-rs/jieba']` so a dep
bump without a constant bump fails CI.
