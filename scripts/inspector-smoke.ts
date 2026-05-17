/**
 * Story 1.3 / AC4: launches an echo-tool MCP server over stdio so a contributor
 * can validate Resources / Tools / Prompts primitives via:
 *
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit exec tsx scripts/inspector-smoke.ts
 *
 * or via the MCP Inspector CLI:
 *
 *   npx @modelcontextprotocol/inspector \
 *     pnpm --filter @yiong/mcp-chinese-rag-toolkit exec tsx scripts/inspector-smoke.ts
 *
 * Dev-only; never bundled into dist.
 */

import { echoTool } from '../src/server/__fixtures__/echo-tool.js';
import { createMcpServer } from '../src/server/create-mcp-server.js';

async function main(): Promise<void> {
  const handle = createMcpServer({
    name: 'toolkit-inspector-smoke',
    version: '0.0.0',
    transport: 'stdio',
    tools: [echoTool],
  });

  await handle.start();
  // Stdio MCP servers exit when the parent (Inspector) closes the stream.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[inspector-smoke] failed to start:', err);
  process.exit(1);
});
