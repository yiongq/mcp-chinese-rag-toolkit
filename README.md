# @yiong/mcp-chinese-rag-toolkit

> Reusable MCP server factory + Chinese RAG pipeline + eval framework for building production MCP servers in TypeScript.

🚧 **0.1.x — server factory + tool / resource builders.** RAG pipeline lands in Epic 2.

## Install

```bash
pnpm add @yiong/mcp-chinese-rag-toolkit
```

Requires Node.js `>=20.0.0`. Ships ESM + CJS + `.d.ts` / `.d.cts` so both `import` and `require` consumers (and TypeScript strict mode) resolve without dual-module hazard.

## Quick start

### stdio server (CLI / Claude Desktop / VS Code clients)

```ts
import { createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const server = createMcpServer({
  name: 'my-mcp', version: '0.1.0', transport: 'stdio',
  tools: [{
    name: 'ping',
    description: 'Reply with pong.',
    inputSchema: z.object({}),
    handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  }],
});
await server.start();
```

### Streamable HTTP server (remote MCP clients, stateless)

```ts
import { createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const server = createMcpServer({
  name: 'my-mcp', version: '0.1.0', transport: 'http', port: 3000,
  tools: [{
    name: 'echo',
    description: 'Echo the message.',
    inputSchema: z.object({ message: z.string() }),
    handler: async (args) => {
      const { message } = args as { message: string };
      return { content: [{ type: 'text', text: message }] };
    },
  }],
});
await server.start();
// POST http://127.0.0.1:3000/mcp
```

### Error envelope

```ts
import { errors } from '@yiong/mcp-chinese-rag-toolkit';

return errors.create('ENTITY_NOT_FOUND', 'No matching record', {
  retryable: false,
  confidence: 'low',
  citations: [{ source: 'handbook.pdf', page: 12 }],
  refusal: 'No high-confidence answer available.',
});
```

The factory automatically wraps any thrown handler exception into an `INTERNAL_ERROR` envelope (architecture rule #5), so handlers never leak uncaught errors. Error codes are enforced `SCREAMING_SNAKE_CASE`; `retryable` defaults to `false` (fail-closed, NFR15).

`MCP_TRANSPORT=stdio|http` env var is read when `config.transport` is omitted (default: `stdio`). Illegal values fail fast — no silent fallback.

## MCP Inspector smoke test

For an end-to-end protocol validation (Resources / Tools / Prompts primitives), run:

```bash
pnpm --filter @yiong/mcp-chinese-rag-toolkit exec \
  npx @modelcontextprotocol/inspector \
  pnpm --filter @yiong/mcp-chinese-rag-toolkit exec tsx scripts/inspector-smoke.ts
```

Then open the Inspector UI and verify all three tabs report ✅:

```
Resources: 0 ✓ / Tools: 1 (echo_tool) ✓ / Prompts: 0 ✓
```

## Tool Builder & Resource Provider

The `defineTool` / `defineResources` helpers enforce naming conventions (snake_case tool names,
camelCase parameter keys, `{scheme}://{kind}/{id}` resource URIs) at **build time**, and
`withHooks` reserves an opt-in instrumentation seam for Phase 2 OpenTelemetry without touching
business code.

### `defineTool` — author-friendly + LLM-aware

```ts
import { defineTool, createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const echoTool = defineTool({
  name: 'echo_tool', // snake_case (build-time enforced)
  description: 'Echo the input message back to the caller.',
  whenToUse: 'For toolkit smoke testing only — verifies transport + factory wiring end-to-end.',
  examples: [
    { description: 'simple echo', input: { message: 'hello' } },
  ],
  inputSchema: z.object({
    message: z.string(), // camelCase (build-time enforced)
  }),
  handler: async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
});

const server = createMcpServer({
  name: 'demo', version: '0.1.0', tools: [echoTool],
});
```

`description + whenToUse + examples` are composed into a single rich LLM-facing string and
capped at 2048 chars to keep the model's tool-selection context light. Bad names / bad
parameter keys / missing `whenToUse` / oversized descriptions throw at `defineTool` call
time — no surprises at runtime.

### `defineResources` — typed list / read with URI guardrails

```ts
import { defineResources, createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';

const hrDocs = defineResources({
  uriScheme: 'hr', // ^[a-z][a-z0-9-]*$ (kebab/lower, build-time enforced)
  title: 'HR Documents',
  mimeType: 'text/markdown',
  list: async () => ({
    resources: [
      { uri: 'hr://page/23', name: 'Page 23' }, // {scheme}://{kind}/{id} — enforced
      { uri: 'hr://page/24', name: 'Page 24' },
    ],
  }),
  read: async (uri, { kind, id }) => ({
    contents: [{ uri: uri.href, text: `<page ${kind}/${id} content>`, mimeType: 'text/markdown' }],
  }),
});

const server = createMcpServer({
  name: 'hr', version: '0.1.0', resources: [hrDocs],
});
```

`createMcpServer` registers the resource via the MCP SDK's `ResourceTemplate` and fails fast
on duplicate `uriScheme` entries. Any `list()` entry or `read()` call whose URI breaks the
`{scheme}://{kind}/{id}` pattern throws before reaching the wire.

### `withHooks` — opt-in observability seam (Phase 2 OTel pattern)

```ts
// Phase 2 pattern — pseudo-code, no runtime OTel dependency in this package.
import { defineTool, withHooks } from '@yiong/mcp-chinese-rag-toolkit';

const tool = defineTool({ /* ...as above... */ });
tool.handler = withHooks(
  tool.handler,
  {
    before: ({ toolName, args }) => span.start(toolName, { args }),
    after: ({ result, durationMs }) => span.end({ status: 'ok', durationMs }),
    error: ({ err, durationMs }) => span.recordException(err, { durationMs }),
  },
  { toolName: tool.name },
);
```

Invariants you can rely on:

- The original error is **re-thrown** — `createMcpServer` still owns conversion to the
  `INTERNAL_ERROR` envelope (no double-wrap, no lost stack trace).
- Hook failures are **swallowed** and logged via `console.warn`; business results never
  break because an observability hook misbehaved.
- `durationMs` uses `performance.now()` for high-precision, clock-jump-immune timing.

## Roadmap

| Phase | Story / Epic | Surface added |
| --- | --- | --- |
| ✅ Server factory + error envelope | Story 1.3 | `createMcpServer`, `errors` helpers |
| ✅ Tool builder + Resource provider + instrumentation hooks | Story 1.4 | `defineTool`, `defineResources`, `withHooks` |
| ADR + naming conventions migration | Story 1.5 | docs alignment, no API change |
| Chinese RAG pipeline (parser → chunk → embed → BM25 + vec + RRF + rerank) | Epic 2 (Stories 2.1–2.7) | `rag/*` exports + eval CI gate |
| Vision caption plugin | Epic 2 Story 2.8 | `rag/vision-caption` |
| `create-mcp-rag` CLI + Documentation Set (FR49) | Epic 2 Story 2.9 | `bin/create-mcp-rag`, README/CHANGELOG/templates |

See the umbrella roadmap in the repo root [`README.md`](../../README.md) for cross-package status.

## License

MIT (LICENSE file lands in Story 1.5 alongside the ADR migration).
